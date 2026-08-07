/**
 * Action — a declarative button that either navigates somewhere (a *link*
 * action) or runs a server-side handler (a *callback* action), optionally behind
 * a confirmation. One primitive powers row
 * actions, header actions, and bulk actions.
 *
 * Handlers live on the server (resolved by key at run time), so nothing needs to
 * cross the Flow snapshot except the action key and the record id(s) — which
 * ride in `data-args`.
 *
 *   action("activate")
 *     .label("Activate").icon("check-circle").color("success")
 *     .requiresConfirmation("Activate this account?")
 *     .run(async ({ record, resource }) => { await resource.update(record.id, { active: true }); })
 *     .successMessage("Account activated.")
 *
 *   deleteAction()                 // confirm → resource.destroy(record)
 *   editAction()                   // link → /{slug}/{id}/edit
 *   bulkDeleteAction()             // toolbar → destroy every selected record
 */
import type { ResourceClass } from "../Panel.ts";
import type { AdminRecord, ListOptions } from "../Resource.ts";
import type { Field } from "../form/Field.ts";
import { flattenFields } from "../form/index.ts";

export type ActionColor = "default" | "primary" | "success" | "muted" | "destructive";

/** Minimal view of the host page an action handler can drive (flash/redirect). */
export interface ActionPage {
  flash(message: string, level?: string): unknown;
  redirect(url: string): { withSuccess(message: string): unknown };
  /** Send a generated file to the browser (present on every panel page). */
  download?(filename: string, content: string | Uint8Array, mime?: string): unknown;
}

/** Everything a handler (or link/visibility resolver) receives. */
export interface ActionContext {
  resource: ResourceClass;
  page: ActionPage;
  /** Panel base path, e.g. "/admin". */
  base: string;
  /** Resource slug, e.g. "users". */
  slug: string;
  /** Which panel this action is running on — a queued job needs it to resolve the resource. */
  panelId?: string | undefined;
  /** Parent record's id, for a resource nested under another. */
  parentId?: string | undefined;
  /**
   * How the list page has currently scoped itself — search, sort, filters, tab,
   * soft-delete mode. An export reads this so the file matches what's on screen.
   */
  listOptions?: ListOptions | undefined;
  /** Present for record (row/header-on-record) actions. */
  record?: AdminRecord | undefined;
  /** Present for bulk actions — the selected records. */
  records?: AdminRecord[] | undefined;
  /** Raw selected ids for bulk actions. */
  ids?: string[] | undefined;
  /** Submitted modal-form values (present for actions declared with `.form()`). */
  data?: Record<string, unknown> | undefined;
}

export type ActionHandler = (ctx: ActionContext) => void | Promise<void>;
export type ActionVisible = (record: AdminRecord | undefined, ctx: ActionContext) => boolean;

export class Action {
  /** @internal */ _key: string;
  /** @internal */ _label?: string;
  /** @internal */ _icon?: string;
  /** @internal */ _color: ActionColor = "default";
  /** @internal */ _confirm?: string;
  /** @internal */ _hrefFn?: (ctx: ActionContext) => string;
  /** @internal */ _handler?: ActionHandler;
  /** @internal */ _visibleFn?: ActionVisible;
  /** @internal */ _authorizeFn?: ActionVisible;
  /** @internal */ _success?: string;
  /** @internal */ _danger = false;
  /** @internal */ _bulk = false;
  /** @internal */ _iconOnly = false;
  /** @internal Extra attributes a replicate action drops from the copy. */
  _excludeAttributes: string[] = [];
  /** @internal Last chance to adjust a replica before it is created. */
  _beforeReplica?: (data: Record<string, unknown>) => Record<string, unknown>;
  /** @internal Fields computed from what the modal currently holds. */
  _formUsing?: (data: Record<string, unknown>, resource: ResourceClass) => Field[];
  /** @internal Modal form fields (when set, the action opens a Dialog form). */
  _form?: Field[];
  /** @internal */ _modalHeading?: string;
  /** @internal */ _modalSubmit?: string;

  constructor(key: string) {
    this._key = key;
  }

  static make(key: string): Action {
    return new Action(key);
  }

  // ── Appearance ─────────────────────────────────────────────────────────────

  label(label: string): this {
    this._label = label;
    return this;
  }

  icon(name: string): this {
    this._icon = name;
    return this;
  }

  color(color: ActionColor): this {
    this._color = color;
    return this;
  }

  /** Render as an icon-only square button (row actions). */
  iconButton(value = true): this {
    this._iconOnly = value;
    return this;
  }

  /** Style as destructive (red). Shorthand for `.color("destructive")`. */
  danger(value = true): this {
    this._danger = value;
    if (value) this._color = "destructive";
    return this;
  }

  // ── Behaviour ──────────────────────────────────────────────────────────────

  /** Require a confirmation dialog before the handler runs (Flow `confirm`). */
  requiresConfirmation(message = "Are you sure?"): this {
    this._confirm = message;
    return this;
  }

  /** Make this a link action that navigates to the resolved URL. */
  url(fn: (ctx: ActionContext) => string): this {
    this._hrefFn = fn;
    return this;
  }

  /**
   * Build the modal's fields from what it currently holds, rather than fixing
   * them upfront.
   *
   * This is what lets a modal have a second step: an import shows a file picker,
   * and once a file is there, a mapping row per column in it. The fields are
   * recomputed on every render, so the modal follows the data.
   */
  formUsing(fn: (data: Record<string, unknown>, resource: ResourceClass) => Field[]): this {
    this._formUsing = fn;
    return this;
  }

  /** The fields to render for the modal's current state. */
  fieldsFor(data: Record<string, unknown>, resource: ResourceClass): Field[] {
    if (this._formUsing) return this._formUsing(data, resource);
    return this._form ?? [];
  }

  /** Make this a callback action that runs `fn` on the server. */
  run(fn: ActionHandler): this {
    this._handler = fn;
    return this;
  }

  /**
   * Attributes a {@link replicateAction} leaves behind, on top of the primary key
   * and timestamps it always drops. Use it for anything that must stay unique —
   * a slug, an invoice number, an external id.
   */
  excludeAttributes(keys: string[]): this {
    this._excludeAttributes = keys;
    return this;
  }

  /** Adjust a replica's data just before it is created. */
  beforeReplicaSaved(fn: (data: Record<string, unknown>) => Record<string, unknown>): this {
    this._beforeReplica = fn;
    return this;
  }

  /**
   * Open a modal form before running. The submitted (validated) values arrive on
   * `ctx.data`:
   *
   *   action("ban").label("Ban user").icon("shield").color("destructive")
   *     .form([ textarea("reason").label("Reason").required() ])
   *     .run(async ({ record, resource, data, page }) => {
   *       await resource.update(record!.id, { banned: true, ban_reason: data!.reason });
   *       page.flash("User banned.");
   *     });
   */
  form(fields: Field[]): this {
    this._form = fields;
    return this;
  }

  /** Heading shown at the top of the action's modal (defaults to the label). */
  modalHeading(text: string): this {
    this._modalHeading = text;
    return this;
  }

  /** Submit-button label inside the modal (defaults to the action label). */
  modalSubmitLabel(text: string): this {
    this._modalSubmit = text;
    return this;
  }

  /** True when this action opens a modal form. */
  hasForm(): boolean {
    if (this._formUsing) return true;
    return Array.isArray(this._form) && this._form.length > 0;
  }

  /** Flash this message after a successful callback action. */
  successMessage(message: string): this {
    this._success = message;
    return this;
  }

  /** Conditionally show the action for a given record. */
  visible(fn: ActionVisible): this {
    this._visibleFn = fn;
    return this;
  }

  /**
   * Permission gate — ANDed with `visible`. Decoupled from any specific auth
   * package: pass a predicate (e.g. `() => Auth.can("update", record)`).
   */
  authorize(fn: ActionVisible): this {
    this._authorizeFn = fn;
    return this;
  }

  /** @internal Mark as a bulk (multi-record) action. */
  asBulk(): this {
    this._bulk = true;
    return this;
  }

  // ── Resolution ─────────────────────────────────────────────────────────────

  getLabel(): string {
    return this._label ?? titleCase(this._key);
  }

  isLink(): boolean {
    return typeof this._hrefFn === "function";
  }

  isVisibleFor(record: AdminRecord | undefined, ctx: ActionContext): boolean {
    if (this._visibleFn && !this._visibleFn(record, ctx)) return false;
    if (this._authorizeFn && !this._authorizeFn(record, ctx)) return false;
    return true;
  }

  href(ctx: ActionContext): string | null {
    return this._hrefFn ? this._hrefFn(ctx) : null;
  }

  /** Run the callback (applies the success flash unless the handler redirected). */
  async execute(ctx: ActionContext): Promise<void> {
    if (!this._handler) return;
    await this._handler(ctx);
    if (this._success) ctx.page.flash(this._success);
  }
}

/** Start a custom action. */
export function action(key: string): Action {
  return new Action(key);
}

// ── Presets ────────────────────────────────────────────────────────────────────
//
// Link presets route through the resource's own URL builders, so a resource that
// moves into a cluster or under a parent record keeps working untouched.

/** Link action → the record's View page. */
export function viewAction(): Action {
  return new Action("view")
    .label("View")
    .icon("eye")
    .iconButton()
    .url(({ base, record, resource, parentId }) =>
      resource.recordUrl(base, recordId(record, resource), parentId),
    );
}

/** Link action → the record's Edit page (only shown for editable resources). */
export function editAction(): Action {
  return new Action("edit")
    .label("Edit")
    .icon("pencil")
    .iconButton()
    .url(({ base, record, resource, parentId }) =>
      resource.editUrl(base, recordId(record, resource), parentId),
    )
    .visible((_record, ctx) => ctx.resource.isEditable())
    .authorize((rec, ctx) => ctx.resource.can("update", rec));
}

/** Confirmation callback action → `resource.destroy(record)`. */
export function deleteAction(): Action {
  return new Action("delete")
    .label("Delete")
    .icon("trash")
    .iconButton()
    .danger()
    .requiresConfirmation("Delete this record? This cannot be undone.")
    .authorize((rec, ctx) => ctx.resource.can("delete", rec))
    .run(async ({ resource, record, page }) => {
      const id = recordId(record, resource);
      const ok = await resource.destroy(id);
      page.flash(ok ? `${resource.getLabel()} deleted.` : "That record no longer exists.");
    });
}

/**
 * Several actions behind one dropdown.
 *
 * A row with seven buttons is unreadable; a row with two buttons and a "More"
 * menu is not. A group is not itself runnable — it holds actions, and the page
 * renders each member the way it would have rendered it inline.
 *
 *   actionGroup([replicateAction(), archiveAction(), deleteAction()]).label("More")
 */
export class ActionGroup {
  /** @internal */ _actions: Action[];
  /** @internal */ _label = "More";
  /** @internal */ _icon = "dots-horizontal";

  constructor(actions: Action[]) {
    this._actions = actions;
  }

  label(label: string): this {
    this._label = label;
    return this;
  }

  icon(name: string): this {
    this._icon = name;
    return this;
  }

  getLabel(): string {
    return this._label;
  }

  /** The members this user may actually see, in declaration order. */
  visibleActions(record: AdminRecord | undefined, ctx: ActionContext): Action[] {
    return this._actions.filter((a) => a.isVisibleFor(record, ctx));
  }
}

/** Group actions into one dropdown. */
export function actionGroup(actions: Action[]): ActionGroup {
  return new ActionGroup(actions);
}

/** Either a single action or a group of them — what a resource may return. */
export type ActionItem = Action | ActionGroup;

/** Flatten groups so callers that need plain actions (dispatch, lookup) get them. */
export function flattenActions(items: ActionItem[]): Action[] {
  return items.flatMap((item) => (item instanceof ActionGroup ? item._actions : [item]));
}

/**
 * Copy a record and open the copy for editing.
 *
 * The primary key and timestamps are always dropped — a replica is a new row,
 * not a second claim on the original's identity. Add more with
 * `.excludeAttributes()`, or adjust the copy with `.beforeReplicaSaved()`:
 *
 *   replicateAction()
 *     .excludeAttributes(["slug"])
 *     .beforeReplicaSaved((data) => ({ ...data, title: `${data.title} (copy)` }))
 */
export function replicateAction(): Action {
  // The handler closes over the action itself, so `.excludeAttributes()` and
  // `.beforeReplicaSaved()` called later still reach it.
  const act = new Action("replicate")
    .label("Replicate")
    .icon("duplicate")
    .iconButton()
    .visible((_record, ctx) => ctx.resource.isEditable() && !ctx.resource.singular)
    .authorize((_rec, ctx) => ctx.resource.can("create"));

  return act.run(async ({ resource, record, page, base, parentId }) => {
    if (!record) return;
    const dropped = new Set([
      resource.primaryKey,
      "created_at",
      "updated_at",
      "deleted_at",
      ...act._excludeAttributes,
    ]);

    let data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
      // A model instance carries methods too; only columns should be copied.
      if (dropped.has(key) || typeof value === "function") continue;
      data[key] = value;
    }
    if (act._beforeReplica) data = act._beforeReplica(data);

    const created = await resource.create(resource.mutateBeforeSave(data, "create"));
    if (!created) {
      page.flash("Could not replicate that record.", "warning");
      return;
    }
    await resource.afterSave(created, "create");
    const id = (created as Record<string, unknown>)[resource.primaryKey];
    page
      .redirect(resource.editUrl(base, id, parentId))
      .withSuccess(`${resource.getLabel()} replicated.`);
  });
}

/**
 * Act as this user, and get a way back.
 *
 * Gated twice: the resource must opt in with `static impersonatable = true`,
 * *and* its `can("impersonate", record)` must allow this record. `can()` alone
 * defaults to allow, which is the wrong default for becoming another user, so
 * the opt-in carries the refusal.
 */
export function impersonateAction(): Action {
  return new Action("impersonate")
    .label("Impersonate")
    .icon("users")
    .iconButton()
    .requiresConfirmation("Act as this user? You will return with one click.")
    .authorize((rec, ctx) => ctx.resource.impersonatable && ctx.resource.can("impersonate", rec))
    .run(async ({ record, resource, page, base }) => {
      const { startImpersonating } = await import("../impersonation.ts");
      const id = recordId(record, resource);
      const [ok, reason] = await startImpersonating(id);
      if (!ok) {
        page.flash(reason, "warning");
        return;
      }
      page.redirect(base || "/").withSuccess("You are now acting as this user.");
    });
}

/** Header link action → the Create page. */
export function createAction(): Action {
  return new Action("create")
    .label("New")
    .icon("plus")
    .color("primary")
    .url(({ base, resource, parentId }) => resource.createUrl(base, parentId))
    .visible((_record, ctx) => ctx.resource.isEditable() && !ctx.resource.singular)
    .authorize((_rec, ctx) => ctx.resource.can("create"));
}

/**
 * Set one or more fields across every selected record.
 *
 * The modal offers the resource's own fields, and only what was actually filled
 * in is written — leaving a field blank means "leave it alone" rather than
 * "clear it", which is the only reading that makes a bulk edit safe to use.
 *
 *   static bulkActions() {
 *     return [bulkEditAction(["status", "categoryId"]), bulkDeleteAction()];
 *   }
 *
 * Pass the field keys to offer, or omit them to offer every field the resource
 * declares.
 */
export function bulkEditAction(fields?: string[]): Action {
  return new Action("bulk-edit")
    .label("Edit selected")
    .icon("pencil")
    .asBulk()
    .modalHeading("Edit selected records")
    .modalSubmitLabel("Apply")
    .formUsing((_data, resource) => {
      const all = flattenFields(resource.form());
      const offered = fields ? all.filter((f) => fields.includes(f._key)) : all;
      // Nothing is required here: a bulk edit sets what you fill in.
      return offered.map((f) =>
        f.required(false).helperText("Leave blank to keep each record's current value."),
      );
    })
    .authorize((_rec, ctx) => ctx.resource.can("update"))
    .run(async ({ ids = [], resource, data, page }) => {
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data ?? {})) {
        if (value === "" || value === null || value === undefined) continue;
        patch[key] = value;
      }
      if (Object.keys(patch).length === 0) {
        page.flash("Nothing to change — fill in at least one field.", "warning");
        return;
      }

      let changed = 0;
      for (const id of ids) if (await resource.update(id, { ...patch })) changed++;
      page.flash(
        `Updated ${changed} ${changed === 1 ? resource.getLabel().toLowerCase() : resource.getPluralLabel().toLowerCase()}.`,
      );
    });
}

/** Bulk confirmation action → destroy every selected record. */
export function bulkDeleteAction(): Action {
  return new Action("bulk-delete")
    .label("Delete selected")
    .icon("trash")
    .danger()
    .asBulk()
    .requiresConfirmation("Delete the selected records? This cannot be undone.")
    .run(async ({ resource, ids = [], page }) => {
      let n = 0;
      for (const id of ids) if (await resource.destroy(id)) n++;
      page.flash(
        `Deleted ${n} ${n === 1 ? resource.getLabel().toLowerCase() : resource.getPluralLabel().toLowerCase()}.`,
      );
    });
}

/** Restore a soft-deleted record (shown on trashed rows). */
export function restoreAction(): Action {
  return new Action("restore")
    .label("Restore")
    .icon("undo")
    .iconButton()
    .color("success")
    .requiresConfirmation("Restore this record?")
    .authorize((rec, ctx) => ctx.resource.can("restore", rec))
    .run(async ({ resource, record, page }) => {
      const ok = await resource.restore(recordId(record, resource));
      page.flash(ok ? `${resource.getLabel()} restored.` : "Could not restore that record.");
    });
}

/** Permanently delete a record (shown on trashed rows). */
export function forceDeleteAction(): Action {
  return new Action("force-delete")
    .label("Delete permanently")
    .icon("trash")
    .iconButton()
    .danger()
    .requiresConfirmation("Permanently delete this record? This cannot be undone.")
    .authorize((rec, ctx) => ctx.resource.can("forceDelete", rec))
    .run(async ({ resource, record, page }) => {
      const ok = await resource.forceDelete(recordId(record, resource));
      page.flash(
        ok ? `${resource.getLabel()} permanently deleted.` : "That record no longer exists.",
      );
    });
}

/** Bulk restore every selected (trashed) record. */
export function bulkRestoreAction(): Action {
  return new Action("bulk-restore")
    .label("Restore selected")
    .icon("undo")
    .color("success")
    .asBulk()
    .requiresConfirmation("Restore the selected records?")
    .run(async ({ resource, ids = [], page }) => {
      let n = 0;
      for (const id of ids) if (await resource.restore(id)) n++;
      page.flash(
        `Restored ${n} ${n === 1 ? resource.getLabel().toLowerCase() : resource.getPluralLabel().toLowerCase()}.`,
      );
    });
}

/** Bulk permanently delete every selected record. */
export function bulkForceDeleteAction(): Action {
  return new Action("bulk-force-delete")
    .label("Delete permanently")
    .icon("trash")
    .danger()
    .asBulk()
    .requiresConfirmation("Permanently delete the selected records? This cannot be undone.")
    .run(async ({ resource, ids = [], page }) => {
      let n = 0;
      for (const id of ids) if (await resource.forceDelete(id)) n++;
      page.flash(
        `Permanently deleted ${n} ${n === 1 ? resource.getLabel().toLowerCase() : resource.getPluralLabel().toLowerCase()}.`,
      );
    });
}

function recordId(record: AdminRecord | undefined, resource: ResourceClass): string {
  const pk = resource.primaryKey;
  return String((record as Record<string, unknown> | undefined)?.[pk] ?? "");
}

function titleCase(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
