/** @jsxImportSource @zerotal/flow */
// The media library — every uploaded file in one grid, with upload, search,
// folder filtering, alt-text editing and deletion. Appears only when the panel
// has a media provider configured.

import { Component, expose } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { AdminLayout } from "../ui/AdminLayout.tsx";
import { Icon } from "../ui/icons.tsx";
import { Panel } from "../Panel.ts";
import type { PanelInstance } from "../PanelInstance.ts";
import type { MediaItem } from "../media.ts";
import { deleteMedia, formatSize, isImage, isUpload, mediaUrl, storeMedia } from "../media.ts";

/** How many files the grid shows before the "load more" step. */
const PAGE_SIZE = 60;

/** @internal */
export class MediaPage extends Component {
  static layout = AdminLayout;
  /** The panel this page belongs to — set by each generated subclass. */
  static panel: PanelInstance;

  @expose search = "";
  @expose folder = "";
  @expose limit = PAGE_SIZE;
  /** The item whose details are open, by id. */
  @expose editing = "";
  @expose alt = "";
  @expose editFolder = "";
  /**
   * The file chosen in the browser.
   *
   * A bound file input POSTs its bytes separately and leaves a temporary upload
   * here, so a large file never has to fit in a WebSocket frame — and the panel
   * only has to move it once it knows where it belongs.
   */
  @expose upload: unknown = null;

  private get _panel(): PanelInstance {
    return (this.constructor as typeof MediaPage).panel ?? Panel.current();
  }

  private _items: MediaItem[] = [];

  /**
   * Store the file once its bytes have arrived.
   *
   * A bound file input starts an HTTP upload on `change` and only sets the
   * signed reference when that finishes, so an action fired from `change` runs
   * while the property is still empty and silently stores nothing.
   */
  override async onUpdated(prop: string, _value: unknown): Promise<void> {
    if (prop === "upload") await this.uploadFile();
  }

  @expose async uploadFile(): Promise<void> {
    const provider = this._panel.mediaProvider();
    if (!provider || !this.upload) return;

    if (!isUpload(this.upload)) {
      this.flash("That file could not be read.", "warning");
      return;
    }

    const [ok, result] = await storeMedia(this.upload, {
      provider,
      ...(this.folder ? { folder: this.folder } : {}),
      ...(this._panel.mediaDisk() ? { disk: this._panel.mediaDisk()! } : {}),
    });
    // Cleared either way — a failed upload should not sit in the form waiting to
    // be retried against the same error.
    this.upload = null;
    this.flash(
      ok ? `${(result as MediaItem).name} uploaded.` : (result as string),
      ok ? "success" : "warning",
    );
  }

  @expose openDetails(id: unknown): void {
    const item = this._items.find((i) => i.id === String(id));
    if (!item) return;
    this.editing = item.id;
    this.alt = item.alt ?? "";
    this.editFolder = item.folder ?? "";
  }

  @expose closeDetails(): void {
    this.editing = "";
  }

  @expose async saveDetails(): Promise<void> {
    const provider = this._panel.mediaProvider();
    if (!provider?.update || !this.editing) return;
    await provider.update(this.editing, { alt: this.alt, folder: this.editFolder });
    this.editing = "";
    this.flash("Details saved.", "success");
  }

  @expose async remove(id: unknown): Promise<void> {
    const provider = this._panel.mediaProvider();
    const item = this._items.find((i) => i.id === String(id));
    if (!provider || !item) return;

    const [ok, message] = await deleteMedia(item, {
      provider,
      ...(this._panel.mediaDisk() ? { disk: this._panel.mediaDisk()! } : {}),
    });
    if (this.editing === item.id) this.editing = "";
    this.flash(ok ? `${item.name} removed.` : message!, ok ? "success" : "warning");
  }

  @expose loadMore(): void {
    this.limit += PAGE_SIZE;
  }

  override async render(): Promise<HtmlNode> {
    const provider = this._panel.mediaProvider();
    const base = this._panel.base();

    this._items = provider
      ? await provider.list({
          limit: this.limit,
          ...(this.folder ? { folder: this.folder } : {}),
          ...(this.search ? { search: this.search } : {}),
        })
      : [];

    // Resolved up front: a URL may need the storage disk, and doing that inside
    // the grid would mean an await per tile.
    const urls = new Map(
      await Promise.all(
        this._items.map(async (i) => [i.id, await mediaUrl(i, this._panel.mediaDisk())] as const),
      ),
    );
    // Folders come from what is actually filed, so the filter never offers an
    // empty one.
    const folders = [...new Set(this._items.map((i) => i.folder).filter(Boolean))].sort();
    const open = this._items.find((i) => i.id === this.editing);

    return (
      <div class="space-y-6">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <nav class="mb-1 text-xs text-muted-foreground">
              <a href={base} navigate class="hover:text-foreground">
                Dashboard
              </a>
              <span class="mx-1">/</span>
              <span>Media</span>
            </nav>
            <h1 class="text-2xl font-semibold tracking-tight">Media</h1>
            <p class="mt-1 text-sm text-muted-foreground">
              {this._items.length === 0
                ? "Nothing uploaded yet."
                : `${this._items.length} file${this._items.length === 1 ? "" : "s"}`}
            </p>
          </div>

          <label class="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90">
            <Icon name="upload" class="h-4 w-4" />
            Upload
            <input
              type="file"
              class="hidden"
              {...{ "flow:model": "upload" }}
              onChange={this.uploadFile}
            />
          </label>
        </div>

        {!provider ? (
          <div class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No media provider is configured for this panel.
          </div>
        ) : (
          <>
            <div class="flex flex-wrap items-center gap-2">
              <div class="relative max-w-sm flex-1">
                <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                  <Icon name="search" class="h-4 w-4" />
                </span>
                <input
                  {...{ "flow:model.live": "search" }}
                  placeholder="Search files…"
                  class="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
                />
              </div>
              {folders.length > 0 ? (
                <select
                  {...{ "flow:model.live": "folder" }}
                  class="h-9 rounded-lg border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">All folders</option>
                  {folders.map((f) => (
                    <option value={f} selected={f === this.folder}>
                      {f}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            {this._items.length === 0 ? (
              <div class="rounded-lg border border-dashed border-border p-10 text-center">
                <Icon name="image" class="mx-auto h-8 w-8 text-muted-foreground" />
                <p class="mt-3 text-sm font-medium">No files here</p>
                <p class="mt-1 text-sm text-muted-foreground">
                  Upload one, and it becomes reusable everywhere in the panel.
                </p>
              </div>
            ) : (
              <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                {this._items.map((item) => (
                  <button
                    type="button"
                    {...{ "flow:key": item.id }}
                    onClick={this.openDetails}
                    data-args={JSON.stringify([item.id])}
                    class="group overflow-hidden rounded-lg border border-border bg-card text-left transition hover:border-primary/50 hover:shadow-sm"
                  >
                    <div class="flex aspect-square items-center justify-center bg-muted/40">
                      {isImage(item) && urls.get(item.id) ? (
                        <img
                          src={urls.get(item.id)!}
                          alt={item.alt ?? item.name}
                          loading="lazy"
                          class="h-full w-full object-cover"
                        />
                      ) : (
                        <Icon name="file" class="h-8 w-8 text-muted-foreground" />
                      )}
                    </div>
                    <div class="p-2">
                      <p class="truncate text-xs font-medium" title={item.name}>
                        {item.name}
                      </p>
                      <p class="text-[11px] text-muted-foreground">{formatSize(item.size)}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Only offered when the page is full — otherwise there is nothing more. */}
            {this._items.length >= this.limit ? (
              <div class="text-center">
                <button
                  type="button"
                  onClick={this.loadMore}
                  class="inline-flex h-9 items-center rounded-lg border border-input px-4 text-sm font-medium transition hover:bg-accent"
                >
                  Load more
                </button>
              </div>
            ) : null}
          </>
        )}

        {/* Details panel for the selected file. */}
        {open ? (
          <div class="fixed inset-y-0 right-0 z-40 w-full max-w-sm overflow-y-auto border-l border-border bg-card p-5 shadow-xl">
            <div class="flex items-start justify-between gap-3">
              <h2 class="text-sm font-semibold break-all">{open.name}</h2>
              <button
                type="button"
                onClick={this.closeDetails}
                aria-label="Close"
                class="rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <Icon name="x" class="h-4 w-4" />
              </button>
            </div>

            {isImage(open) && urls.get(open.id) ? (
              <img
                src={urls.get(open.id)}
                alt={open.alt ?? open.name}
                class="mt-4 w-full rounded-lg border border-border object-contain"
              />
            ) : null}

            <dl class="mt-4 space-y-1 text-xs text-muted-foreground">
              <div class="flex justify-between gap-3">
                <dt>Type</dt>
                <dd class="text-foreground">{open.mime}</dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt>Size</dt>
                <dd class="text-foreground">{formatSize(open.size)}</dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt>Path</dt>
                <dd class="break-all text-foreground">{open.path}</dd>
              </div>
            </dl>

            <div class="mt-5 space-y-3">
              <label class="block">
                <span class="mb-1 block text-xs font-medium">Alt text</span>
                <input
                  {...{ "flow:model": "alt" }}
                  placeholder="What the image shows"
                  class="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs font-medium">Folder</span>
                <input
                  {...{ "flow:model": "editFolder" }}
                  placeholder="products"
                  class="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            </div>

            <div class="mt-5 flex items-center gap-2">
              <button
                type="button"
                onClick={this.saveDetails}
                class="inline-flex h-9 flex-1 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                Save
              </button>
              <button
                type="button"
                onClick={this.remove}
                data-args={JSON.stringify([open.id])}
                confirm="Delete this file? Anything still pointing at it will break."
                class="inline-flex h-9 items-center justify-center rounded-lg border border-destructive/40 px-3 text-sm font-medium text-destructive transition hover:bg-destructive/10"
              >
                <Icon name="trash" class="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }
}

/**
 * Build a MediaPage bound to one panel.
 *
 * @internal
 */
export function makeMediaPage(panel: PanelInstance = Panel.default()): typeof MediaPage {
  return class BoundMediaPage extends MediaPage {
    static override panel = panel;
  };
}
