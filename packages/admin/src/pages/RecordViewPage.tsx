/** @jsxImportSource @zerotal/flow */
// The View page for a single record: an infolist — sections of labeled entries
// (badges, icons, dates, copy-to-clipboard, …) laid out in a responsive grid.
// The schema comes from `Resource.infolist()`, falling back to one section
// derived from `columns()`. The record id comes from the `/admin/{slug}/:id`
// route param, seeded once in onMount() and held on a @locked field so the
// reactive Delete action survives WS round-trips.

import { Component, locked, expose } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import type { HttpContext } from "@zerotal/core";
import { Table } from "@zerotal/flow-ui";
import type { TableColumn } from "@zerotal/flow-ui";
import { AdminLayout, makeAdminLayout } from "../ui/AdminLayout.tsx";
import { Breadcrumbs, resourceTrail } from "../ui/Breadcrumbs.tsx";
import { Icon } from "../ui/icons.tsx";
import { resolveRenderHooks } from "../renderHooks.ts";
import { recordHistory, revertPayload } from "../history.ts";
import type { HistoryEntry } from "../history.ts";
import type { ResourceClass } from "../Panel.ts";
import { Panel } from "../Panel.ts";
import type { PanelInstance } from "../PanelInstance.ts";
import type { Column, BadgeTone } from "../table/Column.ts";
import type { RecordPage, AdminRecord } from "../Resource.ts";
import type { RelationManager } from "../relations/RelationManager.ts";
import {
  ActionGroup,
  flattenActions,
  renderAction,
  renderActionGroup,
  restoreAction,
  forceDeleteAction,
} from "../actions/index.ts";
import type { ActionContext, ActionPage } from "../actions/index.ts";
import { resolveInfolist } from "../infolist/index.ts";
import type { EntryDisplay, EntrySize, EntryWeight } from "../infolist/index.ts";
import { resolveMediaSrc } from "../media.ts";
import {
  assertCan,
  assertActionAllowed,
  resolveDeclaredRelation,
  resolveDeclaredRelationByName,
  AdminForbiddenError,
} from "../support/authorize.ts";

const BADGE_CLASS: Record<BadgeTone, string> = {
  default: "bg-secondary text-secondary-foreground",
  primary: "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20",
  success: "bg-success/10 text-success ring-1 ring-inset ring-success/20",
  muted: "bg-muted text-muted-foreground",
  destructive: "bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20",
};

const TONE_TEXT: Record<BadgeTone, string> = {
  default: "text-foreground",
  primary: "text-primary",
  success: "text-success",
  muted: "text-muted-foreground",
  destructive: "text-destructive",
};

const WEIGHT_CLASS: Record<EntryWeight, string> = {
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
};

const SIZE_CLASS: Record<EntrySize, string> = {
  sm: "text-xs",
  base: "text-sm",
  lg: "text-base",
};

// Responsive grid templates for sections (1–4 columns) and entry spans.
const COLS_CLASS = [
  "grid-cols-1",
  "grid-cols-1",
  "grid-cols-1 sm:grid-cols-2",
  "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
];
const SPAN_CLASS = ["", "", "sm:col-span-2", "sm:col-span-3", "sm:col-span-4"];

/**
 * The pivot object a BelongsToMany relation method returns when called without
 * eager-loading. Reached by name off a model instance, so the methods are
 * optional: the page checks each one before calling it, and a relation that is
 * not many-to-many has none of them.
 */
interface PivotProxy {
  attach?: (id: unknown) => unknown;
  detach?: (id: unknown) => unknown;
  get?: () => unknown;
  all?: () => unknown;
}

export class RecordViewPage extends Component {
  static layout = AdminLayout;
  /** Set by each generated subclass. */
  static resource: ResourceClass;
  /** The panel this page belongs to — set by each generated subclass. */
  static panel: PanelInstance;

  @locked recordId = "";
  /** The parent record's id, for a resource nested under another. */
  @locked parentId = "";

  private get _resource(): ResourceClass {
    return (this.constructor as unknown as { resource: ResourceClass }).resource;
  }

  /**
   * The panel this page was generated for. Held on the class rather than resolved
   * from the request, so WebSocket actions — which carry no URL — stay on it.
   */
  private get _panel(): PanelInstance {
    return (this.constructor as typeof RecordViewPage).panel ?? Panel.current();
  }

  override async onMount(ctx?: HttpContext): Promise<void> {
    const R = this._resource;
    const parent = R.parent;
    if (parent) {
      const rawParent = ctx?.params?.[R.parentParam()];
      if (rawParent != null) {
        this.parentId = String(
          rawParent && typeof rawParent === "object"
            ? (rawParent as Record<string, unknown>)[R.parentResource()!.primaryKey]
            : rawParent,
        );
      }
    }
    const raw = ctx?.params?.[R.primaryKey] ?? ctx?.params?.["id"];
    if (raw == null) return; // keep any pre-seeded id (e.g. tests)
    // An implicitly-bound model resolves to an object; otherwise it's the raw segment.
    this.recordId = String(
      raw && typeof raw === "object" ? (raw as Record<string, unknown>)[R.primaryKey] : raw,
    );
  }

  /** Where "back to the list" goes — inside the parent record, when nested. */
  private _listHref(): string {
    return this._resource.indexUrl(this._panel.base(), this.parentId || undefined);
  }

  @expose async deleteRecord(): Promise<void> {
    const R = this._resource;
    const current = (await R.find(this.recordId)) as Record<string, unknown> | null;
    assertCan(R, "delete", current ?? undefined);
    const ok = await R.destroy(this.recordId);
    const listHref = this._listHref();
    if (ok) this.redirect(listHref).withSuccess(`${R.getLabel()} deleted.`);
    else this.redirect(listHref).withWarning("That record no longer exists.");
  }

  private _ctx(record?: Record<string, unknown>): ActionContext {
    const R = this._resource;
    return {
      resource: R,
      page: this as unknown as ActionPage,
      base: this._panel.base(),
      slug: R.getSlug(),
      panelId: this._panel.id,
      parentId: this.parentId || undefined,
      record: record as AdminRecord | undefined,
    };
  }

  /** Run a record action (e.g. Delete) from the View header; leaves to the list if the record is gone. */
  @expose async runAction(key: unknown): Promise<void> {
    const R = this._resource;
    // Include Restore / Force-delete as candidates for soft-delete resources.
    const candidates = flattenActions(
      R.usesSoftDeletes()
        ? [...R.recordActions(), restoreAction(), forceDeleteAction()]
        : R.recordActions(),
    );
    const act = candidates.find((a) => a._key === key);
    if (!act?._handler) return;
    const record = await R.find(this.recordId);
    const ctx = this._ctx((record as Record<string, unknown>) ?? undefined);
    // Same gate the header renderer applies when deciding to draw the button.
    assertActionAllowed(act, record as Record<string, unknown> | undefined, ctx);
    await act.execute(ctx);
    // After a destructive action the record may no longer exist — return to the list.
    if (!(await R.find(this.recordId))) {
      this.redirect(this._listHref());
    }
  }

  /**
   * Put a record back to how it was before one recorded change.
   *
   * Authorised as an update, because that is exactly what it is — reverting is
   * not a separate power from editing, and treating it as one would let someone
   * rewrite a record they may not edit.
   */
  @expose async revertChange(entryId: unknown): Promise<void> {
    const R = this._resource;
    const record = (await R.find(this.recordId)) as Record<string, unknown> | null;
    assertCan(R, "update", record ?? undefined);

    const entries = await this._history();
    const entry = entries.find((e) => e.id === String(entryId));
    if (!entry?.revertible) {
      this.flash("That change can no longer be reverted.", "warning");
      return;
    }

    await R.update(this.recordId, revertPayload(entry));
    this.flash(`Reverted ${entry.changes.length} field${entry.changes.length === 1 ? "" : "s"}.`);
  }

  /** This record's history, or an empty list when the resource didn't ask for it. */
  private async _history(): Promise<HistoryEntry[]> {
    const R = this._resource;
    if (!R.history || !this.recordId) return [];
    return recordHistory({ type: R.getModelName(), id: this.recordId });
  }

  /** The history card, or nothing when there is no history to show. */
  private _historyCard(entries: HistoryEntry[]): HtmlNode | null {
    if (entries.length === 0) return null;
    return (
      <div class="rounded-xl border border-border bg-card text-card-foreground shadow-sm">
        <div class="flex items-center gap-2 border-b border-border px-5 py-3">
          <Icon name="calendar" class="h-4 w-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold tracking-tight">History</h2>
          <span class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {entries.length}
          </span>
        </div>
        <ol class="divide-y divide-border">
          {entries.map((entry) => (
            <li class="px-5 py-3">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    entry.event === "deleted"
                      ? BADGE_CLASS.destructive
                      : entry.event === "created"
                        ? BADGE_CLASS.success
                        : BADGE_CLASS.muted
                  }`}
                >
                  {entry.event}
                </span>
                <span class="text-sm">{entry.actor ?? "System"}</span>
                <span class="text-xs text-muted-foreground">{entry.at}</span>
                {entry.revertible ? (
                  <button
                    type="button"
                    onClick={this.revertChange}
                    data-args={JSON.stringify([entry.id])}
                    confirm="Put these fields back to their previous values?"
                    class="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs font-medium transition hover:bg-accent hover:text-accent-foreground"
                  >
                    <Icon name="undo" class="h-3.5 w-3.5" /> Revert
                  </button>
                ) : null}
              </div>
              {entry.changes.length > 0 ? (
                <dl class="mt-2 space-y-1">
                  {entry.changes.map((c) => (
                    <div class="flex flex-wrap items-baseline gap-2 text-xs">
                      <dt class="font-medium text-muted-foreground">{c.field}</dt>
                      <dd class="text-muted-foreground/70 line-through">
                        {stringifyValue(c.from)}
                      </dd>
                      <span class="text-muted-foreground">→</span>
                      <dd>{stringifyValue(c.to)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  // ── Entry rendering ────────────────────────────────────────────────────────

  private _value(d: EntryDisplay): HtmlNode | string {
    // A custom renderer takes the value outright — checked before the
    // placeholder, since "empty" may be exactly what it wants to draw.
    if (d.custom) return d.custom(d.raw, d.row);

    if (d.isPlaceholder) {
      return <span class="text-muted-foreground/70">{d.text}</span>;
    }

    if (d.kind === "icon" && d.boolean !== null) {
      const tone = d.tone ?? (d.boolean ? "success" : "muted");
      return (
        <span class={`inline-flex items-center gap-1.5 ${TONE_TEXT[tone]}`}>
          <Icon name={d.boolean ? "check-circle" : "x-circle"} class="h-5 w-5" />
          <span class="text-sm">{d.text}</span>
        </span>
      );
    }

    if (d.kind === "image") {
      // A disk-relative path has to be resolved; printing it makes the browser
      // fetch it relative to this record's own URL.
      const src = resolveMediaSrc(d.text, this._panel.mediaDisk());
      if (!src) return <span class="text-sm text-muted-foreground">—</span>;
      return (
        <img
          src={src}
          alt={d.label}
          loading="lazy"
          style={`height:${d.imageHeight}px`}
          class={`mt-0.5 w-auto object-cover ${d.circular ? "rounded-full" : "rounded-md"} border border-border`}
        />
      );
    }

    if (d.kind === "color") {
      return (
        <span class="inline-flex items-center gap-2">
          <span
            style={`background:${d.text}`}
            class="inline-block h-5 w-5 shrink-0 rounded-md border border-border"
          />
          <span class="font-mono text-sm">{d.text}</span>
        </span>
      );
    }

    if (d.kind === "code") {
      return (
        <div class="mt-0.5 overflow-hidden rounded-lg border border-border bg-muted/40">
          {d.language ? (
            <div class="border-b border-border px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {d.language}
            </div>
          ) : null}
          <pre class="overflow-x-auto p-3 text-xs leading-relaxed">{d.text}</pre>
        </div>
      );
    }

    if (d.kind === "keyValue") {
      return (
        <dl class="mt-0.5 divide-y divide-border overflow-hidden rounded-lg border border-border">
          {d.pairs.map((p) => (
            <div class="flex gap-3 px-3 py-1.5 text-sm">
              <dt class="w-1/3 shrink-0 truncate font-medium text-muted-foreground">{p.key}</dt>
              <dd class="min-w-0 flex-1 break-words">{p.value}</dd>
            </div>
          ))}
        </dl>
      );
    }

    if (d.kind === "repeatable") {
      return (
        <div class="mt-0.5 space-y-2">
          {d.items.map((item, i) => (
            <div class="rounded-lg border border-border bg-background/60 p-3">
              <div class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                #{i + 1}
              </div>
              <div class="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {item.map((nested) => (
                  <div>
                    <div class="text-xs font-medium text-muted-foreground">{nested.label}</div>
                    <div class="mt-0.5">{this._value(nested)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }

    let body: HtmlNode | string;
    if (d.badge) {
      const tone = d.tone ?? "default";
      body = (
        <span
          class={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_CLASS[tone]}`}
        >
          {d.icon ? <Icon name={d.icon} class="h-3.5 w-3.5" /> : null}
          {d.text}
        </span>
      );
    } else {
      const tone = d.tone ? TONE_TEXT[d.tone] : "text-foreground";
      const content = d.href ? (
        <a href={d.href} navigate class="text-primary underline-offset-2 hover:underline">
          {d.text}
        </a>
      ) : (
        d.text
      );
      body = (
        <span
          class={`inline-flex items-center gap-1.5 ${WEIGHT_CLASS[d.weight]} ${SIZE_CLASS[d.size]} ${tone}`}
        >
          {d.icon ? <Icon name={d.icon} class="h-4 w-4 text-muted-foreground" /> : null}
          {content}
        </span>
      );
    }

    if (!d.copyValue) return body;
    return (
      <span class="inline-flex items-center gap-1.5">
        {body}
        <button
          type="button"
          data-copy={d.copyValue}
          onclick="window.__zerotalCopy(this)"
          title="Copy"
          class="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-accent-foreground [&[data-copied]]:text-success"
        >
          <Icon name="copy" class="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  private _entryBlock(d: EntryDisplay): HtmlNode {
    return (
      <div class={SPAN_CLASS[Math.min(d.columnSpan, 4)]} title={d.tooltip ?? undefined}>
        <dt class="text-xs font-medium uppercase tracking-wide text-muted-foreground/80">
          {d.label}
        </dt>
        <dd class="mt-1">{this._value(d)}</dd>
      </div>
    );
  }

  // ── Relation managers ──────────────────────────────────────────────────────

  private _relCell(col: Column, row: Record<string, unknown>): HtmlNode | string {
    const { text, badge } = col.cell(row);
    if (!badge) return text;
    return (
      <span
        class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_CLASS[badge]}`}
      >
        {text}
      </span>
    );
  }

  /** Render one HasMany relation manager as a card with a linked table. */
  /** Delete a related (child) record from a relation table, then re-render. */
  @expose async deleteRelated(slug: unknown, id: unknown): Promise<void> {
    // `slug` used to go straight to Panel.find(), which resolves ANY registered resource — so
    // from /admin/posts/1 a crafted frame could call deleteRelated("users", 1) and destroy an
    // unrelated record. Resolve strictly from this resource's declared relations instead, and
    // check the ability on the related resource.
    const rel = resolveDeclaredRelation(this._resource, String(slug));
    if (!rel) throw new AdminForbiddenError(`"${String(slug)}" is not a relation of this record`);
    const related = rel._resource;
    const child = (await related.find(id)) as Record<string, unknown> | null;
    assertCan(related, "delete", child ?? undefined);
    if (await related.destroy(id)) this.flash(`${related.getLabel()} deleted.`);
    else this.flash("That record no longer exists.", "warning");
  }

  // ── BelongsToMany (attach / detach via the parent's pivot) ───────────────────

  /** Pending "attach" selection per relation method. */
  @expose attachDraft: Record<string, string> = {};

  /** Resolve a parent model *instance* and its relation object by method name. */
  private async _relation(relationName: string): Promise<PivotProxy | null> {
    const model = this._resource.model as unknown as {
      find?: (id: unknown) => Promise<Record<string, unknown> | null>;
    };
    if (typeof model?.find !== "function") return null;
    const parent = (await model.find(this.recordId)) as Record<string, unknown> | null;
    const fn = parent && (parent as Record<string, unknown>)[relationName];
    if (typeof fn !== "function") return null;
    return (fn as () => unknown).call(parent) as PivotProxy;
  }

  /** Load the rows currently attached through a BelongsToMany relation. */
  private async _attachedRows(relationName: string): Promise<Record<string, unknown>[]> {
    const rel = await this._relation(relationName);
    if (!rel) return [];
    const getter = rel.get ?? rel.all;
    if (typeof getter !== "function") return [];
    const rows = (await getter.call(rel)) as Record<string, unknown>[] | undefined;
    return rows ?? [];
  }

  /** Attach the selected related record to the parent via the pivot. */
  @expose async attachRelated(relationName: unknown): Promise<void> {
    const name = String(relationName);
    // The raw name was invoked as a method on the parent model, so any zero-argument method
    // reachable there could be called. Accept only names this resource declares as attachable.
    const declared = resolveDeclaredRelationByName(this._resource, name);
    if (!declared) throw new AdminForbiddenError(`"${name}" is not an attachable relation`);
    assertCan(this._resource, "update");
    const id = this.attachDraft[name];
    if (!id) return;
    const rel = await this._relation(name);
    if (rel && typeof rel.attach === "function") {
      await rel.attach(id);
      this.flash("Attached.");
    }
    this.attachDraft = { ...this.attachDraft, [name]: "" };
  }

  /** Detach a related record from the parent via the pivot. */
  @expose async detachRelated(relationName: unknown, id: unknown): Promise<void> {
    const name = String(relationName);
    const declared = resolveDeclaredRelationByName(this._resource, name);
    if (!declared) throw new AdminForbiddenError(`"${name}" is not an attachable relation`);
    assertCan(this._resource, "update");
    const rel = await this._relation(name);
    if (rel && typeof rel.detach === "function") {
      await rel.detach(id);
      this.flash("Detached.");
    }
  }

  private _relationCard(rel: RelationManager, result: RecordPage, parentId: unknown): HtmlNode {
    const base = this._panel.base();
    const related = rel._resource;
    // A related resource that declares this one as its parent has its own nested
    // pages, so its links go through the parent record rather than to a bare
    // top-level list.
    const relBase = related.indexUrl(base, parentId);
    const iconBtn =
      "inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition";

    const tableColumns: TableColumn[] = related.columns().map((c) => ({
      key: c._key,
      label: c.getLabel(),
      class: c._align === "end" ? "text-right" : c._align === "center" ? "text-center" : undefined,
      render: (row: Record<string, unknown>) => this._relCell(c, row),
    }));
    // Row actions: View, Edit (if editable), Delete.
    tableColumns.push({
      key: "__actions",
      label: "",
      class: "w-1 whitespace-nowrap text-right",
      render: (row: Record<string, unknown>) => {
        const id = String(row[related.primaryKey]);
        return (
          <div class="flex items-center justify-end gap-1">
            <a
              href={`${relBase}/${id}`}
              navigate
              title="View"
              class={`${iconBtn} hover:bg-accent hover:text-accent-foreground`}
            >
              <Icon name="eye" class="h-4 w-4" />
            </a>
            {related.isEditable() ? (
              <a
                href={`${relBase}/${id}/edit`}
                navigate
                title="Edit"
                class={`${iconBtn} hover:bg-accent hover:text-accent-foreground`}
              >
                <Icon name="pencil" class="h-4 w-4" />
              </a>
            ) : null}
            <button
              type="button"
              onClick={this.deleteRelated}
              data-args={JSON.stringify([related.getSlug(), id])}
              confirm="Delete this record? This cannot be undone."
              title="Delete"
              class={`${iconBtn} hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive`}
            >
              <Icon name="trash" class="h-4 w-4" />
            </button>
          </div>
        );
      },
    });

    return (
      <div class="rounded-xl border border-border bg-card text-card-foreground shadow-sm">
        <div class="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 class="flex items-center gap-2 text-sm font-semibold tracking-tight">
            {rel._icon ? <Icon name={rel._icon} class="h-4 w-4 text-muted-foreground" /> : null}
            {rel.getTitle()}
            <span class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {result.total}
            </span>
          </h2>
          {related.isEditable() && rel._canCreate ? (
            <a
              href={
                // A nested resource takes the parent from the URL; a plain one
                // needs the foreign key seeded through the query string.
                related.parent
                  ? related.createUrl(base, parentId)
                  : `${relBase}/create?${rel._foreignKey}=${encodeURIComponent(String(parentId))}`
              }
              navigate
              class="inline-flex h-8 items-center gap-1 rounded-lg border border-input bg-background px-3 text-xs font-medium transition hover:bg-accent hover:text-accent-foreground"
            >
              <Icon name="plus" class="h-3.5 w-3.5" /> New
            </a>
          ) : null}
        </div>
        <div class="overflow-x-auto p-1.5">
          {result.rows.length > 0 ? (
            <Table columns={tableColumns} rows={result.rows} hover />
          ) : (
            <p class="px-4 py-8 text-center text-sm text-muted-foreground">
              No {related.getPluralLabel().toLowerCase()} yet.
            </p>
          )}
        </div>
      </div>
    );
  }

  /** Render a BelongsToMany relation: attached rows + Detach + an Attach picker. */
  private _btmCard(
    rel: RelationManager,
    rows: Record<string, unknown>[],
    options: Record<string, unknown>[],
  ): HtmlNode {
    const base = this._panel.base();
    const related = rel._resource;
    // Many-to-many has no single owning record, so these always link to the
    // related resource's own top-level pages.
    const relBase = related.indexUrl(base);
    const iconBtn =
      "inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition";

    const tableColumns: TableColumn[] = related.columns().map((c) => ({
      key: c._key,
      label: c.getLabel(),
      class: c._align === "end" ? "text-right" : c._align === "center" ? "text-center" : undefined,
      render: (row: Record<string, unknown>) => this._relCell(c, row),
    }));
    // Pivot columns (read from `row.pivot` when present).
    for (const pc of rel._pivotColumns) {
      tableColumns.push({
        key: `pivot.${pc.key}`,
        label: pc.label ?? titleCasePivot(pc.key),
        render: (row: Record<string, unknown>) => {
          const pivot = (row["pivot"] as Record<string, unknown> | undefined) ?? row;
          const v = pivot?.[pc.key];
          return v == null ? "—" : String(v);
        },
      });
    }
    tableColumns.push({
      key: "__actions",
      label: "",
      class: "w-1 whitespace-nowrap text-right",
      render: (row: Record<string, unknown>) => {
        const id = String(row[related.primaryKey]);
        return (
          <div class="flex items-center justify-end gap-1">
            <a
              href={`${relBase}/${id}`}
              navigate
              title="View"
              class={`${iconBtn} hover:bg-accent hover:text-accent-foreground`}
            >
              <Icon name="eye" class="h-4 w-4" />
            </a>
            {rel._canAttach ? (
              <button
                type="button"
                onClick={this.detachRelated}
                data-args={JSON.stringify([rel._relationName, id])}
                confirm="Detach this record?"
                title="Detach"
                class={`${iconBtn} hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive`}
              >
                <Icon name="x-circle" class="h-4 w-4" />
              </button>
            ) : null}
          </div>
        );
      },
    });

    const relName = rel._relationName ?? "";

    return (
      <div class="rounded-xl border border-border bg-card text-card-foreground shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 class="flex items-center gap-2 text-sm font-semibold tracking-tight">
            {rel._icon ? <Icon name={rel._icon} class="h-4 w-4 text-muted-foreground" /> : null}
            {rel.getTitle()}
            <span class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {rows.length}
            </span>
          </h2>
          {rel._canAttach && options.length > 0 ? (
            <div class="flex items-center gap-2">
              <select
                value={this.attachDraft[relName]}
                class="h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none transition focus:ring-2 focus:ring-ring"
              >
                <option value="">Attach {related.getLabel().toLowerCase()}…</option>
                {options.map((o) => (
                  <option value={String(o[related.primaryKey])}>{related.recordTitle(o)}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={this.attachRelated}
                data-args={JSON.stringify([relName])}
                class="inline-flex h-8 items-center gap-1 rounded-lg border border-input bg-background px-3 text-xs font-medium transition hover:bg-accent hover:text-accent-foreground"
              >
                <Icon name="plus" class="h-3.5 w-3.5" /> Attach
              </button>
            </div>
          ) : null}
        </div>
        <div class="overflow-x-auto p-1.5">
          {rows.length > 0 ? (
            <Table columns={tableColumns} rows={rows} hover />
          ) : (
            <p class="px-4 py-8 text-center text-sm text-muted-foreground">
              No {related.getPluralLabel().toLowerCase()} attached yet.
            </p>
          )}
        </div>
      </div>
    );
  }

  override async render(): Promise<HtmlNode> {
    const R = this._resource;
    const base = this._panel.base();
    const listHref = `${base}/${R.getSlug()}`;
    const record = await R.find(this.recordId);

    if (!record) {
      return (
        <div class="mx-auto w-full max-w-3xl">
          <div class="rounded-xl border border-dashed border-border p-12 text-center">
            <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Icon name="collection" class="h-6 w-6" />
            </div>
            <p class="mt-3 text-sm font-medium">Record not found</p>
            <a
              href={listHref}
              navigate
              class="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary"
            >
              <Icon name="chevron-left" class="h-4 w-4" /> Back to{" "}
              {R.getPluralLabel().toLowerCase()}
            </a>
          </div>
        </div>
      );
    }

    const sections = resolveInfolist(R.infolist(), R.columns());
    // Resolved here rather than inside the card so a failing audit query
    // can't take the record page down with it.
    const historyCard = this._historyCard(await this._history());
    const title = String(record["name"] ?? record["title"] ?? record[R.primaryKey] ?? "Record");

    // Load each relation manager's records. HasMany scopes children by foreign key;
    // BelongsToMany resolves the attached rows (+ unattached options) via the pivot.
    const parentId = record[R.primaryKey];
    const relations = await Promise.all(
      R.relations().map(async (rel) => {
        if (rel.isBelongsToMany()) {
          const rows = await this._attachedRows(rel._relationName ?? "");
          const attachedIds = new Set(rows.map((r) => String(r[rel._resource.primaryKey])));
          const pool = await rel._resource.records({ perPage: rel._attachLimit });
          const options = pool.rows.filter(
            (r) => !attachedIds.has(String(r[rel._resource.primaryKey])),
          );
          return { rel, kind: "btm" as const, rows, options };
        }
        const result = await rel._resource.records({
          perPage: rel._perPage,
          modifyQuery: (q) => q.where(rel._foreignKey, parentId),
        });
        return { rel, kind: "hasMany" as const, result };
      }),
    );

    const sectionCard = (entries: HtmlNode[], columns: number): HtmlNode => (
      <dl class={`grid gap-x-6 gap-y-5 ${COLS_CLASS[Math.min(columns, 4)]}`}>{entries}</dl>
    );

    return (
      <div class="mx-auto w-full max-w-4xl space-y-6">
        {/* Header */}
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Breadcrumbs
              trail={resourceTrail({
                panel: this._panel,
                resource: R,
                parentId: this.parentId || undefined,
                recordId: this.recordId,
                recordTitle: title,
              })}
            />
            <h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
            <p class="mt-1 text-sm text-muted-foreground">
              {R.getLabel()} #{String(record[R.primaryKey] ?? "")}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <a
              href={listHref}
              navigate
              class="inline-flex h-9 items-center gap-1 rounded-lg border border-input bg-background px-3 text-sm font-medium transition hover:bg-accent hover:text-accent-foreground"
            >
              <Icon name="chevron-left" class="h-4 w-4" /> Back
            </a>
            {(() => {
              const trashed =
                R.usesSoftDeletes() &&
                (typeof (record as { trashed?: () => boolean }).trashed === "function"
                  ? (record as { trashed: () => boolean }).trashed()
                  : record["deleted_at"] != null);
              const ctx = this._ctx(record);
              if (trashed) {
                return [restoreAction(), forceDeleteAction()].map((a) =>
                  renderAction(a, ctx, { onRun: this.runAction, args: [a._key] }),
                );
              }
              // "View" is what this page already is, so it's dropped from its own header.
              return R.recordActions().map((a) =>
                a instanceof ActionGroup
                  ? renderActionGroup(a, ctx, {
                      onRun: this.runAction,
                      argsFor: (member) => [member._key],
                    })
                  : a._key === "view"
                    ? null
                    : renderAction(a, ctx, { onRun: this.runAction, args: [a._key] }),
              );
            })()}
          </div>
        </div>

        {resolveRenderHooks(this._panel.renderHooks("record.start"), {
          resource: R.getSlug(),
          page: "record",
          recordId: this.recordId,
        })}

        {/* Infolist sections */}
        {sections.map((s) => {
          const entries = s._entries.map((e) => this._entryBlock(e.display(record)));
          const header =
            s._heading || s._description ? (
              <div class="mb-4 flex items-start gap-2">
                {s._icon ? (
                  <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon name={s._icon} class="h-4 w-4" />
                  </span>
                ) : null}
                <div>
                  {s._heading ? (
                    <h2 class="text-sm font-semibold tracking-tight">{s._heading}</h2>
                  ) : null}
                  {s._description ? (
                    <p class="text-xs text-muted-foreground">{s._description}</p>
                  ) : null}
                </div>
              </div>
            ) : null;

          const cardClass =
            "rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-6";

          if (s._collapsible) {
            return (
              <details class={cardClass} open={!s._collapsed}>
                <summary class="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                  <div class="flex-1">
                    {header ?? <span class="text-sm font-semibold">Details</span>}
                  </div>
                  <Icon
                    name="chevron-down"
                    class="h-4 w-4 text-muted-foreground transition group-open:rotate-180"
                  />
                </summary>
                <div class="mt-4">{sectionCard(entries, s._columns)}</div>
              </details>
            );
          }

          return (
            <div class={cardClass}>
              {header}
              {sectionCard(entries, s._columns)}
            </div>
          );
        })}

        {/* Relation managers (HasMany children + BelongsToMany pivots) */}
        {relations.map((r) =>
          r.kind === "btm"
            ? this._btmCard(r.rel, r.rows, r.options)
            : this._relationCard(r.rel, r.result, record[R.primaryKey]),
        )}

        {/* What happened to this record, and putting it back. */}
        {historyCard}

        {resolveRenderHooks(this._panel.renderHooks("record.end"), {
          resource: R.getSlug(),
          page: "record",
          recordId: this.recordId,
        })}
      </div>
    );
  }
}

/**
 * Build a uniquely-named View page subclass bound to a resource — mirrors
 * {@link makeResourceListPage} so Flow keeps component identity stable.
 */
export function makeRecordViewPage(
  resource: ResourceClass,
  panel: PanelInstance = Panel.default(),
): typeof RecordViewPage {
  const Page = class extends RecordViewPage {
    static override resource = resource;
    static override panel = panel;
    static override layout = makeAdminLayout(panel);
  };
  Object.defineProperty(Page, "name", { value: `${resource.getModelName()}ViewPage` });
  return Page;
}

/** Render a history value compactly — objects as JSON, empties as a dash. */
function stringifyValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

/** Title-case a pivot column key for its default header label. */
function titleCasePivot(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
