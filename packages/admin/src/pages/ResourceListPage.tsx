/** @jsxImportSource @zerotal/flow */
// The List page for a resource: a URL-driven (search / sort / paginate) table.
// Sort headers and pagination use flow:navigate, which re-seeds the `@url`
// properties and re-renders server-side — no API, no client store.

import { Component, url, expose, locked } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import type { HttpContext } from "@zerotal/core";
import { Table, DropdownMenu, Dialog, Pagination, Empty, Calendar, isoDay } from "@zerotal/flow-ui";
import type { TableColumn, TableGroup } from "@zerotal/flow-ui";
import { RuleBuilder, runValidation } from "@zerotal/validator";
import type { Schema } from "@zerotal/validator";
import type { Field } from "../form/index.ts";
import { AdminLayout, makeAdminLayout } from "../ui/AdminLayout.tsx";
import { Breadcrumbs, resourceTrail } from "../ui/Breadcrumbs.tsx";
import { renderWidgets } from "../widgets/render.tsx";
import { viewQuery, viewIsActive } from "../savedViews.ts";
import { resolveRenderHooks } from "../renderHooks.ts";
import { widgetPollInterval } from "../widgets/Widget.ts";
import { Icon } from "../ui/icons.tsx";
import type { ResourceClass } from "../Panel.ts";
import { Panel } from "../Panel.ts";
import type { PanelInstance } from "../PanelInstance.ts";
import type { Column, BadgeTone } from "../table/Column.ts";
import type { Filter, QueryRule } from "../table/Filter.ts";
import {
  parseRuleTree,
  ruleTreeIsEmpty,
  describeRuleTree,
  selectFilter,
  ternaryFilter,
  textFilter,
} from "../table/Filter.ts";
import type { Constraint } from "../table/Constraint.ts";
import type { AdminRecord, AdminQuery, ListOptions } from "../Resource.ts";
import {
  Action,
  ActionGroup,
  flattenActions,
  renderAction,
  renderActionGroup,
  renderActionMenuItem,
  restoreAction,
  forceDeleteAction,
  bulkRestoreAction,
  bulkForceDeleteAction,
} from "../actions/index.ts";
import type { ActionContext, ActionPage, ActionItem } from "../actions/index.ts";
import { rememberTabCounts } from "../support/countCache.ts";
import { assertCan, assertActionAllowed, AdminForbiddenError } from "../support/authorize.ts";
import { resolveMediaSrc } from "../media.ts";

const BADGE_CLASS: Record<BadgeTone, string> = {
  default: "bg-secondary text-secondary-foreground",
  primary: "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20",
  success: "bg-success/10 text-success ring-1 ring-inset ring-success/20",
  muted: "bg-muted text-muted-foreground",
  destructive: "bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20",
};

/** Is this record soft-deleted? Prefers the model's `trashed()`; falls back to `deleted_at`. */
function isTrashed(rec: Record<string, unknown> | undefined): boolean {
  if (!rec) return false;
  const t = (rec as { trashed?: () => boolean }).trashed;
  if (typeof t === "function") return t.call(rec);
  return rec["deleted_at"] != null;
}

/**
 * Read a chosen file into the hidden field the action form is bound to.
 *
 * Registered once per page; the `input` event is what makes the binding notice
 * the new value, so it must be dispatched rather than just assigning `.value`.
 */
const FILE_READER_SCRIPT = `(function(){
  if (window.__zerotalReadFile) return;
  window.__zerotalReadFile = function(input, targetId){
    var target = document.getElementById(targetId);
    var file = input.files && input.files[0];
    if (!target) return;
    if (!file) { target.value = ''; target.dispatchEvent(new Event('input', {bubbles:true})); return; }
    var reader = new FileReader();
    reader.onload = function(){
      target.value = String(reader.result || '');
      target.dispatchEvent(new Event('input', {bubbles:true}));
    };
    reader.readAsText(file);
  };
})();`;

/** A fresh, empty top-level rule group for a query-builder filter. */
function emptyRuleGroup(): Extract<QueryRule, { type: "group" }> {
  return { type: "group", operator: "and", rules: [] };
}

/** Decode the URL `filters` param (JSON map) into a `{ key: value }` object. */
function parseFilters(s: string): Record<string, string> {
  if (!s) return {};
  try {
    const o = JSON.parse(s) as unknown;
    return o && typeof o === "object" ? (o as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export class ResourceListPage extends Component {
  static layout = AdminLayout;
  /** Set by each generated subclass. */
  static resource: ResourceClass;
  /** The panel this page belongs to — set by each generated subclass. */
  static panel: PanelInstance;

  @url search = "";
  @url sortBy = "";
  @url sortDir: "asc" | "desc" = "asc";
  /**
   * Additional sorts, as `col:dir,col:dir`. The header click drives `sortBy`;
   * this carries the tie-breakers beneath it, so "by status, then newest first"
   * is a link rather than a saved query somewhere.
   */
  @url sort = "";
  @url page = "1";
  @url tab = "";
  /** Active filters, JSON-encoded `{ filterKey: value }`. */
  @url filters = "";
  /** Soft-delete scope: "" (active), "with" (incl. trashed), "only" (trashed). */
  @url trashed = "";
  /** Page size override (empty = the resource default). */
  @url perPage = "";
  /** Hidden column keys, comma-joined (column-visibility manager). */
  @url cols = "";
  /** Active row grouping column ("" = none). */
  @url group = "";
  /** Active locale, for a translatable resource. */
  @url locale = "";

  /**
   * The parent record's id, for a resource nested under another. Locked rather
   * than URL-derived so WebSocket actions stay scoped to the same parent.
   */
  @locked parentId = "";

  /** Selected row ids for bulk actions (reactive — survives round-trips). */
  @expose selected: string[] = [];

  /**
   * Working copy of each query-builder filter's rule tree, keyed by filter.
   *
   * Editing happens here rather than in the URL so a half-built rule doesn't
   * re-query on every keystroke; "Apply" is what writes it to `?filters=`.
   */
  @expose builderDrafts: Record<string, QueryRule> = {};

  /** Name being typed into the "save this view" box. */
  @expose newViewName = "";

  override async onMount(ctx?: HttpContext): Promise<void> {
    this._seedBuilderDrafts();

    const parent = this._resource.parent;
    if (!parent) return;
    const raw = ctx?.params?.[this._resource.parentParam()];
    if (raw == null) return; // keep any pre-seeded id (e.g. tests)
    // An implicitly-bound model resolves to an object; otherwise it's the raw segment.
    this.parentId = String(
      raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)[this._resource.parentResource()!.primaryKey]
        : raw,
    );
  }

  /** Start each builder from whatever the URL already has applied. */
  private _seedBuilderDrafts(): void {
    const active = parseFilters(this.filters);
    for (const f of this._resource.filters()) {
      if (f._type !== "builder") continue;
      const parsed = parseRuleTree(active[f._key] ?? "");
      this.builderDrafts[f._key] = parsed && parsed.type === "group" ? parsed : emptyRuleGroup();
    }
  }

  /** The draft group for a filter, created on first use. */
  private _draft(key: string): Extract<QueryRule, { type: "group" }> {
    const existing = this.builderDrafts[key];
    if (existing && existing.type === "group") return existing;
    const fresh = emptyRuleGroup();
    this.builderDrafts[key] = fresh;
    return fresh;
  }

  /**
   * Walk to the group a path names. `""` is the root; `"2"` is the third child of
   * the root, and so on. An unreachable path resolves to the root rather than
   * throwing, so a stale click after a removal is harmless.
   */
  private _groupAt(key: string, path: string): Extract<QueryRule, { type: "group" }> {
    let node = this._draft(key);
    if (!path) return node;
    for (const segment of path.split(".")) {
      const child = node.rules[Number(segment)];
      if (!child || child.type !== "group") return node;
      node = child;
    }
    return node;
  }

  @expose addBuilderRule(key: unknown, path: unknown): void {
    const filterKey = String(key);
    const constraint = this._builderFilter(filterKey)?._constraints[0];
    if (!constraint) return;
    this._groupAt(filterKey, String(path ?? "")).rules.push({
      type: "rule",
      constraint: constraint._key,
      operator: constraint.operators()[0]?.value ?? "equals",
      value: "",
    });
  }

  @expose addBuilderGroup(key: unknown, path: unknown): void {
    const group = this._groupAt(String(key), String(path ?? ""));
    // A new group starts with one rule; an empty one has nothing to show.
    group.rules.push({ type: "group", operator: "or", rules: [] });
    this.addBuilderRule(key, `${String(path ?? "")}${path ? "." : ""}${group.rules.length - 1}`);
  }

  @expose removeBuilderRule(key: unknown, path: unknown, index: unknown): void {
    this._groupAt(String(key), String(path ?? "")).rules.splice(Number(index), 1);
  }

  @expose setBuilderGroupOperator(key: unknown, path: unknown, operator: unknown): void {
    this._groupAt(String(key), String(path ?? "")).operator = operator === "or" ? "or" : "and";
  }

  /** Update one field of one rule (its constraint, operator or value). */
  @expose setBuilderRule(
    key: unknown,
    path: unknown,
    index: unknown,
    field: unknown,
    value: unknown,
  ): void {
    const filterKey = String(key);
    const rule = this._groupAt(filterKey, String(path ?? "")).rules[Number(index)];
    if (!rule || rule.type !== "rule") return;

    if (field === "constraint") {
      rule.constraint = String(value);
      // Operators differ per constraint kind, so the old one may not exist here.
      const constraint = this._constraintFor(filterKey, rule.constraint);
      rule.operator = constraint?.operators()[0]?.value ?? "equals";
      rule.value = "";
    } else if (field === "operator") {
      rule.operator = String(value);
      const constraint = this._constraintFor(filterKey, rule.constraint);
      if (constraint?.isUnary(rule.operator)) rule.value = "";
    } else {
      rule.value = String(value);
    }
  }

  /** Commit a builder draft to the URL, which re-runs the query. */
  @expose async applyBuilder(key: unknown): Promise<void> {
    const filterKey = String(key);
    const draft = this._draft(filterKey);
    const encoded = ruleTreeIsEmpty(draft) ? "" : JSON.stringify(draft);
    await this.navigateCurrent({ query: this._filterParams(filterKey, encoded) });
  }

  /** Clear a builder entirely — draft and applied. */
  @expose async clearBuilder(key: unknown): Promise<void> {
    const filterKey = String(key);
    this.builderDrafts[filterKey] = emptyRuleGroup();
    await this.navigateCurrent({ query: this._filterParams(filterKey, "") });
  }

  private _builderFilter(key: string): Filter | undefined {
    return this._resource.filters().find((f) => f._key === key && f._type === "builder");
  }

  private _constraintFor(filterKey: string, constraintKey: string): Constraint | undefined {
    return this._builderFilter(filterKey)?._constraints.find((c) => c._key === constraintKey);
  }

  /** Scope the query to the parent record, for a nested resource. */
  private _scopeToParent(query: AdminQuery): AdminQuery {
    const parent = this._resource.parent;
    if (!parent || !this.parentId) return query;
    return query.where(parent.foreignKey, this.parentId);
  }

  /** Inline toggle-column edit: flip a boolean column on a record. */
  @expose async toggleColumn(id: unknown, column: unknown, value: unknown): Promise<void> {
    const R = this._resource;
    const name = String(column);
    // `column` is client-supplied and was written straight into an UPDATE, making this an
    // arbitrary-column write: `toggleColumn(1, "is_admin", true)` on any row the panel lists.
    // Only columns the resource declares as toggles are writable here.
    const col = R.columns().find((c) => c._key === name && c._kind === "toggle");
    if (!col) throw new AdminForbiddenError(`column "${name}" is not an editable toggle`);
    const record = (await R.find(id)) as Record<string, unknown> | null;
    assertCan(R, "update", record ?? undefined);
    await R.update(id, { [name]: Boolean(value) });
  }

  /** Per-cell draft values for inline select/text editing, keyed `id__column`. */
  @expose cellEdits: Record<string, unknown> = {};

  /**
   * Persist an inline-edited cell. The new value is already synced into
   * `cellEdits[key]` by Flow's model binding (input fires before change), so we
   * read it back, write it, and drop the draft so the cell reseeds from the row.
   */
  @expose async saveCell(id: unknown, column: unknown, key: unknown): Promise<void> {
    const R = this._resource;
    const name = String(column);
    // Same arbitrary-column hazard as toggleColumn: restrict to the inline-editable kinds the
    // table actually renders as editors.
    const col = R.columns().find(
      (c) => c._key === name && (c._kind === "input" || c._kind === "select"),
    );
    if (!col) throw new AdminForbiddenError(`column "${name}" is not inline-editable`);
    const record = (await R.find(id)) as Record<string, unknown> | null;
    assertCan(R, "update", record ?? undefined);
    const k = String(key);
    const value = this.cellEdits[k];
    await R.update(id, { [name]: value });
    delete this.cellEdits[k];
  }

  /**
   * Reorder a row up (-1) / down (+1) by swapping its position-column value with
   * the adjacent row's. Rows are ordered globally
   * by the position column; the swap persists via two updates.
   */
  @expose async moveRow(id: unknown, dir: unknown): Promise<void> {
    const R = this._resource;
    const col = R.reorderable;
    if (!col) return;
    assertCan(R, "update");
    const pk = R.primaryKey;
    const all = await R.listAll({ sortBy: col, sortDir: "asc" });
    const i = all.findIndex((r) => String(r[pk]) === String(id));
    const j = i + Number(dir);
    if (i < 0 || j < 0 || j >= all.length) return;
    const a = all[i]!;
    const b = all[j]!;
    const numA = Number(a[col]);
    const numB = Number(b[col]);
    // Seed positions from indices when missing/equal so the swap actually moves it.
    const posA = Number.isFinite(numA) ? numA : i;
    const posB = Number.isFinite(numB) ? numB : j;
    if (posA === posB) {
      await R.update(a[pk], { [col]: j });
      await R.update(b[pk], { [col]: i });
    } else {
      await R.update(a[pk], { [col]: posB });
      await R.update(b[pk], { [col]: posA });
    }
  }

  private get _resource(): ResourceClass {
    return (this.constructor as unknown as { resource: ResourceClass }).resource;
  }

  /**
   * The panel this page was generated for. Held on the class rather than resolved
   * from the request, so WebSocket actions — which carry no URL — stay on it.
   */
  private get _panel(): PanelInstance {
    return (this.constructor as typeof ResourceListPage).panel ?? Panel.current();
  }

  // ── Action context + dispatch ───────────────────────────────────────────────

  private _ctxBase(): ActionContext {
    const R = this._resource;
    return {
      resource: R,
      page: this as unknown as ActionPage,
      base: this._panel.base(),
      slug: R.getSlug(),
      panelId: this._panel.id,
      parentId: this.parentId || undefined,
      listOptions: this._listOptions(),
    };
  }

  /**
   * How the table is currently scoped — everything but pagination.
   *
   * Rebuilt from the page's own `@url`/`@locked` state rather than captured
   * during render, because actions arrive over the WebSocket after the render
   * that drew their button is long gone.
   */
  /**
   * Filters derived from columns marked {@link Column.filterable}.
   *
   * Keyed `col:<column>` so a header filter can never collide with a declared
   * one of the same name, and so the filter bar can tell the two apart — header
   * filters belong in the header, not stacked above the table twice.
   */
  private _headerFilters(): Filter[] {
    return this._resource
      .columns()
      .filter((c) => c._filterable)
      .map((c) => {
        const key = `col:${c._key}`;
        const filter =
          c._kind === "toggle"
            ? ternaryFilter(key)
            : c._options?.length
              ? selectFilter(key).options(
                  c._options.map((o) => ({ value: o.value, label: o.label })),
                )
              : textFilter(key);
        return filter.column(c._key).label(c.getLabel());
      });
  }

  /** Everything that can narrow the query: declared filters and header filters. */
  private _allFilters(): Filter[] {
    return [...this._resource.filters(), ...this._headerFilters()];
  }

  private _listOptions(): ListOptions {
    const R = this._resource;
    const tabs = R.tabs();
    const activeTab = tabs.find((t) => t._key === (this.tab || tabs[0]?._key || ""));
    const resourceFilters = this._allFilters();
    const active = parseFilters(this.filters);
    const sortBy = this.sortBy || R.defaultSort?.column || "";

    return {
      search: this.search || undefined,
      sortBy: sortBy || undefined,
      sortDir: this.sortDir === "desc" ? "desc" : "asc",
      trashed:
        R.usesSoftDeletes() && (this.trashed === "with" || this.trashed === "only")
          ? this.trashed
          : undefined,
      modifyQuery: (q) => {
        q = this._scopeToParent(q);
        if (activeTab?._modify) q = activeTab._modify(q);
        for (const f of resourceFilters) {
          const v = active[f._key];
          if (v != null && v !== "") q = f.apply(q, v);
        }
        return q;
      },
    };
  }

  private _ctx(record?: Record<string, unknown>): ActionContext {
    return { ...this._ctxBase(), record: record as AdminRecord | undefined };
  }

  /** Run a single-record callback action resolved by key. */
  @expose async runAction(key: unknown, id: unknown): Promise<void> {
    const R = this._resource;
    const act = flattenActions([...this._rowActions(), ...R.headerActions()]).find(
      (a) => a._key === key,
    );
    if (!act?._handler) return;
    const record = id !== "" && id != null ? await R.find(id) : undefined;
    const ctx = this._ctx((record as Record<string, unknown>) ?? undefined);
    // The action's own visible/authorize predicates decide whether the button is rendered;
    // they must decide whether the call runs, too. Without this, hiding the button was the
    // entire control and any admin-page visitor could invoke it with arguments of their choice.
    assertActionAllowed(act, record as Record<string, unknown> | undefined, ctx);
    await act.execute(ctx);
  }

  /** Run a bulk action over the current selection, then clear it. */
  @expose async runBulkAction(key: unknown): Promise<void> {
    const act = flattenActions(this._bulkActions()).find((a) => a._key === key);
    if (!act?._handler) return;
    const ctx = this._ctxBase();
    // bulkDeleteAction/bulkForceDeleteAction declare no .authorize() of their own, so the
    // resource ability is asserted explicitly as well as the action predicate.
    assertActionAllowed(act, undefined, ctx as ActionContext);
    if (act._key === "bulk-delete") assertCan(this._resource, "delete");
    if (act._key === "bulk-force-delete") assertCan(this._resource, "forceDelete");
    await act.execute({ ...ctx, ids: [...this.selected] });
    this.selected = [];
  }

  /**
   * Row actions for the current view. Soft-delete resources gate Delete to active
   * rows and add Restore / Force-delete on trashed rows (per-row visibility).
   */
  private _rowActions(): ActionItem[] {
    const R = this._resource;
    if (!R.usesSoftDeletes()) return R.recordActions();
    const base = R.recordActions().map((a) =>
      a instanceof Action && a._key === "delete"
        ? a.visible((rec) => !isTrashed(rec as Record<string, unknown>))
        : a,
    );
    return [
      ...base,
      restoreAction().visible((rec) => isTrashed(rec as Record<string, unknown>)),
      forceDeleteAction().visible((rec) => isTrashed(rec as Record<string, unknown>)),
    ];
  }

  /** Bulk actions for the current view (restore / force-delete on the trashed views). */
  private _bulkActions(): ActionItem[] {
    const R = this._resource;
    if (!R.usesSoftDeletes()) return R.bulkActions();
    if (this.trashed === "only") return [bulkRestoreAction(), bulkForceDeleteAction()];
    if (this.trashed === "with")
      return [...R.bulkActions(), bulkRestoreAction(), bulkForceDeleteAction()];
    return R.bulkActions();
  }

  /** Currently hidden column keys. */
  private _hiddenCols(): Set<string> {
    return new Set(this.cols ? this.cols.split(",").filter(Boolean) : []);
  }

  /** Build a URL that toggles a column's visibility (keeps the current page). */
  private _colHref(key: string): string {
    const hidden = this._hiddenCols();
    if (hidden.has(key)) hidden.delete(key);
    else hidden.add(key);
    const sp = this._params();
    const enc = [...hidden].join(",");
    if (enc) sp.set("cols", enc);
    else sp.delete("cols");
    return "?" + sp.toString();
  }

  /** Build a URL that sets the page size (resets to page 1). */
  private _perPageHref(n: number): string {
    const sp = this._params({ page: undefined });
    sp.set("perPage", String(n));
    return "?" + sp.toString();
  }

  /** Build a URL that sets/clears the active grouping (resets to page 1). */
  private _groupHref(column: string): string {
    const sp = this._params({ page: undefined });
    if (column) sp.set("group", column);
    else sp.delete("group");
    return "?" + sp.toString();
  }

  /** Build a URL that switches the trashed scope (resets to page 1). */
  private _trashedHref(mode: string): string {
    const sp = this._params({ page: undefined });
    if (mode) sp.set("trashed", mode);
    else sp.delete("trashed");
    return "?" + sp.toString();
  }

  /** Switch the locale the list reads translatable columns in. */
  private _localeHref(code: string): string {
    const sp = this._params({ page: undefined });
    // The default locale is the absent value, so the common URL stays clean.
    if (code && code !== this._resource.locales[0]) sp.set("locale", code);
    else sp.delete("locale");
    return "?" + sp.toString();
  }

  // ── Selection ────────────────────────────────────────────────────────────────

  @expose toggleSelect(id: unknown): void {
    const key = String(id);
    this.selected = this.selected.includes(key)
      ? this.selected.filter((x) => x !== key)
      : [...this.selected, key];
  }

  @expose toggleSelectAll(ids: unknown): void {
    const all = (Array.isArray(ids) ? ids : []).map(String);
    const allSelected = all.length > 0 && all.every((id) => this.selected.includes(id));
    this.selected = allSelected ? [] : all;
  }

  @expose clearSelection(): void {
    this.selected = [];
  }

  // ── Modal-form actions ──────────────────────────────────────────────────────

  /** Whether the action modal is open. */
  @expose actionModalOpen = false;
  /** Key of the action whose modal is open. */
  @expose actionFormKey = "";
  /** Record id the modal acts on ("" for header/bulk actions). */
  @expose actionFormId = "";
  /** Reactive values bound to the modal form fields. */
  @expose actionForm: Record<string, unknown> = {};
  /** Per-field validation messages for the modal form. */
  @expose actionErrors: Record<string, string> = {};

  /** Resolve a form-bearing action by key across row / header / bulk sets. */
  private _resolveFormAction(key: string): Action | undefined {
    const R = this._resource;
    return flattenActions([
      ...this._rowActions(),
      ...R.headerActions(),
      ...this._bulkActions(),
    ]).find((a) => a._key === key && a.hasForm());
  }

  /** Open an action's modal form, seeding defaults (and the record for row actions). */
  @expose async openActionForm(key: unknown, id: unknown): Promise<void> {
    const act = this._resolveFormAction(String(key));
    if (!act) return;
    // Seeds record fields into the modal state, so an ungated call is a read primitive as
    // well as a step towards submitActionForm.
    const seedRecord =
      id !== "" && id != null
        ? ((await this._resource.find(id)) as Record<string, unknown>)
        : undefined;
    assertActionAllowed(act, seedRecord, this._ctx(seedRecord));
    const fields = act.fieldsFor(this.actionForm, this._resource);
    const form: Record<string, unknown> = {};
    for (const f of fields) form[f._key] = f.defaultValue();
    if (id !== "" && id != null) {
      const rec = await this._resource.find(id);
      if (rec) {
        for (const f of fields) {
          if (f._key in (rec as Record<string, unknown>)) {
            form[f._key] = f.hydrate((rec as Record<string, unknown>)[f._key]);
          }
        }
      }
    }
    this.actionForm = form;
    this.actionErrors = {};
    this.actionFormKey = String(key);
    this.actionFormId = id != null ? String(id) : "";
    this.actionModalOpen = true;
  }

  @expose closeActionForm(): void {
    this.actionModalOpen = false;
  }

  /** Validate the modal form against its fields' rules; returns field → message. */
  private _validateActionForm(
    fields: Field[],
    data: Record<string, unknown>,
  ): Record<string, string> {
    const v = new RuleBuilder();
    const schema: Schema = {};
    for (const f of fields) {
      schema[f._key] = (f.buildRule(v) as unknown as { _def: Schema[string] })._def;
    }
    const result = runValidation(schema, data);
    return result.success ? {} : (result.errors as Record<string, string>);
  }

  /** Validate + run the open action's handler with the submitted form data. */
  @expose async submitActionForm(): Promise<void> {
    const R = this._resource;
    const act = this._resolveFormAction(this.actionFormKey);
    if (!act?._handler) {
      this.actionModalOpen = false;
      return;
    }
    const fields = act.fieldsFor(this.actionForm, this._resource);
    const data: Record<string, unknown> = { ...this.actionForm };
    const errors = this._validateActionForm(fields, data);
    if (Object.keys(errors).length > 0) {
      this.actionErrors = errors;
      return;
    }
    for (const f of fields) if (f._key in data) data[f._key] = await f.dehydrate(data[f._key]);

    const ctx: ActionContext = act._bulk
      ? { ...this._ctxBase(), ids: [...this.selected], data }
      : {
          ...this._ctxBase(),
          record: (this.actionFormId
            ? ((await R.find(this.actionFormId)) as AdminRecord | null)
            : undefined) as AdminRecord | undefined,
          data,
        };
    assertActionAllowed(act, ctx.record as Record<string, unknown> | undefined, ctx);
    await act.execute(ctx);
    if (act._bulk) this.selected = [];
    this.actionModalOpen = false;
  }

  /** Render one modal-form control bound to `actionForm` (common field types). */
  private _modalControl(f: Field): HtmlNode {
    const form = this.actionForm;
    const cls =
      "mt-1.5 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-ring";
    if (f._type === "textarea") {
      return (
        <textarea value={form[f._key]} rows={f._rows} placeholder={f._placeholder} class={cls} />
      );
    }
    if (f._type === "select") {
      const cur = String(form[f._key] ?? "");
      return (
        <select value={form[f._key]} class={cls}>
          <option value="">{f._placeholder ?? "Select…"}</option>
          {(f._options ?? []).map((o) => (
            <option value={o.value} selected={String(o.value) === cur}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    if (f._type === "file") {
      // The action handler wants the file's *contents*, not a stored path, so the
      // browser reads it and fills a hidden bound field. Dispatching `input` is
      // what tells the binding the value changed — assigning `.value` alone is
      // invisible to it.
      const id = `kfile-${f._key}`;
      return (
        <div class="mt-1.5">
          <input
            type="file"
            id={id}
            accept={f._accept ?? undefined}
            onchange={`window.__zerotalReadFile(this,'${id}-value')`}
            class="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-accent"
          />
          <textarea id={`${id}-value`} value={form[f._key]} class="hidden" />
        </div>
      );
    }
    if (f._type === "checkbox" || f._type === "toggle") {
      return (
        <label class="mt-1.5 inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={form[f._key]}
            class="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
          />
          <span class="text-sm text-muted-foreground">{f._placeholder ?? f.getLabel()}</span>
        </label>
      );
    }
    const type =
      f._type === "datetime"
        ? "datetime-local"
        : ["date", "time", "color", "number", "email", "password", "url", "tel"].includes(f._type)
          ? f._type
          : "text";
    return <input type={type} value={form[f._key]} placeholder={f._placeholder} class={cls} />;
  }

  // ── Query builder ──────────────────────────────────────────────────────────

  /** One rule row: which field, how it compares, and what to. */
  private _builderRule(
    filter: Filter,
    rule: Extract<QueryRule, { type: "rule" }>,
    path: string,
    index: number,
  ): HtmlNode {
    const key = filter._key;
    const constraint = filter._constraints.find((c) => c._key === rule.constraint);
    const control =
      "h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring";
    const unary = constraint?.isUnary(rule.operator) ?? false;

    return (
      <div class="flex flex-wrap items-center gap-1.5">
        <select
          onChange={this.setBuilderRule}
          data-args={JSON.stringify([key, path, index, "constraint"])}
          class={control}
        >
          {filter._constraints.map((c) => (
            <option value={c._key} selected={c._key === rule.constraint}>
              {c.getLabel()}
            </option>
          ))}
        </select>

        <select
          onChange={this.setBuilderRule}
          data-args={JSON.stringify([key, path, index, "operator"])}
          class={control}
        >
          {(constraint?.operators() ?? []).map((o) => (
            <option value={o.value} selected={o.value === rule.operator}>
              {o.label}
            </option>
          ))}
        </select>

        {/* A unary operator ("is empty") needs no value, so none is offered. */}
        {unary ? null : constraint?._kind === "select" ? (
          <select
            onChange={this.setBuilderRule}
            data-args={JSON.stringify([key, path, index, "value"])}
            class={control}
          >
            <option value="">Choose…</option>
            {constraint._options.map((o) => (
              <option value={o.value} selected={o.value === rule.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={
              constraint?._kind === "number"
                ? "number"
                : constraint?._kind === "date"
                  ? "date"
                  : "text"
            }
            value={rule.value ?? ""}
            onChange={this.setBuilderRule}
            data-args={JSON.stringify([key, path, index, "value"])}
            placeholder="value"
            class={`${control} w-40`}
          />
        )}

        <button
          type="button"
          onClick={this.removeBuilderRule}
          data-args={JSON.stringify([key, path, index])}
          title="Remove"
          class="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
        >
          <Icon name="x-circle" class="h-4 w-4" />
        </button>
      </div>
    );
  }

  /**
   * One group: its rules, its nested groups, and the AND/OR toggle that joins
   * them. Rendered recursively, so nesting depth is whatever the user built.
   */
  private _builderGroup(
    filter: Filter,
    group: Extract<QueryRule, { type: "group" }>,
    path: string,
    depth: number,
  ): HtmlNode {
    const key = filter._key;
    const toggle = (op: "and" | "or"): string =>
      `rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition ${
        group.operator === op
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`;

    return (
      <div
        class={
          depth === 0
            ? "space-y-2"
            : "space-y-2 rounded-lg border border-dashed border-border bg-background/60 p-2.5"
        }
      >
        {group.rules.map((rule, index) => (
          <div class="flex items-start gap-2">
            {/* The joiner reads down the left edge: the first row has nothing
                before it to combine with, so it shows "Where" instead. */}
            <div class="flex w-14 shrink-0 items-center pt-1">
              {index === 0 ? (
                <span class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Where
                </span>
              ) : index === 1 ? (
                <div class="flex rounded-md border border-border">
                  <button
                    type="button"
                    onClick={this.setBuilderGroupOperator}
                    data-args={JSON.stringify([key, path, "and"])}
                    class={toggle("and")}
                  >
                    and
                  </button>
                  <button
                    type="button"
                    onClick={this.setBuilderGroupOperator}
                    data-args={JSON.stringify([key, path, "or"])}
                    class={toggle("or")}
                  >
                    or
                  </button>
                </div>
              ) : (
                <span class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.operator}
                </span>
              )}
            </div>

            <div class="min-w-0 flex-1">
              {rule.type === "group" ? (
                <div class="flex items-start gap-2">
                  <div class="min-w-0 flex-1">
                    {this._builderGroup(
                      filter,
                      rule,
                      path ? `${path}.${index}` : String(index),
                      depth + 1,
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={this.removeBuilderRule}
                    data-args={JSON.stringify([key, path, index])}
                    title="Remove group"
                    class="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Icon name="x-circle" class="h-4 w-4" />
                  </button>
                </div>
              ) : (
                this._builderRule(filter, rule, path, index)
              )}
            </div>
          </div>
        ))}

        <div class="flex items-center gap-2 pl-16">
          <button
            type="button"
            onClick={this.addBuilderRule}
            data-args={JSON.stringify([key, path])}
            class="inline-flex h-7 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs font-medium transition hover:bg-accent hover:text-accent-foreground"
          >
            <Icon name="plus" class="h-3.5 w-3.5" /> Rule
          </button>
          <button
            type="button"
            onClick={this.addBuilderGroup}
            data-args={JSON.stringify([key, path])}
            class="inline-flex h-7 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs font-medium transition hover:bg-accent hover:text-accent-foreground"
          >
            <Icon name="plus" class="h-3.5 w-3.5" /> Group
          </button>
        </div>
      </div>
    );
  }

  /** The whole query-builder card for one filter. */
  private _queryBuilder(filter: Filter, applied: boolean): HtmlNode {
    const draft = this._draft(filter._key);
    return (
      <div class="rounded-lg border border-border bg-card">
        <div class="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
          <span class="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Icon name="filter" class="h-4 w-4" />
            {filter.getLabel()}
            {applied ? (
              <span class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                active
              </span>
            ) : null}
          </span>
          <div class="flex items-center gap-2">
            {applied || draft.rules.length > 0 ? (
              <button
                type="button"
                onClick={this.clearBuilder}
                data-args={JSON.stringify([filter._key])}
                class="inline-flex h-8 items-center rounded-lg border border-input bg-background px-3 text-xs font-medium transition hover:bg-accent hover:text-accent-foreground"
              >
                Clear
              </button>
            ) : null}
            <button
              type="button"
              onClick={this.applyBuilder}
              data-args={JSON.stringify([filter._key])}
              class="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
            >
              Apply
            </button>
          </div>
        </div>
        <div class="p-3">
          {draft.rules.length === 0 ? (
            <button
              type="button"
              onClick={this.addBuilderRule}
              data-args={JSON.stringify([filter._key, ""])}
              class="inline-flex h-8 items-center gap-1 rounded-md border border-dashed border-border px-3 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <Icon name="plus" class="h-3.5 w-3.5" /> Add a rule
            </button>
          ) : (
            this._builderGroup(filter, draft, "", 0)
          )}
        </div>
      </div>
    );
  }

  /**
   * What to show in place of the table.
   *
   * A narrowed-down view and a genuinely empty resource are different problems:
   * the first wants "widen your search", the second wants the resource's own
   * {@link Resource.emptyState}, which can explain what will fill it.
   */
  private _emptyState(): HtmlNode {
    const R = this._resource;
    const narrowed = Boolean(this.search || this.filters || this.tab || this.trashed);

    const heading = narrowed ? "No matches" : R.emptyState().heading;
    const description = narrowed
      ? "Try a different search or clear the filters."
      : R.emptyState().description;
    const icon = narrowed ? "search" : (R.emptyState().icon ?? "inbox");
    const actions = narrowed ? [] : (R.emptyState().actions ?? []);
    const ctx = this._ctxBase();

    return (
      <Empty
        // Bare: the table already draws the border this would sit inside.
        bare
        class="py-16"
        icon={
          <span class="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Icon name={icon} class="h-6 w-6" />
          </span>
        }
        title={heading}
        {...(description ? { description } : {})}
        {...(actions.length > 0
          ? {
              action: actions.map((a) =>
                a instanceof ActionGroup
                  ? renderActionGroup(a, ctx, {
                      onRun: this.runAction,
                      argsFor: (member) => [member._key, ""],
                    })
                  : renderAction(a, ctx, {
                      onRun: this.runAction,
                      onForm: this.openActionForm,
                      args: [a._key, ""],
                    }),
              ),
            }
          : {})}
      />
    );
  }

  // ── Saved views ────────────────────────────────────────────────────────────

  /** Persist the list's current shape under a name. */
  @expose async saveCurrentView(): Promise<void> {
    const provider = this._panel.savedViewProvider();
    const name = this.newViewName.trim();
    if (!provider || !name) {
      this.flash("Give the view a name first.", "warning");
      return;
    }
    await provider.save({
      resource: this._resource.getSlug(),
      name,
      // Only the shape, not the page — a saved view always opens at the top.
      query: viewQuery(this._params({ page: undefined })),
    });
    this.newViewName = "";
    this.flash(`Saved "${name}".`);
  }

  @expose async deleteView(id: unknown): Promise<void> {
    const provider = this._panel.savedViewProvider();
    if (!provider) return;
    await provider.remove(String(id));
    this.flash("View deleted.");
  }

  /** The saved-views control, or nothing when the app configured no provider. */
  private async _savedViews(): Promise<HtmlNode | null> {
    const provider = this._panel.savedViewProvider();
    if (!provider) return null;

    const views = await provider.list(this._resource.getSlug());
    const current = this._params({ page: undefined });

    return (
      <DropdownMenu
        align="right"
        trigger={
          <button
            type="button"
            class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm font-medium transition hover:bg-accent hover:text-accent-foreground"
          >
            <Icon name="eye" class="h-4 w-4" /> Views
            {views.length > 0 ? (
              <span class="rounded-full bg-muted px-1.5 text-[11px]">{views.length}</span>
            ) : null}
          </button>
        }
      >
        {views.length === 0 ? (
          <div class="px-2 py-1.5 text-xs text-muted-foreground">No saved views yet.</div>
        ) : (
          views.map((v) => (
            <div class="flex items-center gap-1">
              <a
                href={`?${v.query}`}
                navigate
                class={`flex flex-1 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground ${
                  viewIsActive(v, current) ? "font-semibold text-primary" : ""
                }`}
              >
                {v.name}
                {v.shared ? (
                  <span class="ml-auto text-[10px] uppercase text-muted-foreground">shared</span>
                ) : null}
              </a>
              <button
                type="button"
                onClick={this.deleteView}
                data-args={JSON.stringify([v.id])}
                title="Delete this view"
                class="rounded p-1 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
              >
                <Icon name="x-circle" class="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}

        <div class="-mx-1 my-1 h-px bg-border" />
        <form onSubmit={this.saveCurrentView} class="flex items-center gap-1 px-2 py-1.5">
          <input
            type="text"
            value={this.newViewName}
            placeholder="Save this view as…"
            class="h-7 w-40 rounded border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            class="rounded bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
          >
            Save
          </button>
        </form>
      </DropdownMenu>
    );
  }

  // ── Filters ────────────────────────────────────────────────────────────────

  /**
   * Chips naming every filter currently narrowing the list, each one its own
   * undo.
   *
   * A table showing four of two hundred rows with no visible reason is the most
   * common way an admin panel misleads someone. These say why, and let it be
   * undone without hunting for the control that caused it.
   */
  private _filterIndicators(filters: Filter[], active: Record<string, string>): HtmlNode | null {
    const chips: { label: string; href: string }[] = [];

    if (this.search) {
      chips.push({
        label: `Search: ${this.search}`,
        href: "?" + this._params({ page: undefined, search: "" }).toString(),
      });
    }

    for (const f of filters) {
      const value = active[f._key];
      if (value == null || value === "") continue;
      const shown =
        f._type === "builder"
          ? describeRuleTree(parseRuleTree(value), f)
          : (f.choices().find((c) => c.value === value)?.label ?? value);
      chips.push({ label: `${f.getLabel()}: ${shown}`, href: this._filterHref(f._key, "") });
    }

    if (this.trashed) {
      chips.push({
        label: this.trashed === "only" ? "Trashed only" : "Including trashed",
        href: "?" + this._params({ page: undefined, trashed: "" }).toString(),
      });
    }

    if (chips.length === 0) return null;

    return (
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs font-semibold text-muted-foreground">Filtered by</span>
        {chips.map((c) => (
          <a
            href={c.href}
            navigate
            title="Remove this filter"
            class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition hover:bg-primary/20"
          >
            {c.label}
            <Icon name="x-circle" class="h-3.5 w-3.5" />
          </a>
        ))}
        {chips.length > 1 ? (
          <a
            href={
              "?" +
              this._params({ page: undefined, search: "", filters: "", trashed: "" }).toString()
            }
            navigate
            class="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Clear all
          </a>
        ) : null}
      </div>
    );
  }

  /** The filter controls themselves, placed per the resource's `filterLayout`. */
  private _filterBar(filters: Filter[], active: Record<string, string>): HtmlNode {
    const R = this._resource;
    const pill = (on: boolean): string =>
      `rounded-full px-2.5 py-1 text-xs font-medium transition ${
        on
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`;

    const controls = filters.map((f) => {
      const current = active[f._key] ?? "";
      return (
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-semibold text-muted-foreground">{f.getLabel()}</span>
          <a href={this._filterHref(f._key, "")} navigate class={pill(current === "")}>
            All
          </a>
          {f.choices().map((o) => (
            <a href={this._filterHref(f._key, o.value)} navigate class={pill(current === o.value)}>
              {o.label}
            </a>
          ))}
        </div>
      );
    });

    if (R.filterLayout === "inline") {
      return (
        <div class="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-card px-3 py-2.5">
          {controls}
        </div>
      );
    }

    // Panel and drawer both collapse behind a toggle; they differ only in where
    // the revealed controls sit. A native <details> keeps that a pure-CSS
    // affordance — no state to round-trip for opening a filter panel.
    const active_count = filters.filter((f) => (active[f._key] ?? "") !== "").length;
    return (
      <details class="group/filters rounded-lg border border-border bg-card">
        <summary class="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-xs font-semibold text-muted-foreground [&::-webkit-details-marker]:hidden">
          <Icon name="filter" class="h-4 w-4" />
          Filters
          {active_count > 0 ? (
            <span class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
              {active_count}
            </span>
          ) : null}
          <Icon
            name="chevron-down"
            class="ml-auto h-3.5 w-3.5 transition group-open/filters:rotate-180"
          />
        </summary>
        <div
          class={
            R.filterLayout === "drawer"
              ? "flex flex-col gap-3 border-t border-border px-3 py-3 sm:max-w-xs"
              : "flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-3 py-3"
          }
        >
          {controls}
        </div>
      </details>
    );
  }

  // ── Table presentation ─────────────────────────────────────────────────────

  /** Row striping and density, applied as classes rather than table variants. */
  private _tableClass(): string | undefined {
    const R = this._resource;
    const parts: string[] = [];
    if (R.striped) parts.push("[&_tbody_tr:nth-child(even)]:bg-muted/40");
    if (R.density === "compact") parts.push("[&_td]:py-1.5 [&_th]:py-1.5 text-[13px]");
    return parts.length > 0 ? parts.join(" ") : undefined;
  }

  /**
   * The grid layout: one card per record instead of a row.
   *
   * The first image column becomes the card's picture and the first text column
   * its title; the rest render as label/value pairs. That ordering falls out of
   * how columns are already declared, so a resource opts into the grid without
   * describing itself twice.
   */
  private _grid(cols: Column[], rows: Record<string, unknown>[], pk: string): HtmlNode {
    const image = cols.find((c) => c._kind === "image");
    const title = cols.find((c) => c !== image && c._kind === "text");
    const rest = cols.filter((c) => c !== image && c !== title).slice(0, 4);

    return (
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rows.map((row) => {
          const ctx = this._ctx(row);
          const id = String(row[pk]);
          return (
            <div class="flex flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm transition hover:border-primary/40 hover:shadow-md">
              {image ? (
                <div class="aspect-[4/3] w-full overflow-hidden bg-muted">
                  {this._cell(image, row)}
                </div>
              ) : null}
              <div class="flex flex-1 flex-col gap-2 p-4">
                <div class="text-sm font-semibold">{title ? this._cell(title, row) : id}</div>
                <dl class="space-y-1 text-xs">
                  {rest.map((c) => (
                    <div class="flex items-center justify-between gap-2">
                      <dt class="text-muted-foreground">{c.getLabel()}</dt>
                      <dd class="truncate">{this._cell(c, row)}</dd>
                    </div>
                  ))}
                </dl>
                <div class="mt-auto flex items-center justify-end gap-1 pt-2">
                  {this._rowActions()
                    .filter((a): a is Action => a instanceof Action)
                    .filter((a) => a.isVisibleFor(row as AdminRecord, ctx))
                    .slice(0, 3)
                    .map((a) =>
                      renderAction(a, ctx, {
                        onRun: this.runAction,
                        onForm: this.openActionForm,
                        args: [a._key, id],
                      }),
                    )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  /**
   * A kanban board: one lane per value of the resource's `kanbanColumn`.
   *
   * Moving a card is a server action rather than a drag. The lane a record sits
   * in is a field on it, and setting a field is something the panel already
   * knows how to authorise; dragging would look nicer and would need its own
   * permission story to be equally safe.
   */
  private _kanban(cols: Column[], rows: Record<string, unknown>[], pk: string): HtmlNode {
    const R = this._resource;
    const column = R.kanbanColumn!;
    const declared = Object.keys(R.kanbanLanes);
    // Declared lanes first, then any value actually present that wasn't
    // declared — a board that silently hides records is worse than an untidy one.
    const present = [...new Set(rows.map((r) => String(r[column] ?? "")))];
    const lanes = [...declared, ...present.filter((v) => !declared.includes(v))];

    const title = cols.find((c) => c._kind === "text");
    const rest = cols.filter((c) => c !== title && c._kind !== "image").slice(0, 3);
    const base = this._panel.base();
    const parent = this.parentId || undefined;

    return (
      <div class="flex gap-3 overflow-x-auto pb-2">
        {lanes.map((lane, laneIndex) => {
          const inLane = rows.filter((r) => String(r[column] ?? "") === lane);
          const prev = lanes[laneIndex - 1];
          const next = lanes[laneIndex + 1];
          return (
            <div class="flex w-72 shrink-0 flex-col rounded-xl border border-border bg-muted/30">
              <div class="flex items-center gap-2 border-b border-border px-3 py-2">
                <span class="text-sm font-semibold">{R.kanbanLanes[lane] ?? lane ?? "—"}</span>
                <span class="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
                  {inLane.length}
                </span>
              </div>
              <div class="flex flex-col gap-2 p-2">
                {inLane.map((row) => {
                  const id = String(row[pk]);
                  return (
                    <div class="rounded-lg border border-border bg-card p-3 text-card-foreground shadow-sm">
                      <a
                        href={R.recordUrl(base, id, parent)}
                        navigate
                        class="block text-sm font-medium hover:underline"
                      >
                        {title ? this._cell(title, row) : id}
                      </a>
                      <dl class="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                        {rest.map((c) => (
                          <div class="flex items-center justify-between gap-2">
                            <dt>{c.getLabel()}</dt>
                            <dd class="truncate text-foreground">{this._cell(c, row)}</dd>
                          </div>
                        ))}
                      </dl>
                      <div class="mt-2 flex items-center gap-1">
                        {prev !== undefined ? (
                          <button
                            type="button"
                            onClick={this.moveToLane}
                            data-args={JSON.stringify([id, prev])}
                            title={`Move to ${R.kanbanLanes[prev] ?? prev}`}
                            class="rounded border border-input px-1.5 py-0.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
                          >
                            ←
                          </button>
                        ) : null}
                        {next !== undefined ? (
                          <button
                            type="button"
                            onClick={this.moveToLane}
                            data-args={JSON.stringify([id, next])}
                            title={`Move to ${R.kanbanLanes[next] ?? next}`}
                            class="rounded border border-input px-1.5 py-0.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
                          >
                            →
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {inLane.length === 0 ? (
                  <p class="px-2 py-6 text-center text-xs text-muted-foreground">Nothing here.</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  /**
   * A month grid with each record on its date.
   *
   * Anchored on the month the listed rows actually fall in rather than on today,
   * so a calendar opened from a filtered list lands where the data is instead of
   * on an empty current month.
   */
  private _calendar(cols: Column[], rows: Record<string, unknown>[], pk: string): HtmlNode {
    const R = this._resource;
    const column = R.calendarColumn!;
    const title = cols.find((c) => c._kind === "text");
    const base = this._panel.base();
    const parent = this.parentId || undefined;

    /**
     * The calendar day a row falls on, as `YYYY-MM-DD`.
     *
     * A date-only column arrives as a string already and is used as-is: parsing
     * it into a Date and formatting it back is what moves a record onto the
     * previous day for anyone west of UTC.
     */
    const dayOf = (row: Record<string, unknown>): string | null => {
      const raw = row[column];
      if (!raw) return null;
      if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
      const date = raw instanceof Date ? raw : new Date(String(raw));
      return Number.isNaN(date.getTime()) ? null : isoDay(date);
    };

    const events = rows
      .map((row) => ({ row, day: dayOf(row) }))
      .filter((x): x is { row: Record<string, unknown>; day: string } => x.day !== null)
      .map(({ row, day }) => ({
        date: day,
        label: title ? title.cell(row).text : String(row[pk]),
        href: R.recordUrl(base, String(row[pk]), parent),
      }));

    // Anchored on the month the listed rows fall in rather than today, so paging
    // back through older records does not land on an empty grid.
    const month = events[0]?.date.slice(0, 7) ?? isoDay(new Date()).slice(0, 7);

    return <Calendar month={month} events={events} />;
  }
  /**
   * Move a record to another kanban lane.
   *
   * The lane change is the same authorised update a row action would make —
   * dragging between columns is a second way to reach one behaviour, not a
   * second path that skips the check.
   */
  @expose async moveToLane(id: unknown, lane: unknown): Promise<void> {
    const R = this._resource;
    const column = R.kanbanColumn;
    if (!column) return;

    const record = await R.find(String(id));
    assertCan(R, "update", record ?? undefined);
    await R.update(String(id), { [column]: String(lane) });
  }

  private _actionModal(): HtmlNode {
    const act = this._resolveFormAction(this.actionFormKey);
    const fields = act?.fieldsFor(this.actionForm, this._resource) ?? [];
    const needsFileReader = fields.some((f) => f._type === "file");
    return (
      <Dialog show={this.actionModalOpen} title={act?._modalHeading ?? act?.getLabel() ?? "Action"}>
        {needsFileReader ? (
          <script dangerouslySetInnerHTML={{ __html: FILE_READER_SCRIPT }} />
        ) : null}
        <form onSubmit={this.submitActionForm} class="space-y-4">
          {fields.map((f) => (
            <div>
              <label class="block text-sm font-medium text-foreground">
                {f.getLabel()}
                {f._required ? <span class="ml-0.5 text-destructive">*</span> : null}
              </label>
              {this._modalControl(f)}
              {this.actionErrors[f._key] ? (
                <p class="mt-1 text-xs text-destructive">{this.actionErrors[f._key]}</p>
              ) : f._helper ? (
                <p class="mt-1 text-xs text-muted-foreground">{f._helper}</p>
              ) : null}
            </div>
          ))}
          <div class="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={this.closeActionForm}
              class="inline-flex h-9 items-center rounded-lg border border-input bg-background px-4 text-sm font-medium transition hover:bg-accent hover:text-accent-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              loadingAttr="disabled"
              class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-60"
            >
              {act?._modalSubmit ?? act?.getLabel() ?? "Submit"}
            </button>
          </div>
        </form>
      </Dialog>
    );
  }

  /**
   * Reactive row action: delete a record and flash the result. Flow re-renders
   * the component after the action, and render() re-queries the records — so the
   * deleted row (and the total count) drop out of the table automatically.
   */
  @expose async deleteRecord(id: unknown): Promise<void> {
    const R = this._resource;
    // This bypasses Action entirely, so it carries its own gate.
    const record = (await R.find(id)) as Record<string, unknown> | null;
    assertCan(R, "delete", record ?? undefined);
    if (await R.destroy(id)) this.flash(`${R.getLabel()} deleted.`);
    else this.flash("That record no longer exists.", "warning");
  }

  /** The locale the list is currently showing, for a translatable resource. */
  private _locale(): string {
    const R = this._resource;
    return this.locale || R.locales[0] || "en";
  }

  private _cell(col: Column, row: Record<string, unknown>): HtmlNode | string {
    const R = this._resource;
    // A translatable column stores every locale; the table shows one. Resolved
    // here so every cell kind — badge, custom renderer, plain text — sees the
    // value for the active locale rather than the whole map.
    if (R.translatable.includes(col._key)) {
      row = { ...row, [col._key]: R.translated(row[col._key], this._locale()) };
    }

    // A custom renderer takes the cell outright. Checked first so it can replace
    // any built-in kind, not just sit alongside them.
    if (col._render) return col._render(col.raw(row), row);

    // Inline toggle — flips the boolean on the record via a server action.
    if (col._kind === "toggle") {
      const on = !!col.raw(row);
      const id = String(row[this._resource.primaryKey]);
      return (
        <button
          type="button"
          role="switch"
          onClick={this.toggleColumn}
          data-args={JSON.stringify([id, col.getColumn(), !on])}
          class={`relative inline-flex h-5 w-9 items-center rounded-full transition ${on ? "bg-primary" : "bg-input"}`}
        >
          <span
            class={`inline-block h-4 w-4 rounded-full bg-background shadow transition ${on ? "translate-x-4" : "translate-x-0.5"}`}
          />
        </button>
      );
    }

    // Inline select — saves the chosen value on change (model syncs first).
    if (col._kind === "select") {
      const id = String(row[this._resource.primaryKey]);
      const k = `${id}__${col._key}`;
      if (!(k in this.cellEdits)) this.cellEdits[k] = row[col._key];
      const cur = String(this.cellEdits[k] ?? "");
      return (
        <select
          value={this.cellEdits[k]}
          onChange={this.saveCell}
          data-args={JSON.stringify([id, col.getColumn(), k])}
          class="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none transition focus:ring-2 focus:ring-ring"
        >
          {(col._options ?? []).map((o) => (
            <option value={o.value} selected={String(o.value) === cur}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }

    // Inline text input — saves on change/blur.
    if (col._kind === "input") {
      const id = String(row[this._resource.primaryKey]);
      const k = `${id}__${col._key}`;
      if (!(k in this.cellEdits)) this.cellEdits[k] = row[col._key];
      return (
        <input
          type={col._inputType}
          value={this.cellEdits[k]}
          onChange={this.saveCell}
          data-args={JSON.stringify([id, col.getColumn(), k])}
          class="h-8 w-full max-w-[12rem] rounded-md border border-input bg-background px-2 text-sm outline-none transition focus:ring-2 focus:ring-ring"
        />
      );
    }

    if (col._kind === "image") {
      // Resolved, not printed: a bare `media/x.jpg` is a disk path, and a
      // browser reads it relative to the page.
      const src = resolveMediaSrc(col.raw(row), this._panel.mediaDisk());
      return src ? (
        <img
          src={src}
          alt=""
          class={`h-9 w-9 object-cover ${col._circular ? "rounded-full" : "rounded-md"} border border-border`}
        />
      ) : (
        <span
          class={`flex h-9 w-9 items-center justify-center bg-muted text-muted-foreground ${col._circular ? "rounded-full" : "rounded-md"}`}
        >
          <Icon name="document" class="h-4 w-4" />
        </span>
      );
    }

    if (col._kind === "color") {
      const v = col.raw(row);
      return (
        <span class="inline-flex items-center gap-2">
          <span
            class="h-4 w-4 rounded border border-border"
            style={`background:${v ? String(v) : "transparent"}`}
          />
          <span class="text-xs text-muted-foreground">{v ? String(v) : "—"}</span>
        </span>
      );
    }

    if (col._kind === "icon") {
      const on = !!col.raw(row);
      return (
        <Icon
          name={on ? "check-circle" : "x-circle"}
          class={`h-5 w-5 ${on ? "text-success" : "text-muted-foreground/60"}`}
        />
      );
    }

    const { text, badge } = col.cell(row);
    if (badge) {
      return (
        <span
          class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_CLASS[badge]}`}
        >
          {text}
        </span>
      );
    }
    if (col._copyable) {
      return (
        <span class="inline-flex items-center gap-1">
          {text}
          <button
            type="button"
            onclick={`navigator.clipboard.writeText(${JSON.stringify(text)})`}
            title="Copy"
            class="text-muted-foreground transition hover:text-foreground"
          >
            <Icon name="copy" class="h-3.5 w-3.5" />
          </button>
        </span>
      );
    }
    return text;
  }

  private _params(extra: Record<string, string | number | undefined> = {}): URLSearchParams {
    const sp = new URLSearchParams();
    if (this.tab) sp.set("tab", this.tab);
    if (this.search) sp.set("search", this.search);
    if (this.sortBy) {
      sp.set("sortBy", this.sortBy);
      sp.set("sortDir", this.sortDir);
    }
    if (this.filters) sp.set("filters", this.filters);
    if (this.trashed) sp.set("trashed", this.trashed);
    if (this.perPage) sp.set("perPage", this.perPage);
    if (this.cols) sp.set("cols", this.cols);
    if (this.group) sp.set("group", this.group);
    if (this.sort) sp.set("sort", this.sort);
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined || v === "") sp.delete(k);
      else sp.set(k, String(v));
    }
    return sp;
  }

  /** Build a URL that sets/clears one filter (resets to page 1, keeps other state). */
  /**
   * Set one header filter from its control in the table header.
   *
   * Writes into the same `?filters=` map the filter bar uses, so a header filter
   * survives navigation, lands in a saved view, and shows up in the active-filter
   * chips like any other. Paging resets, because the row someone is filtering for
   * is unlikely to be on the page they were already on.
   */
  @expose setHeaderFilter(key: unknown, value: unknown): void {
    const map = parseFilters(this.filters);
    const raw = String(value ?? "");
    if (raw === "") delete map[String(key)];
    else map[String(key)] = raw;
    this.filters = Object.keys(map).length ? JSON.stringify(map) : "";
    this.page = "1";
  }

  /** One control per column, aligned with the header cells above them. */
  private _headerFilterCells(cols: Column[]): unknown[] {
    const active = parseFilters(this.filters);
    const byColumn = new Map(this._headerFilters().map((f) => [f._column ?? f._key, f]));
    const control =
      "h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring";

    return cols.map((c) => {
      const filter = byColumn.get(c._key);
      if (!filter) return null;
      const current = active[filter._key] ?? "";

      if (filter._type === "text") {
        return (
          <input
            onChange={this.setHeaderFilter}
            data-args={JSON.stringify([filter._key])}
            value={current}
            placeholder="Filter…"
            aria-label={`Filter by ${c.getLabel()}`}
            class={control}
          />
        );
      }

      return (
        <select
          onChange={this.setHeaderFilter}
          data-args={JSON.stringify([filter._key])}
          aria-label={`Filter by ${c.getLabel()}`}
          class={control}
        >
          <option value="">All</option>
          {filter.choices().map((o) => (
            <option value={o.value} selected={o.value === current}>
              {o.label}
            </option>
          ))}
        </select>
      );
    });
  }

  private _filterHref(key: string, value: string): string {
    return "?" + new URLSearchParams(this._filterParams(key, value)).toString();
  }

  /** The full query-string state with one filter set to `value` (empty clears it). */
  private _filterParams(key: string, value: string): Record<string, string> {
    const map = parseFilters(this.filters);
    if (value === "") delete map[key];
    else map[key] = value;
    const sp = this._params({ page: undefined });
    const enc = Object.keys(map).length ? JSON.stringify(map) : "";
    if (enc) sp.set("filters", enc);
    else sp.delete("filters");
    return Object.fromEntries(sp.entries());
  }

  private _pageHref(n: number): string {
    return "?" + this._params({ page: n }).toString();
  }

  /** Tab link — switches the active tab and resets to page 1. */
  private _tabHref(key: string): string {
    const sp = this._params({ page: undefined });
    sp.set("tab", key);
    return "?" + sp.toString();
  }

  override async render(): Promise<HtmlNode> {
    const R = this._resource;
    const currentPage = Math.max(1, parseInt(this.page, 10) || 1);

    // Resolve the active tab (defaults to the first) and its query scope.
    const tabs = R.tabs();
    const activeKey = this.tab || tabs[0]?._key || "";
    const activeTab = tabs.find((t) => t._key === activeKey);

    // Row grouping + reordering scope.
    const groups = R.groups();
    const groupKey = this.group || R.defaultGroup || "";
    const activeGroup = groupKey ? groups.find((g) => g.getColumn() === groupKey) : undefined;
    const reorderCol = R.reorderable;

    // Effective sort: a reorderable table defaults to its position column; the URL
    // sort overrides; an active grouping orders by its column so groups stay
    // contiguous across the page.
    let sortBy = this.sortBy || (reorderCol ?? R.defaultSort?.column) || "";
    let sortDir: "asc" | "desc" = this.sortBy
      ? this.sortDir
      : reorderCol
        ? "asc"
        : (R.defaultSort?.direction ?? "asc");
    if (activeGroup) {
      sortBy = activeGroup.getColumn();
      sortDir = "asc";
    }
    // The header link sorts by a column *key*; translate it to the DB column for the
    // query (a camelCase key may map to a snake_case column via `.column()`).
    const querySortBy = sortBy
      ? (R.columns()
          .find((c) => c._key === sortBy)
          ?.getColumn() ?? sortBy)
      : "";

    // Active filters compose with the active tab to scope the query.
    const declaredFilters = R.filters();
    const headerFilters = this._headerFilters();
    const resourceFilters = [...declaredFilters, ...headerFilters];
    const active = parseFilters(this.filters);
    const modifyQuery = (q: AdminQuery): AdminQuery => {
      // The parent scope goes on first: a nested resource must never widen past
      // its parent, whatever a tab or filter asks for.
      q = this._scopeToParent(q);
      if (activeTab?._modify) q = activeTab._modify(q);
      for (const f of resourceFilters) {
        const v = active[f._key];
        if (v != null && v !== "") q = f.apply(q, v);
      }
      return q;
    };

    // Soft-delete scope (only when the model supports it).
    const trashedMode: "with" | "only" | undefined =
      R.usesSoftDeletes() && (this.trashed === "with" || this.trashed === "only")
        ? this.trashed
        : undefined;

    // The resource's widgets, rendered above the table. Prefixed so their canvas
    // ids can't collide with a dashboard's.
    const savedViews = await this._savedViews();
    const resourceWidgets = R.widgets();
    const widgetBlock = await renderWidgets(resourceWidgets, `${R.getSlug()}-chart`);
    const widgetPoll = widgetPollInterval(resourceWidgets);

    // The parent's own title, so a nested list's trail reads "Posts / Hello world /
    // Comments" rather than showing a bare id.
    const parentTitle =
      R.parent && this.parentId
        ? await R.parentResource()!
            .find(this.parentId)
            .then((rec) => (rec ? R.parentResource()!.recordTitle(rec) : null))
            .catch(() => null)
        : null;

    // Secondary sorts sit beneath the header's own, applied in the order given.
    const extraSorts = this.sort
      .split(",")
      .map((part) => part.split(":"))
      .filter((pair): pair is [string, string] => Boolean(pair[0]))
      .map(([col, dir]) => ({ column: col!, direction: dir === "desc" ? "desc" : "asc" }) as const);

    const result = await R.records({
      page: currentPage,
      perPage: Math.max(1, parseInt(this.perPage, 10) || R.perPage),
      search: this.search || undefined,
      sortBy: querySortBy || undefined,
      sortDir,
      modifyQuery,
      trashed: trashedMode,
      thenSort: extraSorts,
    });

    // Tab badge counts. The live (non-fixed) counts are search-independent
    // totals that change only on writes, so they're cached per resource and
    // invalidated by AdminProvider on `ModelChanged`.
    const badgeTabs = tabs.filter((t) => t._badge);
    const liveTabs = badgeTabs.filter((t) => t._badgeValue === undefined);
    // Counts are per parent for a nested resource, so the cache key carries the
    // parent id — otherwise every parent would read the first one's totals.
    const countKey = this.parentId ? `${R.getSlug()}:${this.parentId}` : R.getSlug();
    const counts = liveTabs.length
      ? await rememberTabCounts(countKey, async () => {
          const out: Record<string, number> = {};
          await Promise.all(
            liveTabs.map(
              async (t) =>
                (out[t._key] = await R.count((q) =>
                  t._modify ? t._modify(this._scopeToParent(q)) : this._scopeToParent(q),
                )),
            ),
          );
          return out;
        })
      : {};
    const tabBadges: Record<string, number | string> = {};
    for (const t of badgeTabs) tabBadges[t._key] = t._badgeValue ?? counts[t._key] ?? 0;

    const allCols = R.columns();
    const hiddenCols = this._hiddenCols();
    const cols = allCols.filter((c) => !hiddenCols.has(c._key));
    // A tree resource arranges its page into parent/child order and remembers
    // how deep each row sits, so the first column can indent by it.
    const arranged = R.treeParentColumn ? R.arrangeTree(result.rows) : null;
    if (arranged) result.rows = arranged.map((a) => a.row);
    const depthOf = new Map(arranged?.map((a) => [String(a.row[R.primaryKey]), a.depth]) ?? []);

    const tableColumns: TableColumn[] = cols.map((c, colIndex) => ({
      key: c._key,
      label: c.getLabel(),
      sortable: c._sortable,
      class: c._align === "end" ? "text-right" : c._align === "center" ? "text-center" : undefined,
      render: (row: Record<string, unknown>) => {
        const cell = this._cell(c, row);
        const depth = colIndex === 0 ? (depthOf.get(String(row[R.primaryKey])) ?? 0) : 0;
        if (depth === 0) return cell;
        // Indent the first column by depth, with a marker so a child reads as
        // one rather than as a row that happens to start further right.
        return (
          <span class="inline-flex items-center gap-1" style={`padding-left:${depth * 16}px`}>
            <span class="text-muted-foreground/50">└</span>
            {cell}
          </span>
        );
      },
    }));

    // Leading selection column (only when the resource has bulk actions).
    const bulkActions = this._bulkActions();
    const pk = R.primaryKey;
    if (bulkActions.length > 0) {
      const pageIds = result.rows.map((r) => String(r[pk]));
      const allOnPage = pageIds.length > 0 && pageIds.every((id) => this.selected.includes(id));
      tableColumns.unshift({
        key: "__select",
        label: (
          <input
            type="checkbox"
            checked={allOnPage}
            onClick={this.toggleSelectAll}
            data-args={JSON.stringify([pageIds])}
            class="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
          />
        ),
        class: "w-1",
        render: (row: Record<string, unknown>) => (
          <input
            type="checkbox"
            checked={this.selected.includes(String(row[pk]))}
            onClick={this.toggleSelect}
            data-args={JSON.stringify([String(row[pk])])}
            class="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
          />
        ),
      });
    }

    // Trailing row-actions column — renders the (soft-delete-aware) row actions
    // (View / Edit / Delete, plus Restore / Force-delete on trashed rows).
    const recordActions = this._rowActions();
    tableColumns.push({
      key: "__actions",
      label: "",
      class: "w-1 whitespace-nowrap text-right",
      render: (row: Record<string, unknown>) => {
        const ctx = this._ctx(row);
        const id = String(row[pk]);
        // A declared group renders as its own dropdown; loose actions are shown
        // inline until there are too many, then the surplus collapses into one.
        const groups = recordActions.filter((a): a is ActionGroup => a instanceof ActionGroup);
        const loose = recordActions.filter((a): a is Action => a instanceof Action);
        const visible = loose.filter((a) => a.isVisibleFor(row as AdminRecord, ctx));
        const inline = visible.length > 3 ? visible.slice(0, 2) : visible;
        const overflow = visible.length > 3 ? visible.slice(2) : [];
        return (
          <div class="flex items-center justify-end gap-1">
            {inline.map((a) =>
              renderAction(a, ctx, {
                onRun: this.runAction,
                onForm: this.openActionForm,
                args: [a._key, id],
              }),
            )}
            {groups.map((g) =>
              renderActionGroup(g, ctx, {
                onRun: this.runAction,
                onForm: this.openActionForm,
                argsFor: (a) => [a._key, id],
              }),
            )}
            {overflow.length > 0 ? (
              <DropdownMenu
                align="right"
                trigger={
                  <button
                    type="button"
                    title="More actions"
                    class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-lg leading-none text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
                  >
                    ⋯
                  </button>
                }
              >
                {overflow.map((a) =>
                  renderActionMenuItem(a, ctx, {
                    onRun: this.runAction,
                    onForm: this.openActionForm,
                    args: [a._key, id],
                  }),
                )}
              </DropdownMenu>
            ) : null}
          </div>
        );
      },
    });

    // Leading reorder column (drag-style up/down handles persist a position column).
    if (reorderCol) {
      const pageIds = result.rows.map((r) => String(r[pk]));
      const ctrl =
        "flex h-6 w-6 items-center justify-center rounded border border-input text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-30";
      tableColumns.unshift({
        key: "__reorder",
        label: "",
        class: "w-1",
        render: (row: Record<string, unknown>) => {
          const id = String(row[pk]);
          const idx = pageIds.indexOf(id);
          const atTop = result.page === 1 && idx === 0;
          const atBottom = result.page === result.lastPage && idx === pageIds.length - 1;
          return (
            <div class="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={this.moveRow}
                data-args={JSON.stringify([id, -1])}
                disabled={atTop}
                class={ctrl}
                aria-label="Move up"
              >
                <Icon name="chevron-down" class="h-3.5 w-3.5 rotate-180" />
              </button>
              <button
                type="button"
                onClick={this.moveRow}
                data-args={JSON.stringify([id, 1])}
                disabled={atBottom}
                class={ctrl}
                aria-label="Move down"
              >
                <Icon name="chevron-down" class="h-3.5 w-3.5" />
              </button>
            </div>
          );
        },
      });
    }

    // Column summaries — a table-level footer over the full filtered dataset, plus
    // per-group subtotals when a grouping is active.
    const summaryCols = cols.filter((c) => c.hasSummary());
    const hasSummaries = summaryCols.length > 0;
    const buildFooter = (rowsForCalc: Record<string, unknown>[]): unknown[] | undefined => {
      if (!hasSummaries) return undefined;
      let labelled = false;
      return tableColumns.map((tc) => {
        const col = cols.find((c) => c._key === tc.key);
        if (!col || !col.hasSummary()) {
          if (!labelled) {
            labelled = true;
            return <span class="text-xs font-semibold text-muted-foreground">Total</span>;
          }
          return null;
        }
        return (
          <div class="flex flex-col gap-0.5">
            {col.computeSummaries(rowsForCalc).map((it) => (
              <div class="whitespace-nowrap text-xs">
                <span class="text-muted-foreground">{it.label}: </span>
                <span class="font-semibold tabular-nums text-foreground">{it.text}</span>
              </div>
            ))}
          </div>
        );
      });
    };
    const allRows = hasSummaries
      ? await R.listAll({
          search: this.search || undefined,
          sortBy: querySortBy || undefined,
          sortDir,
          modifyQuery,
          trashed: trashedMode,
        })
      : [];
    const footerCells = buildFooter(allRows);

    // Partition the page's rows into ordered groups.
    let tableGroups: TableGroup[] | undefined;
    if (activeGroup) {
      const buckets: Array<{ key: string; title: string; rows: Record<string, unknown>[] }> = [];
      const index = new Map<
        string,
        { key: string; title: string; rows: Record<string, unknown>[] }
      >();
      for (const row of result.rows) {
        const title = activeGroup.titleFor(row);
        let b = index.get(title);
        if (!b) {
          b = { key: title, title, rows: [] };
          index.set(title, b);
          buckets.push(b);
        }
        b.rows.push(row);
      }
      tableGroups = buckets.map((b) => ({
        key: b.key,
        header: (
          <span class="inline-flex items-center gap-2 text-sm">
            <span class="font-semibold">
              {activeGroup.getLabel()}: {b.title}
            </span>
            <span class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {b.rows.length}
            </span>
          </span>
        ),
        rows: b.rows,
        footerCells: buildFooter(b.rows),
      }));
    }

    // Contributed chrome for this screen. The context lets a hook target one
    // resource without registering a hook per resource.
    const hookCtx = { resource: R.getSlug(), page: "list" as const };
    const hook = (name: Parameters<typeof this._panel.renderHooks>[0]): (HtmlNode | string)[] =>
      resolveRenderHooks(this._panel.renderHooks(name), hookCtx);

    const from = result.total === 0 ? 0 : (result.page - 1) * result.perPage + 1;
    const to = Math.min(result.page * result.perPage, result.total);

    return (
      // A polling widget above the table refreshes the whole page, table included
      // — which is what someone watching a queue actually wants.
      <div
        class="mx-auto w-full max-w-7xl space-y-6"
        {...(widgetPoll ? { poll: { every: widgetPoll } } : {})}
      >
        {hook("page.header.start")}

        {/* Header */}
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Breadcrumbs
              trail={resourceTrail({
                panel: this._panel,
                resource: R,
                parentId: this.parentId || undefined,
                parentTitle: parentTitle ?? undefined,
              })}
            />
            <h1 class="text-2xl font-semibold tracking-tight">{R.getPluralLabel()}</h1>
            <p class="mt-1 text-sm text-muted-foreground">
              {result.total}{" "}
              {result.total === 1 ? R.getLabel().toLowerCase() : R.getPluralLabel().toLowerCase()}
            </p>
          </div>
          <div class="flex items-center gap-2">
            {savedViews}
            {R.headerActions().map((a) =>
              a instanceof ActionGroup
                ? renderActionGroup(a, this._ctxBase(), {
                    onRun: this.runAction,
                    onForm: this.openActionForm,
                    argsFor: (member) => [member._key, ""],
                  })
                : renderAction(a, this._ctxBase(), {
                    onRun: this.runAction,
                    onForm: this.openActionForm,
                    args: [a._key, ""],
                  }),
            )}
          </div>
        </div>

        {hook("page.header.end")}

        {/* The resource's own widgets — what's going on in this list. */}
        {widgetBlock}

        {/* Filter tabs */}
        {tabs.length > 0 ? (
          <div class="flex flex-wrap items-center gap-1 border-b border-border">
            {tabs.map((t) => {
              const isActive = t._key === activeKey;
              const badge = tabBadges[t._key];
              return (
                <a
                  href={this._tabHref(t._key)}
                  navigate
                  class={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                  }`}
                >
                  {t._icon ? <Icon name={t._icon} class="h-4 w-4" /> : null}
                  {t.getLabel()}
                  {badge !== undefined ? (
                    <span
                      class={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold ${BADGE_CLASS[t._badgeTone]}`}
                    >
                      {String(badge)}
                    </span>
                  ) : null}
                </a>
              );
            })}
          </div>
        ) : null}

        {/* Locale switch, for a resource whose fields carry translations. */}
        {R.translatable.length > 0 && R.locales.length > 1 ? (
          <div class="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 text-sm">
            {R.locales.map((code) => {
              const on = this._locale() === code;
              return (
                <a
                  href={this._localeHref(code)}
                  navigate
                  class={`rounded-md px-3 py-1 font-medium uppercase transition ${
                    on
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {code}
                </a>
              );
            })}
          </div>
        ) : null}

        {/* Soft-delete scope switch (Active / All / Trashed). */}
        {R.usesSoftDeletes() ? (
          <div class="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 text-sm">
            {[
              { v: "", label: "Active" },
              { v: "with", label: "All" },
              { v: "only", label: "Trashed" },
            ].map((opt) => {
              const on = (this.trashed || "") === opt.v;
              return (
                <a
                  href={this._trashedHref(opt.v)}
                  navigate
                  class={`rounded-md px-3 py-1 font-medium transition ${
                    on
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </a>
              );
            })}
          </div>
        ) : null}

        {/* Query builders — stacked comparisons with nested AND/OR groups. */}
        {declaredFilters
          .filter((f) => f._type === "builder")
          .map((f) => this._queryBuilder(f, Boolean(active[f._key])))}

        {/* Active-filter indicators — what is narrowing this list, and how to undo it. */}
        {this._filterIndicators(declaredFilters, active)}

        {/* Filters — URL-driven; compose with tabs, search, sort, pagination. */}
        {declaredFilters.filter((f) => f._type !== "builder").length > 0
          ? this._filterBar(
              declaredFilters.filter((f) => f._type !== "builder"),
              active,
            )
          : null}

        {/* Bulk action toolbar — shown while rows are selected. */}
        {this.selected.length > 0 && bulkActions.length > 0 ? (
          <div class="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            <span class="text-sm font-medium">{this.selected.length} selected</span>
            <div class="flex items-center gap-2">
              {bulkActions.map((a) =>
                a instanceof ActionGroup
                  ? renderActionGroup(a, this._ctxBase(), {
                      onRun: this.runBulkAction,
                      onForm: this.openActionForm,
                      argsFor: (member) => [member._key],
                    })
                  : renderAction(a, this._ctxBase(), {
                      onRun: this.runBulkAction,
                      onForm: this.openActionForm,
                      args: [a._key],
                    }),
              )}
            </div>
            <button
              type="button"
              onClick={this.clearSelection}
              class="ml-auto text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Clear
            </button>
          </div>
        ) : null}

        {/* Card: search + table */}
        <div class="rounded-xl border border-border bg-card text-card-foreground shadow-sm">
          <div class="flex items-center justify-between gap-3 border-b border-border p-3">
            {R.searchableColumns().length > 0 ? (
              <div class="relative max-w-sm flex-1">
                <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                  <Icon name="search" class="h-4 w-4" />
                </span>
                <input
                  value={this.search}
                  placeholder={`Search ${R.getPluralLabel().toLowerCase()}…`}
                  class="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none transition focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background placeholder:text-muted-foreground"
                />
              </div>
            ) : (
              <span />
            )}
            <div class="flex items-center gap-2">
              {/* Group by */}
              {groups.length > 0 ? (
                <DropdownMenu
                  align="right"
                  trigger={
                    <button
                      type="button"
                      class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm font-medium transition hover:bg-accent hover:text-accent-foreground"
                    >
                      <Icon name="collection" class="h-4 w-4" />
                      {activeGroup ? `Grouped by ${activeGroup.getLabel()}` : "Group"}
                    </button>
                  }
                >
                  <div class="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                    Group by
                  </div>
                  <a
                    href={this._groupHref("")}
                    navigate
                    class="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <span class="flex h-4 w-4 items-center justify-center text-primary">
                      {!activeGroup ? <Icon name="check-circle" class="h-4 w-4" /> : null}
                    </span>
                    None
                  </a>
                  {groups.map((g) => (
                    <a
                      href={this._groupHref(g.getColumn())}
                      navigate
                      class="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <span class="flex h-4 w-4 items-center justify-center text-primary">
                        {activeGroup?.getColumn() === g.getColumn() ? (
                          <Icon name="check-circle" class="h-4 w-4" />
                        ) : null}
                      </span>
                      {g.getLabel()}
                    </a>
                  ))}
                </DropdownMenu>
              ) : null}
              {/* Column visibility manager */}
              {allCols.length > 1 ? (
                <DropdownMenu
                  align="right"
                  trigger={
                    <button
                      type="button"
                      class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm font-medium transition hover:bg-accent hover:text-accent-foreground"
                    >
                      <Icon name="layout-grid" class="h-4 w-4" /> Columns
                    </button>
                  }
                >
                  <div class="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                    Toggle columns
                  </div>
                  {allCols.map((c) => {
                    const shown = !hiddenCols.has(c._key);
                    return (
                      <a
                        href={this._colHref(c._key)}
                        navigate
                        class="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                      >
                        <span class="flex h-4 w-4 items-center justify-center text-primary">
                          {shown ? <Icon name="check-circle" class="h-4 w-4" /> : null}
                        </span>
                        {c.getLabel()}
                      </a>
                    );
                  })}
                </DropdownMenu>
              ) : null}
            </div>
          </div>

          {hook("table.start")}

          <div class={R.tableLayout === "table" ? "overflow-x-auto p-1.5" : "p-3"}>
            {result.rows.length === 0 ? (
              this._emptyState()
            ) : R.tableLayout === "grid" ? (
              this._grid(cols, result.rows, pk)
            ) : R.tableLayout === "kanban" && R.kanbanColumn ? (
              this._kanban(cols, result.rows, pk)
            ) : R.tableLayout === "calendar" && R.calendarColumn ? (
              this._calendar(cols, result.rows, pk)
            ) : (
              <Table
                columns={tableColumns}
                rows={result.rows}
                groups={tableGroups}
                footerCells={footerCells}
                sortBy={sortBy}
                sortDir={sortDir}
                params={{ search: this.search, tab: this.tab }}
                {...(headerFilters.length > 0
                  ? { filterCells: this._headerFilterCells(cols) }
                  : {})}
                hover
                {...(this._tableClass() ? { class: this._tableClass()! } : {})}
                {...(R.stickyHeader
                  ? { theadClass: "sticky top-0 z-10 bg-card [&_th]:bg-card" }
                  : {})}
              />
            )}
          </div>

          {hook("table.end")}

          {/* Footer: row count + per-page selector + pagination */}
          {result.total > 0 ? (
            <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
              <div class="flex items-center gap-2 text-muted-foreground">
                <span>
                  Showing <span class="font-medium text-foreground">{from}</span>–
                  <span class="font-medium text-foreground">{to}</span> of{" "}
                  <span class="font-medium text-foreground">{result.total}</span>
                </span>
                <span class="mx-1 hidden sm:inline">·</span>
                <span class="hidden sm:inline">Per page:</span>
                <span class="hidden items-center gap-0.5 sm:inline-flex">
                  {[10, 15, 25, 50].map((n) => {
                    const on = (parseInt(this.perPage, 10) || R.perPage) === n;
                    return (
                      <a
                        href={this._perPageHref(n)}
                        navigate
                        class={`rounded px-1.5 py-0.5 transition ${on ? "bg-accent font-semibold text-foreground" : "hover:text-foreground"}`}
                      >
                        {n}
                      </a>
                    );
                  })}
                </span>
              </div>
              <Pagination
                page={result.page}
                lastPage={result.lastPage}
                total={result.total}
                perPage={result.perPage}
                href={(n) => this._pageHref(n)}
              />
            </div>
          ) : null}
        </div>

        {/* Modal-form action host (opened by actions declared with `.form()`). */}
        {this._actionModal()}
      </div>
    );
  }
}

/**
 * Build a uniquely-named List page subclass bound to a resource. The distinct
 * class name keeps Flow's snapshot/component identity stable per resource.
 */
export function makeResourceListPage(
  resource: ResourceClass,
  panel: PanelInstance = Panel.default(),
): typeof ResourceListPage {
  const Page = class extends ResourceListPage {
    static override resource = resource;
    static override panel = panel;
    static override layout = makeAdminLayout(panel);
  };
  Object.defineProperty(Page, "name", { value: `${resource.getModelName()}ListPage` });
  return Page;
}
