/**
 * Resource — the declarative description of one model's admin interface. It
 * carries the navigation metadata, the table columns, the form and infolist
 * schemas, and a paginated, sortable, searchable record query backed by
 * `@zerotal/orm`.
 *
 *   export class UserResource extends Resource {
 *     static model = User;
 *     static navigationIcon = "users";
 *     static navigationGroup = "Access";
 *     static columns() {
 *       return [
 *         text("id").sortable(),
 *         text("name").searchable().sortable(),
 *         text("email").searchable(),
 *         text("created_at").label("Joined").since().sortable(),
 *       ];
 *     }
 *   }
 *
 * Later phases add `form()`, `infolist()`, actions, and policies — none of which
 * change this read-side contract.
 */
import { pluralize } from "@zerotal/core/helpers";
import type { ClusterClass } from "./Cluster.ts";
import type { Column } from "./table/Column.ts";
import type { Tab } from "./table/Tab.ts";
import type { Group } from "./table/Group.ts";
import type { Filter } from "./table/Filter.ts";
import type { InfolistComponent } from "./infolist/index.ts";
import type { FormComponent } from "./form/index.ts";
import { flattenFields } from "./form/index.ts";
import type { RelationManager } from "./relations/RelationManager.ts";
import type { DashboardWidget } from "./widgets/Widget.ts";
import {
  type ActionItem,
  viewAction,
  editAction,
  deleteAction,
  createAction,
  bulkDeleteAction,
} from "./actions/index.ts";

/** Loosely-typed view of an ORM query builder — avoids a hard dependency on @zerotal/orm. */
export interface AdminQuery {
  where(column: string, operator: unknown, value?: unknown): AdminQuery;
  /** Nest predicates into one parenthesised group, so an `OR` inside can't escape it. */
  where(group: (query: AdminQuery) => void): AdminQuery;
  orWhere?(column: string, operator: unknown, value?: unknown): AdminQuery;
  orWhere?(group: (query: AdminQuery) => void): AdminQuery;
  whereLike?(column: string, value: string): AdminQuery;
  orWhereLike?(column: string, value: string): AdminQuery;
  whereNotLike?(column: string, value: string): AdminQuery;
  orWhereNotLike?(column: string, value: string): AdminQuery;
  whereNull?(column: string): AdminQuery;
  orWhereNull?(column: string): AdminQuery;
  whereNotNull?(column: string): AdminQuery;
  orWhereNotNull?(column: string): AdminQuery;
  whereIn?(column: string, values: unknown[]): AdminQuery;
  whereNotIn?(column: string, values: unknown[]): AdminQuery;
  with?(relation: string): AdminQuery;
  orderBy(column: string, direction?: "asc" | "desc"): AdminQuery;
  limit(n: number): AdminQuery;
  offset(n: number): AdminQuery;
  count(): Promise<number>;
  get?(): Promise<Record<string, unknown>[]>;
  all?(): Promise<Record<string, unknown>[]>;
}

/** Scopes a list query — used by tabs and ad-hoc filters. */
export type QueryModifier = (query: AdminQuery) => AdminQuery;

/** A loaded record — a plain row or a model instance with mutation helpers. */
export interface AdminRecord {
  delete?(): Promise<void>;
  fill?(data: Record<string, unknown>): unknown;
  save?(): Promise<unknown>;
  /** Soft-delete helpers (present on SoftDeletes models). */
  restore?(): Promise<void>;
  forceDelete?(): Promise<void>;
  trashed?(): boolean;
  [key: string]: unknown;
}

/**
 * Loosely-typed view of an ORM model class. Row methods are intentionally `any`
 * so concrete ORM model classes (whose instances lack a string index signature)
 * remain assignable to `static model` without a cast.
 */
export interface AdminModel {
  name?: string;
  /** True for models using the SoftDeletes mixin. */
  softDeletes?: boolean;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  query?(): AdminQuery;
  all?(): Promise<any[]>;
  count?(): Promise<number>;
  find?(id: unknown): Promise<any>;
  create?(data: Record<string, unknown>): Promise<any>;
  /** Soft-delete query scopes (SoftDeletes mixin). */
  withTrashed?(): AdminQuery;
  onlyTrashed?(): AdminQuery;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** What the list shows in place of a table when the resource holds nothing. */
export interface EmptyState {
  heading: string;
  /** A sentence explaining why it's empty and what fills it. */
  description?: string;
  /** Icon name from the panel's icon set. */
  icon?: string;
  /** Offered alongside the message — usually a create action. */
  actions?: ActionItem[];
}

/** @internal */
export interface RecordPage {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  perPage: number;
  lastPage: number;
}

export interface ListOptions {
  page?: number | undefined;
  perPage?: number | undefined;
  search?: string | undefined;
  sortBy?: string | undefined;
  sortDir?: "asc" | "desc" | undefined;
  /** Scope the base query before search/sort/pagination (e.g. the active tab). */
  modifyQuery?: QueryModifier | undefined;
  /** Soft-delete scope: include trashed (`with`) or only trashed (`only`). */
  trashed?: "with" | "only" | undefined;
  /**
   * Tie-breakers applied after the primary sort, in order. "By status, then
   * newest first" is two entries rather than a bespoke query.
   */
  thenSort?: readonly { column: string; direction: "asc" | "desc" }[] | undefined;
}

export abstract class Resource {
  /** The ORM model class this resource manages. */
  static model: AdminModel;

  /** URL slug; defaults to a kebab-cased plural of the model name. */
  static slug?: string;
  /** Singular label; defaults to the model name. */
  static label?: string;
  /** Plural label; defaults to the pluralized label. */
  static pluralLabel?: string;

  /**
   * The {@link Cluster} this resource belongs to. Members share the cluster's
   * URL segment and sit under one sidebar entry.
   */
  static cluster?: ClusterClass;

  /**
   * Nest this resource under a parent record, so its pages live at
   * `/admin/posts/7/comments` rather than `/admin/comments`. Every list query is
   * scoped to the parent by `foreignKey`, and new records inherit it.
   *
   *   static parent = { resource: () => PostResource, foreignKey: "post_id" };
   *
   * The parent is named by a function because the two resources almost always
   * reference each other — the parent lists the child as a relation, the child
   * names the parent here — and a direct reference would resolve to `undefined`
   * on whichever side the module cycle happened to evaluate first.
   */
  static parent?: { resource: () => typeof Resource; foreignKey: string };

  /** The parent resource, resolved. */
  static parentResource(): typeof Resource | undefined {
    return this.parent?.resource();
  }

  /**
   * Back a single row rather than a collection — site settings, a company
   * profile. The resource mounts one route (`/admin/settings`) that opens the
   * edit form directly; there is no list, no create page and no record id. The
   * row is resolved by {@link singularRecord}, which creates it on first use.
   */
  static singular = false;

  /** Navigation icon key (see `ui/icons.ts`). */
  static navigationIcon = "collection";
  /** Optional sidebar group heading. */
  static navigationGroup?: string;
  /** Nest this item under another resource's nav label. */
  static navigationParentItem?: string;
  /** Sort order within the sidebar (lower = higher). */
  static navigationSort = 0;

  /** Tone for the sidebar navigation badge. */
  static navigationBadgeColor: "primary" | "success" | "muted" | "destructive" = "primary";

  /**
   * A count or label shown beside this item in the sidebar. Return
   * `null`/`undefined` for no badge. Resolved on each render, so cache an
   * expensive count rather than paying for it on every page.
   *
   *   static async navigationBadge() { return this.count(); }
   */
  static navigationBadge(): Promise<string | number | null> | string | number | null {
    return null;
  }

  /** Default page size for the list table. */
  static perPage = 15;

  /** Primary-key column, used to build View links and to find/delete records. */
  static primaryKey = "id";

  /** Initial sort applied when the URL doesn't specify one. */
  static defaultSort?: { column: string; direction?: "asc" | "desc" };

  /** Relations to eager-load for list + view (so columns/entries can read them). */
  static eager: string[] = [];

  /** List-page filter tabs. Override to add them. */
  static tabs(): Tab[] {
    return [];
  }

  /** List-page filters. Override to add them. */
  static filters(): Filter[] {
    return [];
  }

  /** Row groupings offered on the list table. */
  static groups(): Group[] {
    return [];
  }

  /** Grouping applied by default (a column key from {@link groups}). */
  static defaultGroup?: string;

  /**
   * Enable drag-style row reordering by persisting a position column. Set to the
   * integer column that stores order (e.g. `"sort"`); the list page then shows
   * up/down reorder controls and orders by this column.
   */
  static reorderable?: string;

  /** Column used to title a record in global search, breadcrumbs, etc. */
  static recordTitleAttribute?: string;

  /** Resolve a human-readable title for a record. */
  static recordTitle(record: Record<string, unknown>): string {
    const attr = this.recordTitleAttribute;
    if (attr && record[attr] != null) return String(record[attr]);
    return String(record["name"] ?? record["title"] ?? record[this.primaryKey] ?? "Record");
  }

  /** Whether this resource participates in global search (has searchable columns). */
  static globallySearchable(): boolean {
    return this.searchableColumns().length > 0;
  }

  /** Relation managers shown on the View page. */
  static relations(): RelationManager[] {
    return [];
  }

  /** Table columns. Override in the subclass. */
  static columns(): Column[] {
    return [];
  }

  /**
   * View-page schema — an infolist: an ordered list of
   * {@link Section}s and/or entries. Override to customize the detail page;
   * when left empty it falls back to a single section derived from `columns()`.
   */
  static infolist(): InfolistComponent[] {
    return [];
  }

  /**
   * Form schema for the Create/Edit pages: an ordered list of
   * {@link Field}s. Use `.visibleOn("create")` / `.hiddenOn("edit")` to vary a
   * field by page. An empty list disables Create/Edit for the resource.
   */
  static form(): FormComponent[] {
    return [];
  }

  /** Whether this resource exposes Create/Edit pages (any fields defined). */
  static isEditable(): boolean {
    return flattenFields(this.form()).length > 0;
  }

  // ── Actions: per-row, above the table, and over a selection ─────────────────
  //
  // Any of these may return an {@link actionGroup} in place of an action, which
  // collapses its members into one dropdown.

  /** Per-row actions. Defaults to View + Edit + Delete; override to customize. */
  static recordActions(): ActionItem[] {
    return [viewAction(), editAction(), deleteAction()];
  }

  /** Actions shown above the table (defaults to a Create button). */
  static headerActions(): ActionItem[] {
    return [createAction()];
  }

  /** Actions applied to the selected rows (defaults to bulk Delete). */
  static bulkActions(): ActionItem[] {
    return [bulkDeleteAction()];
  }

  /**
   * Show a history of changes on the record page, read from `@zerotal/audit`.
   *
   * Requires the model to compose `Auditable`; without it there is nothing
   * recorded to show. An update can be put back from there.
   */
  static history = false;

  /**
   * Allow operators to act as one of these records — a user resource, in
   * practice. Off by default: `can()` defaults to allowing, which is the wrong
   * default for becoming somebody else, so this carries the refusal.
   */
  static impersonatable = false;

  /**
   * Guard against two people saving the same record over each other.
   *
   * Names the column holding the row's version — `updated_at` in almost every
   * schema. The edit form carries the value it loaded, and a save whose value no
   * longer matches is refused rather than silently overwriting the other change.
   */
  static optimisticLock?: string;

  /**
   * Render this resource as a tree, nesting each record under its parent.
   *
   * Names the self-referencing column. The list orders and indents by depth, so
   * categories or an org chart read as the shape they are.
   */
  static treeParentColumn?: string;

  /**
   * Fields stored per locale, as `{ en: "…", fr: "…" }` JSON columns.
   *
   * The form and table show one locale at a time, switched from the list; the
   * stored shape is unchanged, so nothing outside the panel has to know.
   */
  static translatable: string[] = [];

  /** Locales offered when a resource is translatable. */
  static locales: string[] = ["en"];

  // ── Table presentation ──────────────────────────────────────────────────────

  /**
   * How the list renders its records.
   *
   * `"table"` is right for data you scan and compare. `"grid"` suits records you
   * recognise by sight — products, media, people — where a thumbnail and a name
   * beat a row of columns.
   */
  static tableLayout: "table" | "grid" | "kanban" | "calendar" = "table";

  /** Column a kanban board groups its lanes by — a status, usually. */
  static kanbanColumn?: string;

  /** Lane order and labels for a kanban board, keyed by the column's values. */
  static kanbanLanes: Record<string, string> = {};

  /** Date column a calendar lays records out on. */
  static calendarColumn?: string;

  /** Shade alternating rows. Helps the eye track across a wide table. */
  static striped = false;

  /** Keep the header visible while the body scrolls. */
  static stickyHeader = false;

  /** Row height. `"compact"` fits noticeably more on screen. */
  static density: "comfortable" | "compact" = "comfortable";

  /**
   * Where the filters sit.
   *
   * `"inline"` keeps them above the table, which is fine for two or three.
   * `"panel"` collapses them behind a Filters button, and `"drawer"` slides them
   * in from the side — both worth it once filters outnumber the space for them.
   */
  static filterLayout: "inline" | "panel" | "drawer" = "inline";

  /**
   * Widgets shown above this resource's table, and on its record pages.
   *
   * The dashboard answers "how is the business doing"; these answer "what is
   * going on in *this* list" — a pending count above the orders table, a revenue
   * chart above products. Same widget builders as the dashboard, so `.poll()`
   * works here too.
   *
   *   static widgets() {
   *     return [statsWidget(async () => [stat("Pending", await Order.pending())])];
   *   }
   */
  static widgets(): DashboardWidget[] {
    return [];
  }

  /**
   * What a user sees instead of a table when there is nothing to show.
   *
   * A blank table teaches nobody anything. Override this to say why the list is
   * empty and what to do about it — the difference between "No records" and
   * "No orders yet. They'll appear here once a customer checks out."
   *
   *   static emptyState() {
   *     return {
   *       heading: "No orders yet",
   *       description: "Orders appear here as soon as a customer checks out.",
   *       icon: "inbox",
   *     };
   *   }
   *
   * A search or filter that matches nothing gets a different, automatic message —
   * this is for a genuinely empty resource.
   */
  static emptyState(): EmptyState {
    return {
      heading: `No ${this.getPluralLabel().toLowerCase()} yet`,
      icon: "inbox",
    };
  }

  /**
   * Authorization gate (policies). Returns `true` by default; override to
   * enforce permissions, e.g. delegate to `@zerotal/auth`'s Gate:
   *
   *   static can(ability: string, record?: AdminRecord) {
   *     return Gate.allows(ability, record ?? this.model);
   *   }
   *
   * Abilities used by the built-in actions: `create`, `update`, `delete`,
   * `restore`, `forceDelete`.
   */
  static can(_ability: string, _record?: AdminRecord): boolean {
    return true;
  }

  // ── Form lifecycle hooks ────────────────────────────────────────────────────

  /** Transform a record into form state before the Edit form is filled. */
  static mutateFormDataBeforeFill(data: AdminRecord): AdminRecord {
    return data;
  }

  /** Transform validated form data just before create/update. */
  static mutateBeforeSave(data: AdminRecord, _mode: "create" | "edit"): AdminRecord {
    return data;
  }

  /** Hook fired after a successful create/update (e.g. sync relations). */
  static async afterSave(_record: AdminRecord, _mode: "create" | "edit"): Promise<void> {}

  // ── Resolved metadata ──────────────────────────────────────────────────────

  static getModelName(): string {
    return this.model?.name ?? this.name.replace(/Resource$/, "");
  }

  static getLabel(): string {
    return this.label ?? titleCase(this.getModelName());
  }

  static getPluralLabel(): string {
    return this.pluralLabel ?? pluralize(this.getLabel());
  }

  static getSlug(): string {
    return this.slug ?? kebab(pluralize(this.getModelName()));
  }

  /**
   * Order rows so each sits under its parent, and report how deep each one is.
   *
   * Done in memory over the page's rows rather than in SQL: a recursive CTE is
   * the right answer for a deep tree, but it is not portable across the drivers
   * the panel supports, and a tree small enough to browse is small enough to
   * arrange here. Orphans — rows whose parent is not in the set — are kept at the
   * top level rather than dropped, so a filtered tree never hides records.
   */
  static arrangeTree(
    rows: Record<string, unknown>[],
  ): { row: Record<string, unknown>; depth: number }[] {
    const column = this.treeParentColumn;
    if (!column) return rows.map((row) => ({ row, depth: 0 }));

    const pk = this.primaryKey;
    const byParent = new Map<string, Record<string, unknown>[]>();
    const ids = new Set(rows.map((r) => String(r[pk])));

    for (const row of rows) {
      const raw = row[column];
      // A parent outside this page's rows is treated as no parent at all.
      const parent = raw == null || !ids.has(String(raw)) ? "" : String(raw);
      byParent.set(parent, [...(byParent.get(parent) ?? []), row]);
    }

    const out: { row: Record<string, unknown>; depth: number }[] = [];
    const seen = new Set<string>();
    const walk = (parent: string, depth: number): void => {
      for (const row of byParent.get(parent) ?? []) {
        const id = String(row[pk]);
        // A cycle in the data must not become an infinite loop in the panel.
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ row, depth });
        walk(id, depth + 1);
      }
    };
    walk("", 0);

    // Anything a cycle kept out still belongs on screen.
    for (const row of rows) if (!seen.has(String(row[pk]))) out.push({ row, depth: 0 });
    return out;
  }

  /**
   * Read a translatable field for one locale.
   *
   * A translatable column stores `{ en: "…", fr: "…" }`; a value that was never
   * translated is returned as-is, so turning translation on for an existing
   * column does not blank it.
   */
  static translated(value: unknown, locale: string): unknown {
    if (value == null || typeof value !== "object" || Array.isArray(value)) return value;
    const map = value as Record<string, unknown>;
    return map[locale] ?? map[this.locales[0] ?? "en"] ?? "";
  }

  // ── URLs ───────────────────────────────────────────────────────────────────
  //
  // Every link into a resource goes through these, so a resource can move into a
  // cluster or under a parent record without any page having to know.

  /**
   * The route pattern for this resource's index, relative to the panel base and
   * with any parent id still a `:param` placeholder.
   */
  static routePath(): string {
    const segments: string[] = [];
    if (this.cluster) segments.push(this.cluster.slug);
    if (this.parent) {
      segments.push(this.parentResource()!.getSlug(), `:${this.parentParam()}`);
    }
    segments.push(this.getSlug());
    return segments.join("/");
  }

  /** Route-parameter name carrying the parent record's id, for a nested resource. */
  static parentParam(): string {
    return this.parent ? `${this.parentResource()!.getSlug().replace(/-/g, "_")}_parent` : "";
  }

  /**
   * This resource's index URL under a panel base. Nested resources need the
   * parent record's id; passing none leaves the placeholder in place.
   */
  static indexUrl(base: string, parentId?: unknown): string {
    const path = this.routePath();
    const resolved =
      this.parent && parentId != null
        ? path.replace(`:${this.parentParam()}`, String(parentId))
        : path;
    return `${base}/${resolved}`;
  }

  static recordUrl(base: string, id: unknown, parentId?: unknown): string {
    return `${this.indexUrl(base, parentId)}/${String(id)}`;
  }

  static createUrl(base: string, parentId?: unknown): string {
    return `${this.indexUrl(base, parentId)}/create`;
  }

  static editUrl(base: string, id: unknown, parentId?: unknown): string {
    // A singular resource has exactly one row and no id in its URL.
    if (this.singular) return this.indexUrl(base, parentId);
    return `${this.recordUrl(base, id, parentId)}/edit`;
  }

  /**
   * Resolve the single row a {@link singular} resource edits, creating it from
   * the form's defaults when it doesn't exist yet.
   */
  static async singularRecord(): Promise<Record<string, unknown> | null> {
    const existing = await this.listAll({ perPage: 1 });
    if (existing[0]) return existing[0];
    const defaults: Record<string, unknown> = {};
    for (const field of flattenFields(this.form())) {
      const value = field.defaultValue();
      if (value !== undefined) defaults[field._key] = value;
    }
    return (await this.create(defaults)) as Record<string, unknown> | null;
  }

  /** Database columns flagged `.searchable()` (honours `.column()` overrides). */
  static searchableColumns(): string[] {
    return this.columns()
      .filter((c) => c._searchable)
      .map((c) => c.getColumn());
  }

  // ── Data ─────────────────────────────────────────────────────────────────

  /**
   * Rows for a resource that isn't backed by an ORM model — an external API, a
   * config file, a computed report.
   *
   * Return the full set; the panel filters, sorts and paginates it in memory,
   * so search, tabs, summaries and the query builder keep working. Returning
   * `null` (the default) means "use `model`", which is the normal case.
   *
   *   static async data() {
   *     return (await fetch("https://api.example.com/regions").then((r) => r.json()));
   *   }
   *
   * Writes are a separate question: a read-only source needs no `form()`, and a
   * writable one overrides `create`, `update` and `destroy` to push changes back
   * wherever they belong.
   */
  static data(): Promise<Record<string, unknown>[] | null> | Record<string, unknown>[] | null {
    return null;
  }

  /**
   * Load a page of records honoring search, sort, and pagination. Defensive
   * about the ORM surface so resources keep working under partial mocks/tests.
   */
  static async records(options: ListOptions = {}): Promise<RecordPage> {
    const perPage = options.perPage ?? this.perPage;
    const page = Math.max(1, options.page ?? 1);
    const search = options.search?.trim();
    const sortBy = options.sortBy;
    const sortDir: "asc" | "desc" = options.sortDir === "desc" ? "desc" : "asc";

    const model = this.model;
    // Fast path: real ORM query builder.
    if (model && typeof model.query === "function") {
      // Pick the soft-delete scope: default (active), with-trashed, or only-trashed.
      const startQuery = (): AdminQuery => {
        if (options.trashed === "only" && typeof model.onlyTrashed === "function")
          return model.onlyTrashed();
        if (options.trashed === "with" && typeof model.withTrashed === "function")
          return model.withTrashed();
        return model.query!();
      };
      const base = (): AdminQuery => {
        let q = startQuery();
        if (options.modifyQuery) q = options.modifyQuery(q);
        for (const rel of this.eager) if (typeof q.with === "function") q = q.with(rel);
        return q;
      };
      const applySearch = (q: AdminQuery): AdminQuery => {
        const cols = this.searchableColumns();
        if (!search || cols.length === 0 || typeof q.whereLike !== "function") return q;
        // First column with whereLike; subsequent with orWhereLike when available.
        let built = q.whereLike(cols[0]!, `%${search}%`);
        for (const col of cols.slice(1)) {
          built = (built.orWhereLike ?? built.whereLike)!.call(built, col, `%${search}%`);
        }
        return built;
      };

      const total = await applySearch(base()).count();
      let q = applySearch(base());
      if (sortBy) q = q.orderBy(sortBy, sortDir);
      for (const extra of options.thenSort ?? []) q = q.orderBy(extra.column, extra.direction);
      q = q.limit(perPage).offset((page - 1) * perPage);
      const rows = (await (q.get ?? q.all)?.call(q)) ?? [];
      return paginateMeta(rows, total, page, perPage);
    }

    // Fallback: load all, then filter/sort/page in memory. A custom `data()`
    // source lands here too — same filtering, no query builder to talk to.
    const custom = await this.data();
    const all = custom ?? (model && (await model.all?.())) ?? [];
    let rows = all as Record<string, unknown>[];
    if (search) {
      const cols = this.searchableColumns();
      const needle = search.toLowerCase();
      rows = rows.filter((r) =>
        cols.some((c) =>
          String(r[c] ?? "")
            .toLowerCase()
            .includes(needle),
        ),
      );
    }
    if (sortBy) {
      rows = [...rows].sort(
        (a, b) => compare(a[sortBy], b[sortBy]) * (sortDir === "desc" ? -1 : 1),
      );
    }
    const total = rows.length;
    const start = (page - 1) * perPage;
    return paginateMeta(rows.slice(start, start + perPage), total, page, perPage);
  }

  /**
   * Load *all* rows matching the current scope (search + tab/filters + trashed),
   * with no pagination — used for column summaries and reorder swaps. Mirrors the
   * scoping of {@link records} but skips `limit`/`offset`.
   */
  static async listAll(options: ListOptions = {}): Promise<Record<string, unknown>[]> {
    const search = options.search?.trim();
    const sortBy = options.sortBy;
    const sortDir: "asc" | "desc" = options.sortDir === "desc" ? "desc" : "asc";
    const model = this.model;

    if (model && typeof model.query === "function") {
      const startQuery = (): AdminQuery => {
        if (options.trashed === "only" && typeof model.onlyTrashed === "function")
          return model.onlyTrashed();
        if (options.trashed === "with" && typeof model.withTrashed === "function")
          return model.withTrashed();
        return model.query!();
      };
      let q = startQuery();
      if (options.modifyQuery) q = options.modifyQuery(q);
      for (const rel of this.eager) if (typeof q.with === "function") q = q.with(rel);
      const cols = this.searchableColumns();
      if (search && cols.length > 0 && typeof q.whereLike === "function") {
        q = q.whereLike(cols[0]!, `%${search}%`);
        for (const col of cols.slice(1)) {
          q = (q.orWhereLike ?? q.whereLike)!.call(q, col, `%${search}%`);
        }
      }
      if (sortBy) q = q.orderBy(sortBy, sortDir);
      for (const extra of options.thenSort ?? []) q = q.orderBy(extra.column, extra.direction);
      return (await (q.get ?? q.all)?.call(q)) ?? [];
    }

    // Fallback: in-memory.
    const custom = await this.data();
    const all = custom ?? (model && (await model.all?.())) ?? [];
    let rows = all as Record<string, unknown>[];
    if (search) {
      const cols = this.searchableColumns();
      const needle = search.toLowerCase();
      rows = rows.filter((r) =>
        cols.some((c) =>
          String(r[c] ?? "")
            .toLowerCase()
            .includes(needle),
        ),
      );
    }
    if (sortBy) {
      rows = [...rows].sort(
        (a, b) => compare(a[sortBy], b[sortBy]) * (sortDir === "desc" ? -1 : 1),
      );
    }
    return rows;
  }

  /** Count records, optionally scoped by a query modifier (used for tab badges). */
  static async count(modifyQuery?: QueryModifier): Promise<number> {
    const model = this.model;
    if (model && typeof model.query === "function") {
      const q = model.query();
      return (modifyQuery ? modifyQuery(q) : q).count();
    }
    const custom = await this.data();
    const all = custom ?? (model && (await model.all?.())) ?? [];
    return all.length;
  }

  /**
   * Load a single record by primary key, as a plain row (or `null`). Uses the
   * query builder so the row shape matches {@link records}; falls back to the
   * in-memory model surface used by tests/mocks.
   */
  static async find(id: unknown): Promise<Record<string, unknown> | null> {
    const model = this.model;
    if (model && typeof model.query === "function") {
      const run = async (q0: AdminQuery): Promise<Record<string, unknown> | null> => {
        let q = q0;
        for (const rel of this.eager) if (typeof q.with === "function") q = q.with(rel);
        q = q.where(this.primaryKey, id).limit(1);
        const rows = (await (q.get ?? q.all)?.call(q)) ?? [];
        return rows[0] ?? null;
      };
      const found = await run(model.query());
      if (found) return found;
      // Trashed records are hidden by the default scope — retry including them so
      // their View page (and Restore/ForceDelete) still resolve.
      if (this.usesSoftDeletes() && typeof model.withTrashed === "function") {
        return run(model.withTrashed());
      }
      return null;
    }
    const custom = await this.data();
    const all = custom ?? (model && (await model.all?.())) ?? [];
    return (
      (all as Record<string, unknown>[]).find((r) => String(r[this.primaryKey]) === String(id)) ??
      null
    );
  }

  /** Whether this resource's model uses soft deletes. */
  static usesSoftDeletes(): boolean {
    return !!this.model?.softDeletes;
  }

  /** Load a model *instance* (with restore/forceDelete), including trashed rows. */
  private static async _findTrashedInstance(id: unknown): Promise<AdminRecord | null> {
    const model = this.model;
    if (model && typeof model.withTrashed === "function") {
      const q = model.withTrashed().where(this.primaryKey, id).limit(1);
      const rows = (await (q.get ?? q.all)?.call(q)) ?? [];
      return (rows[0] as AdminRecord) ?? null;
    }
    if (model && typeof model.find === "function") {
      return (await model.find(id)) as AdminRecord | null;
    }
    return null;
  }

  /** Restore a soft-deleted record. Returns `true` when a record was restored. */
  static async restore(id: unknown): Promise<boolean> {
    const rec = await this._findTrashedInstance(id);
    if (!rec || typeof rec.restore !== "function") return false;
    await rec.restore();
    return true;
  }

  /** Permanently delete a (possibly soft-deleted) record. */
  static async forceDelete(id: unknown): Promise<boolean> {
    const rec = await this._findTrashedInstance(id);
    if (!rec) return false;
    if (typeof rec.forceDelete === "function") await rec.forceDelete();
    else if (typeof rec.delete === "function") await rec.delete();
    else return false;
    return true;
  }

  /**
   * Permanently delete a record by primary key. Prefers loading the model
   * instance and calling its `delete()` (so soft-deletes / model hooks run);
   * returns `true` when a matching record was found and removed.
   */
  static async destroy(id: unknown): Promise<boolean> {
    const model = this.model;
    if (model && typeof model.find === "function") {
      const row = await model.find(id);
      if (!row) return false;
      await row.delete?.();
      return true;
    }
    return false;
  }

  /** Create a record from form data. Returns the new record (with its id). */
  static async create(data: Record<string, unknown>): Promise<AdminRecord | null> {
    const model = this.model;
    if (model && typeof model.create === "function") {
      return await model.create(data);
    }
    return null;
  }

  /** Update a record by primary key from form data. Returns `true` on success. */
  static async update(id: unknown, data: Record<string, unknown>): Promise<boolean> {
    const model = this.model;
    if (model && typeof model.find === "function") {
      const row = await model.find(id);
      if (!row) return false;
      row.fill?.(data);
      await row.save?.();
      return true;
    }
    return false;
  }
}

function paginateMeta(
  rows: Record<string, unknown>[],
  total: number,
  page: number,
  perPage: number,
): RecordPage {
  return { rows, total, page, perPage, lastPage: Math.max(1, Math.ceil(total / perPage)) };
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function titleCase(s: string): string {
  return s
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function kebab(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}
