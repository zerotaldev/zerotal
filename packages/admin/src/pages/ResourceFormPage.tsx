/** @jsxImportSource @zerotal/flow */
// Create / Edit page — a reactive form. Fields are declared on
// the resource (`form()`); a generated Flow Form (see form/ResourceForm)
// backs the binding + validation. Inputs author `flow:model="form.<key>"`
// directly (the same markup the compiler emits for `value={this.form.x}`), so
// edits round-trip into the exposed `form` object with zero per-field wiring.
//
// One page subclass is generated per resource (not per mode): the create/edit
// distinction is resolved from the route at runtime. Generating a *separate*
// subclass per mode would break Flow's field-decorator registration, which
// binds @expose/@locked fields to the first-constructed subclass's prototype.

import { Component, locked, expose } from "@zerotal/flow";
import type { HtmlNode, Form } from "@zerotal/flow";
import type { HttpContext } from "@zerotal/core";
import { makeAdminLayout } from "../ui/AdminLayout.tsx";
import { Breadcrumbs, resourceTrail } from "../ui/Breadcrumbs.tsx";
import type { MediaItem } from "../media.ts";
import { isImage, isUpload, mediaUrl, resolveMediaSrc, storeMedia } from "../media.ts";
import { Icon } from "../ui/icons.tsx";
import { resolveRenderHooks } from "../renderHooks.ts";
import type { ResourceClass } from "../Panel.ts";
import { Panel, DEFAULT_PANEL_ID } from "../Panel.ts";
import type { PanelInstance } from "../PanelInstance.ts";
import { adminHead } from "../theme.ts";
import type { Field, FieldMode, ResourceFormClass, SelectOption } from "../form/index.ts";
import {
  toFormLayout,
  flattenFields,
  type FormSection,
  type FormTabs,
  type Wizard,
  type FormSplit,
  type Callout,
  type CalloutTone,
  type Prime,
} from "../form/index.ts";
import { EDITOR_SCRIPT } from "../form/editors.ts";
import { RuleBuilder, runValidation } from "@zerotal/validator";
import type { Schema } from "@zerotal/validator";
import { Tabs } from "@zerotal/flow-ui";

/** A generated Form class + its visible fields, for one mode. */
export interface FormModeConfig {
  FormClass: ResourceFormClass;
  fields: Field[];
}

interface FormMeta {
  resource: ResourceClass;
  create: FormModeConfig;
  edit: FormModeConfig;
}

/**
 * Registry of per-resource form config, keyed by panel and slug. The page is a
 * single class (not a per-resource subclass) registered on every Create/Edit
 * route, so its @expose/@locked fields register on one prototype; it resolves
 * which resource it's serving from the route at runtime. Two panels may each
 * register a `users` resource, hence the panel id in the key.
 */
const _formRegistry = new Map<string, FormMeta>();

const formKey = (panelId: string, slug: string): string => `${panelId}:${slug}`;

/**
 * Register a resource's form config so the shared page can resolve it.
 *
 * @internal
 */
export function registerResourceForm(panelId: string, slug: string, meta: FormMeta): void {
  _formRegistry.set(formKey(panelId, slug), meta);
}

const SPAN_CLASS = ["", "", "sm:col-span-2", "sm:col-span-3", "sm:col-span-4"];
const INPUT_CLASS =
  "mt-1.5 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60";

/** @internal */
export class ResourceFormPage extends Component {
  @locked slug = "";
  @locked mode: FieldMode = "create";
  @locked recordId = "";
  /**
   * Which panel is being served. Locked rather than derived, so the WebSocket
   * round-trips that drive this page — which carry no URL — keep resolving the
   * same resource, base path and shell as the initial render.
   */
  @locked panelId = DEFAULT_PANEL_ID;
  /** The parent record's id, for a resource nested under another. */
  @locked parentId = "";
  /**
   * The record's version as it was when this form loaded, for a resource using
   * `optimisticLock`. Locked, so a WebSocket save compares against what was
   * actually rendered rather than whatever the client claims.
   */
  @locked loadedVersion = "";
  /** The locale being edited, for a resource with translatable fields. */
  @expose formLocale = "";
  /**
   * Every locale's value for each translatable field, as the record held them.
   *
   * Kept because the form only ever shows one locale: without the rest, saving
   * an English edit would write `{ en: "…" }` over a record that also had French
   * and German. Locked so the client cannot rewrite the locales it isn't editing.
   */
  @locked translations: Record<string, Record<string, unknown>> = {};
  /** Resolved select options (from `.optionsUsing()`), cached per render. */
  private _resolvedOptions: Record<string, SelectOption[]> = {};
  // Initialized here (not in onBoot) so the @expose field registration runs — the
  // decorator hooks the field initializer, and an uninitialized field would leave
  // `form` out of the exposed set, so client `form.*` syncs would be dropped. On
  // WebSocket round-trips the Form synth replaces this with the restored instance.
  @expose form: Form & Record<string, unknown> = {} as Form & Record<string, unknown>;

  /** The locale this form is editing. */
  private _locale(): string {
    const R = this._meta?.resource;
    return this.formLocale || R?.locales[0] || "en";
  }

  /**
   * Switch the locale being edited.
   *
   * The current locale's text is banked into the translation map first, so
   * switching tabs mid-edit does not throw the work away, then the new locale's
   * text is loaded into the same fields.
   */
  @expose switchLocale(code: unknown): void {
    const R = this._meta?.resource;
    if (!R) return;
    const next = String(code ?? "");
    if (!R.locales.includes(next) || next === this._locale()) return;

    const current = this._locale();
    for (const key of R.translatable) {
      const map = { ...(this.translations[key] ?? {}) };
      map[current] = (this.form as Record<string, unknown>)[key];
      this.translations[key] = map;
      (this.form as Record<string, unknown>)[key] = map[next] ?? "";
    }
    this.formLocale = next;
  }

  private get _meta(): FormMeta | undefined {
    return _formRegistry.get(formKey(this.panelId, this.slug));
  }

  /** The panel this page is serving. */
  private get _panel(): PanelInstance {
    return Panel.get(this.panelId) ?? Panel.default();
  }

  /**
   * The shell. Rendered through the instance hook rather than `static layout`,
   * because one class serves every panel and the shell differs per panel — the
   * layout marks its own identity so the client still swaps only the content
   * slot when navigating within a panel.
   */
  override layout(page: HtmlNode): Promise<HtmlNode> {
    return new (makeAdminLayout(this._panel))().render(page);
  }

  /** Stylesheet + theme tokens for the panel owning this request. */
  static get head(): string {
    const cfg = Panel.current().config();
    return adminHead(cfg.brand ?? "Admin", cfg.theme);
  }

  private get _cfg(): FormModeConfig | undefined {
    const meta = this._meta;
    return meta ? (this.mode === "edit" ? meta.edit : meta.create) : undefined;
  }

  /**
   * Work out which resource, mode and record the URL is asking for.
   *
   * A resource's index can sit at any depth — `products`, `shop/products`,
   * `posts/7/comments` — so rather than assuming the first segment names it, each
   * of the panel's resources is matched by its own route pattern. The longest
   * match wins, so `posts/7/comments/create` resolves to the nested comments
   * resource rather than to posts.
   */
  private async _resolveRoute(
    panel: PanelInstance,
    parts: string[],
    ctx?: HttpContext,
  ): Promise<void> {
    const candidates = panel
      .resources()
      .filter((r) => r.isEditable())
      .sort((a, b) => b.routePath().split("/").length - a.routePath().split("/").length);

    for (const R of candidates) {
      const pattern = R.routePath().split("/");
      if (parts.length < pattern.length) continue;

      let parentId = "";
      let matched = true;
      for (let i = 0; i < pattern.length; i++) {
        const segment = pattern[i]!;
        if (segment.startsWith(":")) {
          parentId = parts[i]!;
          continue;
        }
        if (segment !== parts[i]) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;

      const rest = parts.slice(pattern.length);
      // A singular resource has no create page and no id — its one row is the route.
      if (R.singular && rest.length === 0) {
        this.slug = R.getSlug();
        this.parentId = parentId;
        this.mode = "edit";
        const record = await R.singularRecord();
        this.recordId = String(record?.[R.primaryKey] ?? "");
        return;
      }
      if (rest.length === 1 && rest[0] === "create") {
        this.slug = R.getSlug();
        this.parentId = parentId;
        this.mode = "create";
        return;
      }
      if (rest.length === 2 && rest[1] === "edit") {
        this.slug = R.getSlug();
        this.parentId = parentId;
        this.mode = "edit";
        const pk = R.primaryKey;
        const raw = ctx?.params?.[pk] ?? ctx?.params?.["id"] ?? rest[0];
        if (raw != null) {
          this.recordId = String(
            raw && typeof raw === "object" ? (raw as Record<string, unknown>)[pk] : raw,
          );
        }
        return;
      }
    }
  }

  override async onMount(ctx?: HttpContext): Promise<void> {
    // Resolve which resource + mode this page serves from the route on the
    // initial GET; on round-trips these come from the snapshot, and tests seed
    // them via mount props.
    const path = ctx && typeof ctx.path === "function" ? ctx.path() : "";
    if (path) {
      const panel = Panel.forPath(path);
      this.panelId = panel.id;
      const base = panel.base();
      const rel = path.startsWith(base) ? path.slice(base.length) : path;
      await this._resolveRoute(panel, rel.split("/").filter(Boolean), ctx);
    }

    const cfg = this._cfg;
    if (!cfg) return;
    this.form = new cfg.FormClass();
    // Create: seed any field whose key matches a query param (e.g. a relation
    // manager's "New" link passing the parent foreign key — `?user_id=5`).
    if (this.mode === "create" && ctx) {
      const q = ctx as unknown as { query?: (key: string) => string | undefined };
      if (typeof q.query === "function") {
        for (const f of cfg.fields) {
          const qv = q.query(f._key);
          if (qv != null && qv !== "") (this.form as Record<string, unknown>)[f._key] = qv;
        }
      }
    }
    if (this.mode === "edit" && this.recordId) {
      const R = this._meta!.resource;
      const record = await R.find(this.recordId);
      if (record) {
        // Remember the version this form is editing from, for the concurrency
        // check on save.
        if (R.optimisticLock) {
          this.loadedVersion = String((record as Record<string, unknown>)[R.optimisticLock] ?? "");
        }
        const hydrated = R.mutateFormDataBeforeFill(record as Record<string, unknown>);
        // Split each translatable field into "the locale on screen" and "the rest".
        if (R.translatable.length > 0) {
          const locale = this._locale();
          for (const key of R.translatable) {
            const raw = hydrated[key];
            const map =
              raw != null && typeof raw === "object" && !Array.isArray(raw)
                ? { ...(raw as Record<string, unknown>) }
                : // A column that was never translated keeps its value under the
                  // default locale rather than being lost on the first save.
                  { [R.locales[0] ?? "en"]: raw };
            this.translations[key] = map;
            hydrated[key] = map[locale] ?? "";
          }
        }
        // Per-field hydration (e.g. key/value object → editable lines, csv → tags).
        for (const f of this._cfg!.fields) {
          if (f._key in hydrated) hydrated[f._key] = f.hydrate(hydrated[f._key]);
        }
        this.form.fill(hydrated);
      }
    }
  }

  /** Set a single field's value from the server (radio / native-control fallbacks). */
  @expose setField(key: unknown, value: unknown): void {
    (this.form as Record<string, unknown>)[String(key)] = value;
  }

  /** Toggle a value in an array-valued field (checkbox list / multiple select). */
  @expose toggleArrayValue(key: unknown, value: unknown): void {
    const k = String(key);
    const form = this.form as Record<string, unknown>;
    const current = Array.isArray(form[k]) ? (form[k] as unknown[]) : [];
    form[k] = current.includes(value) ? current.filter((x) => x !== value) : [...current, value];
  }

  /** Draft text for each tags input, keyed by field. */
  @expose tagDraft: Record<string, string> = {};

  /** Commit the current tag draft into a tags field's array. */
  @expose addTag(key: unknown): void {
    const k = String(key);
    const raw = (this.tagDraft[k] ?? "").trim();
    if (!raw) return;
    const form = this.form as Record<string, unknown>;
    const current = Array.isArray(form[k]) ? (form[k] as unknown[]) : [];
    if (!current.includes(raw)) form[k] = [...current, raw];
    this.tagDraft = { ...this.tagDraft, [k]: "" };
  }

  /** Remove a tag by index. */
  @expose removeTag(key: unknown, index: unknown): void {
    const k = String(key);
    const form = this.form as Record<string, unknown>;
    const current = Array.isArray(form[k]) ? (form[k] as unknown[]) : [];
    form[k] = current.filter((_, i) => i !== Number(index));
  }

  /** Clear a chosen file before it's stored. */
  /** The field a media picker is open for, or empty when it is closed. */
  @expose pickingFor = "";
  @expose pickerSearch = "";
  /**
   * A file chosen from inside the picker.
   *
   * Held on the page rather than on the form, because the form's exposed
   * properties are generated from the resource's declared fields — an extra key
   * on it is not part of the snapshot, so the upload's reference would be
   * dropped on the way back and the file would silently never arrive.
   */
  @expose mediaUpload: unknown = null;
  /** The library page, loaded per render while the picker is open. */
  private _mediaItems: MediaItem[] = [];
  private _mediaUrls: Record<string, string> = {};

  /**
   * Whether a chosen file should preview as an image.
   *
   * The catalogue's MIME type is the reliable answer; the extension is the
   * fallback for a value that predates the library, which should still show a
   * thumbnail rather than a generic document icon.
   */
  /** The library, as a modal grid to choose from. */
  private _mediaPicker(): HtmlNode {
    return (
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div class="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-card shadow-xl">
          <div class="flex items-center gap-3 border-b border-border p-4">
            <h2 class="text-sm font-semibold">Media library</h2>
            <input
              {...{ "flow:model.live": "pickerSearch" }}
              placeholder="Search…"
              class="ml-auto h-8 w-48 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <label class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-input px-3 text-sm font-medium transition hover:bg-accent">
              <Icon name="upload" class="h-4 w-4" />
              Upload
              <input type="file" class="hidden" flow:model="mediaUpload" />
            </label>
            <button
              type="button"
              onClick={this.closeMediaPicker}
              aria-label="Close"
              class="rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <Icon name="x" class="h-4 w-4" />
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-4">
            {this._mediaItems.length === 0 ? (
              <p class="py-10 text-center text-sm text-muted-foreground">
                {this.pickerSearch ? "Nothing matches that." : "The library is empty."}
              </p>
            ) : (
              <div class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                {this._mediaItems.map((item) => (
                  <button
                    type="button"
                    onClick={this.chooseMedia}
                    data-args={JSON.stringify([item.path])}
                    title={item.name}
                    class="overflow-hidden rounded-lg border border-border transition hover:border-primary hover:shadow-sm"
                  >
                    <div class="flex aspect-square items-center justify-center bg-muted/40">
                      {isImage(item) && this._mediaUrls[item.path] ? (
                        <img
                          src={this._mediaUrls[item.path]}
                          alt={item.alt ?? item.name}
                          loading="lazy"
                          class="h-full w-full object-cover"
                        />
                      ) : (
                        <Icon name="document" class="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>
                    <p class="truncate p-1.5 text-[11px]">{item.name}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  private _looksLikeImage(item: MediaItem | undefined, path: string): boolean {
    if (item) return isImage(item);
    return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(path);
  }

  @expose openMediaPicker(key: unknown): void {
    this.pickingFor = String(key);
    this.pickerSearch = "";
  }

  @expose closeMediaPicker(): void {
    this.pickingFor = "";
  }

  /** Choose a library file for the field the picker was opened from. */
  @expose chooseMedia(path: unknown): void {
    if (!this.pickingFor) return;
    (this.form as Record<string, unknown>)[this.pickingFor] = String(path);
    this.pickingFor = "";
  }

  /**
   * Store the file once its bytes have actually arrived.
   *
   * Driven by the property update rather than the input's `change` event, and
   * the difference is the whole bug: a bound file input starts an HTTP upload on
   * change and only sets the signed reference when that finishes. An action
   * fired from `change` therefore ran while the property was still empty, found
   * nothing to store, and returned silently — the file picker appeared to do
   * nothing at all.
   */
  override async onUpdated(prop: string, _value: unknown): Promise<void> {
    if (prop === "mediaUpload") await this.uploadToLibrary();
  }

  /** Upload straight into the library from the picker, and select the result. */
  @expose async uploadToLibrary(): Promise<void> {
    const provider = this._panel.mediaProvider();
    if (!provider || !isUpload(this.mediaUpload)) return;

    const [ok, result] = await storeMedia(this.mediaUpload, {
      provider,
      ...(this._panel.mediaDisk() ? { disk: this._panel.mediaDisk()! } : {}),
    });
    this.mediaUpload = null;
    if (!ok) {
      this.flash(result as string, "warning");
      return;
    }
    // Selecting it immediately is the point of uploading from inside a picker.
    if (this.pickingFor) {
      (this.form as Record<string, unknown>)[this.pickingFor] = (result as MediaItem).path;
      this.pickingFor = "";
    }
  }

  @expose removeFile(key: unknown): void {
    (this.form as Record<string, unknown>)[String(key)] = null;
  }

  // ── Repeater / Builder (nested object-arrays) ───────────────────────────────
  //
  // Each row carries a stable `__id`; sub-inputs bind to a *flat* draft object
  // (`repeaterDraft["<field>__<rowId>__<sub>"]`), the same pattern the list page
  // uses for inline cells. The draft round-trips via Flow's model binding; the
  // canonical array in `form[<field>]` is rebuilt from the drafts on save.

  /** Flat per-sub-input draft for repeater/builder rows. */
  @expose repeaterDraft: Record<string, unknown> = {};

  /** Composite draft key for a repeater sub-input. */
  private _repKey(field: string, rowId: unknown, sub: string): string {
    return `${field}__${rowId}__${sub}`;
  }

  /** Look up a (possibly nested) form field by key. */
  private _findField(key: string): Field | undefined {
    const R = this._meta?.resource;
    return R ? flattenFields(R.form()).find((f) => f._key === key) : undefined;
  }

  private _rows(field: string): Array<Record<string, unknown>> {
    const v = (this.form as Record<string, unknown>)[field];
    return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
  }

  /** Next stable row id — `max(existing) + 1` (survives WS round-trips). */
  private _nextRowId(rows: Array<Record<string, unknown>>): number {
    return rows.reduce((m, r) => Math.max(m, Number(r.__id) || 0), 0) + 1;
  }

  /** Append an empty repeater row (sub-fields seeded to their defaults). */
  @expose addRepeaterItem(key: unknown): void {
    const k = String(key);
    const field = this._findField(k);
    if (!field) return;
    const rows = [...this._rows(k)];
    if (field._maxItems != null && rows.length >= field._maxItems) return;
    const id = this._nextRowId(rows);
    const row: Record<string, unknown> = { __id: id };
    for (const sf of field._subfields) {
      row[sf._key] = sf.defaultValue();
      this.repeaterDraft[this._repKey(k, id, sf._key)] = row[sf._key];
    }
    (this.form as Record<string, unknown>)[k] = [...rows, row];
  }

  /** Append a builder block of the given type (its fields seeded to defaults). */
  @expose addBuilderBlock(key: unknown, blockName: unknown): void {
    const k = String(key);
    const name = String(blockName);
    const field = this._findField(k);
    const block = field?._blocks.find((b) => b.name === name);
    if (!field || !block) return;
    const rows = [...this._rows(k)];
    if (field._maxItems != null && rows.length >= field._maxItems) return;
    const id = this._nextRowId(rows);
    const row: Record<string, unknown> = { __id: id, __type: name };
    for (const sf of block._fields) {
      row[sf._key] = sf.defaultValue();
      this.repeaterDraft[this._repKey(k, id, sf._key)] = row[sf._key];
    }
    (this.form as Record<string, unknown>)[k] = [...rows, row];
  }

  /** Remove a repeater/builder row by id (and drop its drafts). */
  @expose removeRepeaterItem(key: unknown, rowId: unknown): void {
    const k = String(key);
    const id = Number(rowId);
    (this.form as Record<string, unknown>)[k] = this._rows(k).filter((r) => Number(r.__id) !== id);
    const prefix = `${k}__${id}__`;
    const next: Record<string, unknown> = {};
    for (const [dk, dv] of Object.entries(this.repeaterDraft)) {
      if (!dk.startsWith(prefix)) next[dk] = dv;
    }
    this.repeaterDraft = next;
  }

  /** Move a repeater/builder row up (-1) or down (+1). */
  @expose moveRepeaterItem(key: unknown, rowId: unknown, dir: unknown): void {
    const k = String(key);
    const id = Number(rowId);
    const d = Number(dir);
    const rows = [...this._rows(k)];
    const i = rows.findIndex((r) => Number(r.__id) === id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    (this.form as Record<string, unknown>)[k] = rows;
  }

  /** Sub-fields applicable to a repeater/builder row (block-specific for builder). */
  private _rowFields(field: Field, row: Record<string, unknown>): Field[] {
    if (field._type === "builder") {
      return field._blocks.find((b) => b.name === row.__type)?._fields ?? [];
    }
    return field._subfields;
  }

  /** Rebuild each repeater/builder array in `form` from its flat drafts (pre-save). */
  private _collectRepeaters(): void {
    const cfg = this._cfg;
    if (!cfg) return;
    const form = this.form as Record<string, unknown>;
    for (const f of cfg.fields) {
      if (f._type !== "repeater" && f._type !== "builder") continue;
      const rebuilt = this._rows(f._key).map((row) => {
        const out: Record<string, unknown> = { __id: row.__id };
        if (f._type === "builder") out.__type = row.__type;
        for (const sf of this._rowFields(f, row)) {
          const dk = this._repKey(f._key, row.__id, sf._key);
          out[sf._key] = dk in this.repeaterDraft ? this.repeaterDraft[dk] : row[sf._key];
        }
        return out;
      });
      form[f._key] = rebuilt;
    }
  }

  // ── Reactive fields (afterStateUpdated) ─────────────────────────────────────

  /** Run a live field's `afterStateUpdated` hook and merge its patch into the form. */
  @expose fieldChanged(key: unknown): void {
    const R = this._meta?.resource;
    if (!R) return;
    const field = flattenFields(R.form()).find((f) => f._key === String(key));
    if (!field?._afterUpdate) return;
    const form = this.form as Record<string, unknown>;
    const patch = field._afterUpdate(form[String(key)], this.form.data());
    if (patch && typeof patch === "object") {
      for (const [k, v] of Object.entries(patch)) form[k] = v;
    }
  }

  // ── Wizard ──────────────────────────────────────────────────────────────────

  /** Current wizard step index. */
  @expose wizardStepIndex = 0;

  /** Resolve the form's wizard (if the schema is a single wizard). */
  private _wizard(): Wizard | null {
    const R = this._meta?.resource;
    if (!R) return null;
    const block = toFormLayout(R.form()).find((b) => b.kind === "wizard");
    return block && block.kind === "wizard" ? block.wizard : null;
  }

  /** Validate a set of fields against the current form data → field → messages. */
  private _validateFields(
    fields: Field[],
    data: Record<string, unknown>,
  ): Record<string, string[]> {
    const v = new RuleBuilder();
    const schema: Schema = {};
    for (const f of fields)
      schema[f._key] = (f.buildRule(v) as unknown as { _def: Schema[string] })._def;
    const result = runValidation(schema, data);
    if (result.success) return {};
    const out: Record<string, string[]> = {};
    for (const [k, msg] of Object.entries(result.errors as Record<string, string>)) out[k] = [msg];
    return out;
  }

  /** Validate the current step's fields, then advance. */
  @expose nextStep(): void {
    const wiz = this._wizard();
    const step = wiz?._steps[this.wizardStepIndex];
    if (!wiz || !step) return;
    const data = this.form.data();
    const fields = step
      .getFields()
      .filter((f) => f.visibleIn(this.mode) && (f._type === "hidden" || f.visibleForData(data)));
    const errors = this._validateFields(fields, data);
    if (Object.keys(errors).length > 0) {
      (this as unknown as { _errors: Record<string, string[]> })._errors = errors;
      return;
    }
    (this as unknown as { _errors: Record<string, string[]> })._errors = {};
    this.wizardStepIndex = Math.min(this.wizardStepIndex + 1, wiz._steps.length - 1);
  }

  @expose prevStep(): void {
    this.wizardStepIndex = Math.max(0, this.wizardStepIndex - 1);
  }

  /** Form submit inside a wizard: advance a step, or save on the last one. */
  @expose async wizardSubmit(): Promise<void> {
    const wiz = this._wizard();
    if (!wiz) return;
    if (this.wizardStepIndex >= wiz._steps.length - 1) await this.save();
    else this.nextStep();
  }

  @expose async save(): Promise<void> {
    const meta = this._meta;
    if (!meta) return;
    const R = meta.resource;
    // Fold nested repeater/builder drafts back into their canonical arrays first.
    this._collectRepeaters();
    // Throws ValidationError on failure → framework re-renders with field errors.
    await this.validate(this.form);

    // Apply save-time field mutators (e.g. hashing a password) to the form data.
    let data = this.form.data();
    for (const f of this._cfg!.fields) {
      if (f._key in data) data[f._key] = await f.dehydrate(data[f._key]);
    }
    // Somebody else may have saved this record since the form was opened.
    // Refusing is the only safe answer: silently overwriting loses their work,
    // and merging blind is worse.
    if (this.mode === "edit" && R.optimisticLock) {
      const current = (await R.find(this.recordId)) as Record<string, unknown> | null;
      const version = String(current?.[R.optimisticLock] ?? "");
      if (this.loadedVersion && version && version !== this.loadedVersion) {
        this.addError(
          R.optimisticLock,
          "Somebody else changed this record while you were editing. Reload to see their version.",
        );
        return;
      }
    }

    // Put the edited locale back alongside the ones the form never showed.
    if (R.translatable.length > 0) {
      const locale = this._locale();
      for (const key of R.translatable) {
        if (!(key in data)) continue;
        data[key] = { ...(this.translations[key] ?? {}), [locale]: data[key] };
      }
    }

    // Resource-level lifecycle hook, applied to the validated data.
    data = R.mutateBeforeSave(data, this.mode);
    const base = this._panel.base();
    const parentId = this.parentId || undefined;

    if (this.mode === "create") {
      // A nested resource's records always belong to the parent in the URL — set
      // here rather than trusting a form field, which the client could rewrite.
      if (R.parent && parentId) data[R.parent.foreignKey] = parentId;
      const created = await R.create(data);
      await R.afterSave((created ?? data) as Record<string, unknown>, "create");
      const id = created ? (created as Record<string, unknown>)[R.primaryKey] : "";
      this.redirect(R.recordUrl(base, id ?? "", parentId)).withSuccess(`${R.getLabel()} created.`);
    } else {
      await R.update(this.recordId, data);
      await R.afterSave(data, "edit");
      // A singular resource has no separate view page — stay on the form.
      const target = R.singular
        ? R.indexUrl(base, parentId)
        : R.recordUrl(base, this.recordId, parentId);
      this.redirect(target).withSuccess(`${R.getLabel()} updated.`);
    }
  }

  // ── Field rendering ────────────────────────────────────────────────────────

  private _error(key: string): string | null {
    // Read the raw error bag (field → messages[]), not the public `errors`
    // accessor (which returns directive descriptors for `error={}`).
    const bag = (this as unknown as { _errors?: Record<string, string[]> })._errors ?? {};
    const e = bag[key];
    return Array.isArray(e) ? (e[0] ?? null) : null;
  }

  /** Map a field type to its native `<input type>`. */
  private _inputType(f: Field): string {
    switch (f._type) {
      case "datetime":
        return "datetime-local";
      case "date":
      case "time":
      case "color":
      case "number":
      case "email":
      case "password":
      case "url":
      case "tel":
        return f._type === "number" ? "number" : f._type;
      default:
        return "text";
    }
  }

  private _control(f: Field, disabled: boolean): HtmlNode {
    // Bind by reading `this.form[key]` directly in the value/checked prop: the
    // reactive proxy captures the access path ("form.<key>") and Flow emits the
    // `flow:model` two-way binding. Array/choice fields (radio, checkbox list,
    // multiple select) round-trip through dedicated @expose server methods.
    const form = this.form as Record<string, unknown>;

    // A custom control takes the field outright. Checked first so it can replace
    // any built-in type, not merely sit beside them.
    if (f._render) return f._render(form[f._key], form) as HtmlNode;

    const invalid = this._error(f._key) ? "border-destructive focus:ring-destructive/40" : "";
    const opts = this._resolvedOptions[f._key] ?? f._options ?? [];
    // Live fields fire a server callback (afterStateUpdated) after the model syncs.
    const live: Record<string, unknown> =
      f._live || f._afterUpdate
        ? { onChange: this.fieldChanged, "data-args": JSON.stringify([f._key]) }
        : {};

    if (f._type === "textarea") {
      return (
        <textarea
          value={form[f._key]}
          rows={f._rows}
          placeholder={f._placeholder}
          disabled={disabled}
          class={`${INPUT_CLASS} ${invalid}`}
          {...live}
        />
      );
    }

    if (f._type === "toggle") {
      return (
        <label class="mt-1.5 inline-flex cursor-pointer items-center">
          <input type="checkbox" checked={form[f._key]} disabled={disabled} class="peer sr-only" />
          <span class="relative h-6 w-11 rounded-full bg-input transition peer-checked:bg-primary after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-background after:shadow after:transition after:content-[''] peer-checked:after:translate-x-5" />
          <span class="ml-2 text-sm text-muted-foreground">{f._placeholder ?? f.getLabel()}</span>
        </label>
      );
    }

    if (f._type === "radio") {
      const current = String(form[f._key] ?? "");
      return (
        <div class="mt-1.5 space-y-1.5">
          {opts.map((o) => (
            <label class="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={f._key}
                checked={String(o.value) === current}
                disabled={disabled}
                onClick={this.setField}
                data-args={JSON.stringify([f._key, o.value])}
                class="h-4 w-4 border-input text-primary focus:ring-2 focus:ring-ring"
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      );
    }

    if (f._type === "checkboxList" || (f._type === "select" && f._multiple)) {
      const arr = Array.isArray(form[f._key]) ? (form[f._key] as unknown[]).map(String) : [];
      return (
        <div class="mt-1.5 grid gap-1.5 sm:grid-cols-2">
          {opts.map((o) => (
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={arr.includes(String(o.value))}
                disabled={disabled}
                onClick={this.toggleArrayValue}
                data-args={JSON.stringify([f._key, o.value])}
                class="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      );
    }

    // Searchable select — a filterable <datalist> combobox (also allows free entry
    // when `.createOption()` is set, since datalist input is unrestricted).
    if (f._type === "select" && f._searchable) {
      const id = `dl-${f._key}`;
      return (
        <>
          <input
            list={id}
            value={form[f._key]}
            placeholder={f._placeholder ?? "Search…"}
            disabled={disabled}
            class={`${INPUT_CLASS} ${invalid}`}
            {...live}
          />
          <datalist id={id}>
            {opts.map((o) => (
              <option value={o.value}>{o.label}</option>
            ))}
          </datalist>
        </>
      );
    }

    if (f._type === "select") {
      const current = String(form[f._key] ?? "");
      return (
        <select
          value={form[f._key]}
          disabled={disabled}
          class={`${INPUT_CLASS} ${invalid}`}
          {...live}
        >
          <option value="">{f._placeholder ?? "Select…"}</option>
          {opts.map((o) => (
            <option value={o.value} selected={String(o.value) === current}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }

    if (f._type === "checkbox") {
      return (
        <label class="mt-1.5 inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={form[f._key]}
            disabled={disabled}
            class="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
          />
          <span class="text-sm text-muted-foreground">{f._placeholder ?? f.getLabel()}</span>
        </label>
      );
    }

    if (f._type === "tags") {
      const arr = Array.isArray(form[f._key]) ? (form[f._key] as unknown[]) : [];
      return (
        <div class={`${INPUT_CLASS} ${invalid} flex flex-wrap items-center gap-1.5`}>
          {arr.map((t, i) => (
            <span class="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
              {String(t)}
              <button
                type="button"
                onClick={this.removeTag}
                data-args={JSON.stringify([f._key, i])}
                class="text-muted-foreground transition hover:text-destructive"
              >
                ×
              </button>
            </span>
          ))}
          <input
            value={this.tagDraft[f._key] ?? ""}
            placeholder={f._placeholder ?? "Add…"}
            disabled={disabled}
            class="min-w-[6rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={this.addTag}
            data-args={JSON.stringify([f._key])}
            class="rounded-md border border-input px-2 py-0.5 text-xs font-medium transition hover:bg-accent"
          >
            Add
          </button>
        </div>
      );
    }

    if (f._type === "keyValue") {
      return (
        <textarea
          value={form[f._key]}
          rows={f._rows}
          disabled={disabled}
          placeholder={f._placeholder ?? "key: value  (one per line)"}
          class={`${INPUT_CLASS} ${invalid} font-mono text-xs`}
        />
      );
    }

    if (f._type === "file") {
      const val = form[f._key];
      const single = !f._multiple && val && typeof val === "object";
      const fileName = single
        ? String(
            (val as { name?: string; filename?: string }).name ??
              (val as { filename?: string }).filename ??
              "Selected file",
          )
        : typeof val === "string" && val
          ? val
          : "";
      return (
        <div class="mt-1.5 space-y-2">
          <input
            type="file"
            flow:model={`form.${f._key}`}
            accept={f._accept}
            multiple={f._multiple}
            disabled={disabled}
            class="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
          />
          {fileName ? (
            <div class="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon name="document" class="h-4 w-4" />
              <span class="truncate">{fileName}</span>
              <button
                type="button"
                onClick={this.removeFile}
                data-args={JSON.stringify([f._key])}
                class="text-destructive hover:underline"
              >
                Remove
              </button>
            </div>
          ) : null}
        </div>
      );
    }

    if (f._type === "media") {
      const current = typeof form[f._key] === "string" ? String(form[f._key]) : "";
      const chosen = this._mediaItems.find((i) => i.path === current);
      return (
        <div class="mt-1.5 space-y-2">
          {current ? (
            <div class="flex items-center gap-3 rounded-lg border border-border bg-card p-2">
              {this._looksLikeImage(chosen, current) && this._mediaUrls[current] ? (
                <img
                  src={this._mediaUrls[current]}
                  alt={chosen?.alt ?? chosen?.name ?? ""}
                  class="h-12 w-12 rounded object-cover"
                />
              ) : (
                <Icon name="document" class="h-5 w-5 text-muted-foreground" />
              )}
              <span class="flex-1 truncate text-xs">{chosen?.name ?? current}</span>
              <button
                type="button"
                onClick={this.removeFile}
                data-args={JSON.stringify([f._key])}
                class="text-xs text-destructive hover:underline"
              >
                Remove
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={this.openMediaPicker}
            data-args={JSON.stringify([f._key])}
            disabled={disabled}
            class="inline-flex h-9 items-center gap-2 rounded-lg border border-input px-3 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
          >
            <Icon name="image" class="h-4 w-4" />
            {current ? "Change" : "Choose from library"}
          </button>
        </div>
      );
    }

    if (f._type === "slider") {
      return (
        <div class="mt-2 flex items-center gap-3">
          <input
            type="range"
            value={form[f._key]}
            min={f._min ?? 0}
            max={f._max ?? 100}
            step={f._step ?? 1}
            disabled={disabled}
            class="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-input accent-primary"
          />
          <span class="w-10 text-right text-sm tabular-nums text-muted-foreground">
            {String(form[f._key] ?? "")}
          </span>
        </div>
      );
    }

    if (f._type === "toggleButtons") {
      const multi = f._multiple;
      const arr = Array.isArray(form[f._key]) ? (form[f._key] as unknown[]).map(String) : [];
      const cur = String(form[f._key] ?? "");
      return (
        <div class="mt-1.5 inline-flex flex-wrap gap-1 rounded-lg border border-input bg-background p-0.5">
          {opts.map((o) => {
            const on = multi ? arr.includes(String(o.value)) : cur === String(o.value);
            return (
              <button
                type="button"
                onClick={multi ? this.toggleArrayValue : this.setField}
                data-args={JSON.stringify([f._key, o.value])}
                disabled={disabled}
                class={`rounded-md px-3 py-1 text-sm font-medium transition ${
                  on
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }

    if (f._type === "code") {
      const id = `code-${f._key}`;
      return (
        <textarea
          id={id}
          value={form[f._key]}
          rows={f._rows}
          disabled={disabled}
          placeholder={f._placeholder}
          spellcheck="false"
          onkeydown={`__kTab(event,'${id}')`}
          class={`${INPUT_CLASS} ${invalid} font-mono text-xs leading-relaxed`}
        />
      );
    }

    if (f._type === "markdown") {
      const id = `md-${f._key}`;
      const btn =
        "rounded px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground";
      return (
        <div class={`mt-1.5 overflow-hidden rounded-lg border border-input ${invalid}`}>
          <div class="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 p-1">
            <button type="button" class={`${btn} font-bold`} onclick={`__kMd('${id}','**','**')`}>
              B
            </button>
            <button type="button" class={`${btn} italic`} onclick={`__kMd('${id}','_','_')`}>
              I
            </button>
            <button type="button" class={btn} onclick={`__kMd('${id}','[','](url)')`}>
              Link
            </button>
            <button type="button" class={btn} onclick={`__kMd('${id}','\\n- ','')`}>
              List
            </button>
            <button type="button" class={`${btn} font-mono`} onclick={`__kMd('${id}','\`','\`')`}>
              Code
            </button>
          </div>
          <textarea
            id={id}
            value={form[f._key]}
            rows={f._rows}
            disabled={disabled}
            placeholder={f._placeholder}
            class="block w-full resize-y bg-background px-3 py-2 font-mono text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
      );
    }

    if (f._type === "richText") {
      const edId = `rich-${f._key}`;
      const hId = `rich-h-${f._key}`;
      const cmd = (c: string): string => `__kRichCmd('${c}')`;
      const btn =
        "rounded px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground";
      return (
        <div class={`mt-1.5 overflow-hidden rounded-lg border border-input ${invalid}`}>
          <div class="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 p-1">
            <button type="button" class={`${btn} font-bold`} onclick={cmd("bold")}>
              B
            </button>
            <button type="button" class={`${btn} italic`} onclick={cmd("italic")}>
              I
            </button>
            <button type="button" class={`${btn} underline`} onclick={cmd("underline")}>
              U
            </button>
            <button type="button" class={btn} onclick={cmd("insertUnorderedList")}>
              • List
            </button>
            <button type="button" class={btn} onclick={cmd("insertOrderedList")}>
              1. List
            </button>
          </div>
          {/* Hidden, Flow-modeled field; the contenteditable syncs into it. */}
          <textarea id={hId} value={form[f._key]} class="hidden" />
          <div
            id={edId}
            contenteditable={disabled ? "false" : "true"}
            class="prose-sm min-h-[8rem] max-w-none bg-background px-3 py-2 text-sm outline-none [&_*]:my-1"
          />
          <script dangerouslySetInnerHTML={{ __html: `__kRich('${edId}','${hId}')` }} />
        </div>
      );
    }

    if (f._type === "color") {
      return (
        <input
          type="color"
          value={form[f._key]}
          disabled={disabled}
          class="mt-1.5 h-9 w-16 cursor-pointer rounded-lg border border-input bg-background p-1"
        />
      );
    }

    return (
      <input
        type={this._inputType(f)}
        value={form[f._key]}
        step={f._step}
        placeholder={f._placeholder}
        autocomplete={f._autocomplete}
        disabled={disabled}
        class={`${INPUT_CLASS} ${invalid}`}
        {...live}
      />
    );
  }

  private _field(f: Field, data: Record<string, unknown>): HtmlNode {
    if (f._type === "hidden") {
      return <input type="hidden" value={(this.form as Record<string, unknown>)[f._key]} />;
    }
    if (f._type === "repeater" || f._type === "builder") {
      return this._repeaterField(f);
    }
    const disabled = f.isDisabledFor(data);
    const error = this._error(f._key);
    // Toggle / checkbox carry their own inline label, so skip the stacked one.
    const inlineLabel = f._type === "toggle" || f._type === "checkbox";
    return (
      <div class={SPAN_CLASS[Math.min(f._columnSpan, 4)]}>
        {inlineLabel ? null : (
          <label class="block text-sm font-medium text-foreground">
            {f.getLabel()}
            {f._required ? <span class="ml-0.5 text-destructive">*</span> : null}
          </label>
        )}
        {this._control(f, disabled)}
        {error ? (
          <p class="mt-1 text-xs text-destructive">{error}</p>
        ) : f._helper ? (
          <p class="mt-1 text-xs text-muted-foreground">{f._helper}</p>
        ) : null}
      </div>
    );
  }

  // ── Repeater / Builder rendering ────────────────────────────────────────────

  /** A repeater or builder field — full-width, with add/remove/reorder rows. */
  private _repeaterField(f: Field): HtmlNode {
    const rows = this._rows(f._key);
    const isBuilder = f._type === "builder";

    // Seed each visible sub-input's draft from the row value (guarded), so existing
    // values show up; thereafter the draft is the source of truth for that input.
    for (const row of rows) {
      for (const sf of this._rowFields(f, row)) {
        const dk = this._repKey(f._key, row.__id, sf._key);
        if (!(dk in this.repeaterDraft)) this.repeaterDraft[dk] = row[sf._key] ?? sf.defaultValue();
      }
    }

    const atMax = f._maxItems != null && rows.length >= f._maxItems;
    const error = this._error(f._key);

    return (
      <div class="col-span-full">
        <label class="block text-sm font-medium text-foreground">
          {f.getLabel()}
          {f._required ? <span class="ml-0.5 text-destructive">*</span> : null}
        </label>
        {f._helper ? <p class="mt-0.5 text-xs text-muted-foreground">{f._helper}</p> : null}

        <div class="mt-2 space-y-3">
          {rows.length === 0 ? (
            <p class="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No items yet.
            </p>
          ) : (
            rows.map((row, i) => this._repeaterRow(f, row, i, rows.length))
          )}
        </div>

        {atMax ? null : isBuilder ? (
          <div class="mt-3 flex flex-wrap gap-2">
            {f._blocks.map((b) => (
              <button
                type="button"
                onClick={this.addBuilderBlock}
                data-args={JSON.stringify([f._key, b.name])}
                class="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-input px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:border-primary hover:text-foreground"
              >
                {b._icon ? (
                  <Icon name={b._icon} class="h-4 w-4" />
                ) : (
                  <Icon name="plus" class="h-4 w-4" />
                )}
                {b.getLabel()}
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={this.addRepeaterItem}
            data-args={JSON.stringify([f._key])}
            class="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-input px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:border-primary hover:text-foreground"
          >
            <Icon name="plus" class="h-4 w-4" />
            {f._addLabel ?? `Add ${f.getLabel()}`}
          </button>
        )}

        {error ? <p class="mt-1 text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  /** A single repeater/builder row card — header (title + controls) + sub-fields. */
  private _repeaterRow(
    f: Field,
    row: Record<string, unknown>,
    index: number,
    total: number,
  ): HtmlNode {
    const isBuilder = f._type === "builder";
    const block = isBuilder ? f._blocks.find((b) => b.name === row.__type) : null;
    const subs = this._rowFields(f, row);
    const title = f._itemLabel
      ? f._itemLabel(row, index)
      : isBuilder
        ? (block?.getLabel() ?? "Block")
        : `${f.getLabel()} ${index + 1}`;
    const ctrl =
      "flex h-7 w-7 items-center justify-center rounded-md border border-input text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-40";

    return (
      <div class="rounded-lg border border-border bg-muted/20 p-4">
        <div class="mb-3 flex items-center justify-between gap-2">
          <span class="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {isBuilder && block?._icon ? <Icon name={block._icon} class="h-3.5 w-3.5" /> : null}
            {title}
          </span>
          <div class="flex items-center gap-1">
            {f._reorderable && index > 0 ? (
              <button
                type="button"
                onClick={this.moveRepeaterItem}
                data-args={JSON.stringify([f._key, row.__id, -1])}
                class={ctrl}
                aria-label="Move up"
              >
                <Icon name="chevron-down" class="h-4 w-4 rotate-180" />
              </button>
            ) : null}
            {f._reorderable && index < total - 1 ? (
              <button
                type="button"
                onClick={this.moveRepeaterItem}
                data-args={JSON.stringify([f._key, row.__id, 1])}
                class={ctrl}
                aria-label="Move down"
              >
                <Icon name="chevron-down" class="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={this.removeRepeaterItem}
              data-args={JSON.stringify([f._key, row.__id])}
              class={`${ctrl} hover:border-destructive hover:text-destructive`}
              aria-label="Remove"
            >
              <Icon name="trash" class="h-4 w-4" />
            </button>
          </div>
        </div>
        <div class="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {subs.map((sf) => this._repeaterSub(f._key, row.__id, sf))}
        </div>
      </div>
    );
  }

  /** A labelled sub-field inside a repeater/builder row. */
  private _repeaterSub(fieldKey: string, rowId: unknown, sf: Field): HtmlNode {
    const dk = this._repKey(fieldKey, rowId, sf._key);
    const inlineLabel = sf._type === "toggle" || sf._type === "checkbox";
    return (
      <div class={SPAN_CLASS[Math.min(sf._columnSpan, 4)]}>
        {inlineLabel ? null : (
          <label class="block text-sm font-medium text-foreground">
            {sf.getLabel()}
            {sf._required ? <span class="ml-0.5 text-destructive">*</span> : null}
          </label>
        )}
        {this._repeaterControl(dk, sf)}
        {sf._helper ? <p class="mt-1 text-xs text-muted-foreground">{sf._helper}</p> : null}
      </div>
    );
  }

  /** Render a repeater sub-input bound to its flat draft key (`flow:model`). */
  private _repeaterControl(dk: string, sf: Field): HtmlNode {
    const draft = this.repeaterDraft;

    if (sf._type === "textarea") {
      return (
        <textarea
          value={draft[dk]}
          rows={sf._rows}
          placeholder={sf._placeholder}
          class={INPUT_CLASS}
        />
      );
    }

    if (sf._type === "toggle" || sf._type === "checkbox") {
      return (
        <label class="mt-1.5 inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft[dk]}
            class="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
          />
          <span class="text-sm text-muted-foreground">{sf._placeholder ?? sf.getLabel()}</span>
        </label>
      );
    }

    if (sf._type === "select") {
      const cur = String(draft[dk] ?? "");
      return (
        <select value={draft[dk]} class={INPUT_CLASS}>
          <option value="">{sf._placeholder ?? "Select…"}</option>
          {(sf._options ?? []).map((o) => (
            <option value={o.value} selected={String(o.value) === cur}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }

    if (sf._type === "color") {
      return (
        <input
          type="color"
          value={draft[dk]}
          class="mt-1.5 h-9 w-16 cursor-pointer rounded-lg border border-input bg-background p-1"
        />
      );
    }

    return (
      <input
        type={this._inputType(sf)}
        value={draft[dk]}
        step={sf._step}
        placeholder={sf._placeholder}
        class={INPUT_CLASS}
      />
    );
  }

  /** Tailwind column-count class for a section grid (1–4 columns). */
  private _gridClass(columns: number): string {
    const map: Record<number, string> = {
      1: "sm:grid-cols-1",
      2: "sm:grid-cols-2",
      3: "sm:grid-cols-3",
      4: "sm:grid-cols-4",
    };
    return map[Math.min(4, Math.max(1, columns))] ?? "sm:grid-cols-2";
  }

  /** Fields visible in the current mode and for the current form data. */
  private _visibleFields(fields: Field[], data: Record<string, unknown>): Field[] {
    return fields.filter(
      (f) => f.visibleIn(this.mode) && (f._type === "hidden" || f.visibleForData(data)),
    );
  }

  private _fieldsGrid(fields: Field[], columns: number, data: Record<string, unknown>): HtmlNode {
    return (
      <div class={`grid grid-cols-1 gap-x-6 gap-y-5 ${this._gridClass(columns)}`}>
        {fields.map((f) => this._field(f, data))}
      </div>
    );
  }

  private _sectionCard(section: FormSection, data: Record<string, unknown>): HtmlNode | null {
    const fields = this._visibleFields(section.getFields(), data);
    if (fields.length === 0) return null;

    // Fieldset variant — a bordered <fieldset> with a <legend>, lighter than a card.
    if (section._fieldset) {
      return (
        <fieldset class="rounded-xl border border-border px-5 pb-5 pt-3 sm:px-6 sm:pb-6">
          {section._heading ? (
            <legend class="px-2 text-sm font-semibold">{section._heading}</legend>
          ) : null}
          {section._description ? (
            <p class="mb-3 text-xs text-muted-foreground">{section._description}</p>
          ) : null}
          {this._fieldsGrid(fields, section._columns, data)}
        </fieldset>
      );
    }

    return (
      <div class="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-6">
        {section._heading ? (
          <div class="mb-4 flex items-start gap-3 border-b border-border pb-4">
            {section._icon ? (
              <span class="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon name={section._icon} class="h-4 w-4" />
              </span>
            ) : null}
            <div>
              <h2 class="text-sm font-semibold">{section._heading}</h2>
              {section._description ? (
                <p class="mt-0.5 text-xs text-muted-foreground">{section._description}</p>
              ) : null}
            </div>
          </div>
        ) : null}
        {this._fieldsGrid(fields, section._columns, data)}
      </div>
    );
  }

  /** Side-by-side sections. */
  private _splitCard(s: FormSplit, data: Record<string, unknown>): HtmlNode {
    const cards = s._sections
      .map((sec) => this._sectionCard(sec, data))
      .filter((c): c is HtmlNode => c !== null);
    return <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">{cards}</div>;
  }

  /** A non-field callout / notice block. */
  private _calloutCard(c: Callout): HtmlNode {
    const tones: Record<CalloutTone, string> = {
      default: "border-border bg-muted/40",
      primary: "border-primary/30 bg-primary/5",
      success: "border-emerald-500/30 bg-emerald-500/5",
      warning: "border-amber-500/30 bg-amber-500/5",
      destructive: "border-destructive/30 bg-destructive/5",
    };
    return (
      <div class={`flex gap-3 rounded-xl border p-4 ${tones[c._tone]}`}>
        {c._icon ? (
          <Icon name={c._icon} class="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        ) : null}
        <div class="min-w-0">
          {c._heading ? <p class="text-sm font-semibold">{c._heading}</p> : null}
          <p class="text-sm text-muted-foreground">{c._content}</p>
        </div>
      </div>
    );
  }

  /** A static display block — text, raw HTML, or an image. */
  private _primeCard(p: Prime): HtmlNode {
    if (p._kind === "image") {
      // Author-supplied, so usually already a URL — but a storage path passes
      // through the same resolver rather than becoming a page-relative fetch.
      const src = resolveMediaSrc(p._content, this._panel.mediaDisk()) ?? p._content;
      return <img src={src} alt={p._alt ?? ""} class="rounded-xl border border-border" />;
    }
    if (p._kind === "html") {
      return (
        <div
          class="prose-sm max-w-none text-sm text-foreground [&_a]:text-primary"
          dangerouslySetInnerHTML={{ __html: p._content }}
        />
      );
    }
    return <p class="text-sm text-muted-foreground">{p._content}</p>;
  }

  /** Render a tabbed group via flow-ui Tabs (client-side switching; all panels stay mounted). */
  private _tabsCard(tabs: FormTabs, data: Record<string, unknown>): HtmlNode {
    const items = tabs._tabs.map((t) => ({
      label: (
        <span class="inline-flex items-center gap-1.5">
          {t._icon ? <Icon name={t._icon} class="h-4 w-4" /> : null}
          {t._label}
        </span>
      ),
      content: (
        <div class="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-6">
          {this._fieldsGrid(this._visibleFields(t.getFields(), data), t._columns, data)}
        </div>
      ),
    }));
    return <Tabs items={items} />;
  }

  /** Render a wizard as a complete stepped form (indicator + step card + nav). */
  private _wizardForm(wiz: Wizard, data: Record<string, unknown>, cancelHref: string): HtmlNode {
    const steps = wiz._steps;
    const idx = Math.min(Math.max(0, this.wizardStepIndex), steps.length - 1);
    const step = steps[idx];
    const fields = step ? this._visibleFields(step.getFields(), data) : [];
    const last = idx >= steps.length - 1;
    return (
      <form onSubmit={this.wizardSubmit} class="space-y-5">
        <ol class="flex flex-wrap items-center gap-x-2 gap-y-1">
          {steps.map((s, i) => (
            <li class="flex items-center gap-2">
              <span
                class={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                  i < idx
                    ? "bg-primary text-primary-foreground"
                    : i === idx
                      ? "bg-primary/15 text-primary ring-2 ring-primary"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {i < idx ? <Icon name="check-circle" class="h-4 w-4" /> : String(i + 1)}
              </span>
              <span
                class={`text-sm font-medium ${i === idx ? "text-foreground" : "text-muted-foreground"}`}
              >
                {s._label}
              </span>
              {i < steps.length - 1 ? (
                <span class="mx-1 hidden h-px w-6 bg-border sm:block" />
              ) : null}
            </li>
          ))}
        </ol>

        <div class="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-6">
          {step?._description ? (
            <p class="mb-4 text-sm text-muted-foreground">{step._description}</p>
          ) : null}
          {this._fieldsGrid(fields, step?._columns ?? 1, data)}
        </div>

        <div class="flex items-center justify-between gap-2">
          <a
            href={cancelHref}
            navigate
            class="inline-flex h-9 items-center rounded-lg border border-input bg-background px-4 text-sm font-medium transition hover:bg-accent hover:text-accent-foreground"
          >
            Cancel
          </a>
          <div class="flex items-center gap-2">
            {idx > 0 ? (
              <button
                type="button"
                onClick={this.prevStep}
                class="inline-flex h-9 items-center gap-1 rounded-lg border border-input bg-background px-4 text-sm font-medium transition hover:bg-accent hover:text-accent-foreground"
              >
                <Icon name="chevron-left" class="h-4 w-4" /> Back
              </button>
            ) : null}
            <button
              type="submit"
              loadingAttr="disabled"
              class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-60"
            >
              {last ? (
                <>
                  <Icon name="check-circle" class="h-4 w-4" />
                  {this.mode === "edit" ? "Save changes" : "Create"}
                </>
              ) : (
                <>
                  Next <Icon name="chevron-right" class="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    );
  }

  /** Fallback for a wizard mixed with other blocks — render steps as stacked sections. */
  private _wizardFallback(wiz: Wizard, data: Record<string, unknown>): HtmlNode {
    return (
      <>
        {wiz._steps.map((s) => {
          const fields = this._visibleFields(s.getFields(), data);
          return fields.length === 0 ? null : (
            <div class="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-6">
              <h2 class="mb-4 text-sm font-semibold">{s._label}</h2>
              {this._fieldsGrid(fields, s._columns, data)}
            </div>
          );
        })}
      </>
    );
  }

  override async render(): Promise<HtmlNode> {
    const meta = this._meta;
    const cfg = this._cfg;
    const base = this._panel.base();
    if (!meta || !cfg) {
      return (
        <div class="mx-auto w-full max-w-3xl">
          <div class="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
            This resource has no form.
          </div>
        </div>
      );
    }

    // Resolve dynamic select options (e.g. BelongsTo relationships) for this render.
    this._resolvedOptions = {};
    await Promise.all(
      cfg.fields
        .filter((f) => f._optionsLoader)
        .map(async (f) => {
          this._resolvedOptions[f._key] = await f._optionsLoader!();
        }),
    );

    const R = meta.resource;
    const formData = this.form.data();
    // Layout blocks (sections + tab groups); loose fields are auto-wrapped.
    const blocks = toFormLayout(R.form());
    const parentId = this.parentId || undefined;
    const listHref = R.indexUrl(base, parentId);
    // Cancelling an edit returns to the record; a singular resource has no
    // record page to return to, so its form is its own destination.
    const cancelHref =
      this.mode === "edit" && !R.singular ? R.recordUrl(base, this.recordId, parentId) : listHref;
    const title =
      this.mode === "edit"
        ? `Edit ${R.getLabel().toLowerCase()}`
        : `New ${R.getLabel().toLowerCase()}`;

    // The library itself is only queried while the picker is open — a form with
    // a media field should not pay for that on every render. What is already
    // selected still needs a URL, so those paths are resolved either way.
    this._mediaItems = [];
    this._mediaUrls = {};
    const mediaKeys = this._cfg!.fields.filter((f) => f._type === "media").map((f) => f._key);
    if (mediaKeys.length > 0) {
      if (this.pickingFor) {
        const provider = this._panel.mediaProvider();
        this._mediaItems = provider
          ? await provider.list({
              limit: 60,
              ...(this.pickerSearch ? { search: this.pickerSearch } : {}),
            })
          : [];
      }
      const selected = mediaKeys
        .map((key) => (this.form as Record<string, unknown>)[key])
        .filter((v): v is string => typeof v === "string" && v !== "");
      const paths = [...new Set([...this._mediaItems.map((i) => i.path), ...selected])];
      for (const [path, url] of await Promise.all(
        paths.map(
          async (path) =>
            [
              path,
              await mediaUrl(
                this._mediaItems.find((i) => i.path === path) ??
                  // A path with no catalogue entry still resolves through the
                  // disk, so an existing value keeps working.
                  ({ id: path, path, name: path, mime: "", size: 0 } as MediaItem),
                this._panel.mediaDisk(),
              ),
            ] as const,
        ),
      )) {
        // Only real URLs are recorded; a disk with none leaves the entry absent
        // so the template can render a placeholder instead of a broken image.
        if (url) this._mediaUrls[path] = url;
      }
    }

    return (
      <div class="mx-auto w-full max-w-3xl space-y-6">
        {/* Client helpers for code/markdown/rich editors (defined once). */}
        <script dangerouslySetInnerHTML={{ __html: EDITOR_SCRIPT }} />
        {/* Header */}
        <div>
          <Breadcrumbs
            trail={resourceTrail({
              panel: this._panel,
              resource: R,
              parentId,
              ...(this.mode === "edit" && !R.singular ? { recordId: this.recordId } : {}),
              leaf: this.mode === "create" ? "New" : R.singular ? undefined : "Edit",
            })}
          />
          <h1 class="text-2xl font-semibold tracking-tight capitalize">{title}</h1>
        </div>

        {/* Locale tabs. One set of fields, edited one language at a time —
            switching banks the current text rather than discarding it. */}
        {R.translatable.length > 0 && R.locales.length > 1 ? (
          <div class="flex flex-wrap items-center gap-1 border-b border-border">
            {R.locales.map((code) => {
              const on = this._locale() === code;
              return (
                <button
                  type="button"
                  onClick={this.switchLocale}
                  data-args={JSON.stringify([code])}
                  class={`-mb-px border-b-2 px-3 py-2 text-sm font-medium uppercase transition ${
                    on
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                  }`}
                >
                  {code}
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Media picker — opened by a media field, shared by all of them. */}
        {this.pickingFor ? this._mediaPicker() : null}

        {resolveRenderHooks(this._panel.renderHooks("form.start"), {
          resource: R.getSlug(),
          page: "form",
          recordId: this.recordId || undefined,
        })}

        {/* Form card. A real <form onSubmit={method}> emits `flow:submit="save"`
            (a server action) and submits on Enter — same pattern as the auth pages. */}
        {blocks.length === 1 && blocks[0]?.kind === "wizard" ? (
          // Whole-form wizard — stepped UI with its own Back/Next/Finish footer.
          this._wizardForm(blocks[0].wizard, formData, cancelHref)
        ) : (
          <form onSubmit={this.save} class="space-y-5">
            {blocks.map((block) => {
              switch (block.kind) {
                case "tabs":
                  return this._tabsCard(block.tabs, formData);
                case "wizard":
                  return this._wizardFallback(block.wizard, formData);
                case "split":
                  return this._splitCard(block.split, formData);
                case "callout":
                  return this._calloutCard(block.callout);
                case "prime":
                  return this._primeCard(block.prime);
                default:
                  return this._sectionCard(block.section, formData);
              }
            })}

            <div class="flex items-center justify-end gap-2">
              <a
                href={cancelHref}
                navigate
                class="inline-flex h-9 items-center rounded-lg border border-input bg-background px-4 text-sm font-medium transition hover:bg-accent hover:text-accent-foreground"
              >
                Cancel
              </a>
              <button
                type="submit"
                loadingAttr="disabled"
                class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-60"
              >
                <Icon name="check-circle" class="h-4 w-4" />
                {this.mode === "edit" ? "Save changes" : "Create"}
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }
}
