import { ZerotalError } from "@zerotal/core";
import type { Action } from "../actions/Action.ts";
import type { ActionContext } from "../actions/Action.ts";
import type { AdminRecord } from "../Resource.ts";
import type { ResourceClass } from "../Panel.ts";
import type { RelationManager } from "../relations/RelationManager.ts";

/**
 * Server-side authorization for admin RPCs.
 *
 * The admin panel exposes its mutations as Flow `@expose` methods, which are dispatched
 * straight from a client frame: `FlowProvider` resolves the method by name and applies the
 * client-supplied arguments. Authorization used to be consulted in exactly one place —
 * `Action.isVisibleFor()`, called while *rendering* the row-action column — so hiding a button
 * was the entire control. Any user who could load an admin page could call `runAction`,
 * `runBulkAction`, `deleteRecord` or `deleteRelated` directly with arguments of their choosing.
 *
 * The helpers here are the enforcement point. They are deliberately small, deliberately
 * fail-closed, and deliberately called at the *top* of every exposed handler, before any
 * argument is used to look something up.
 */

/**
 * Raised when an admin RPC is refused. Carries a 403 so the framework's exception handler
 * renders it correctly if it escapes a Flow action.
 */
export class AdminForbiddenError extends ZerotalError {
  constructor(what: string) {
    super(`Not authorized: ${what}.`, "E_ADMIN_FORBIDDEN", 403);
  }
}

/**
 * Assert the current user may perform `ability` on `record` for this resource.
 *
 * Delegates to `Resource.can()`, which apps override to hit their Gate/policy layer. The
 * built-in default returns `true`, so this is only as strong as the app's implementation —
 * but it is now actually *called*, which it previously was not on any mutating path.
 */
export function assertCan(
  resource: ResourceClass,
  ability: string,
  record?: AdminRecord | Record<string, unknown>,
): void {
  if (!resource.can(ability, record as AdminRecord | undefined)) {
    throw new AdminForbiddenError(`${ability} on ${resource.getLabel()}`);
  }
}

/**
 * Assert an action may run for this record, applying the same `visible` + `authorize`
 * predicates the renderer uses to decide whether to draw the button.
 *
 * Passing the action through the same gate as the UI is the point: a button the user cannot
 * see is now a call the user cannot make.
 */
export function assertActionAllowed(
  action: Action,
  record: AdminRecord | Record<string, unknown> | undefined,
  ctx: ActionContext,
): void {
  if (!action.isVisibleFor(record as AdminRecord | undefined, ctx)) {
    throw new AdminForbiddenError(`action "${action._key}"`);
  }
}

/**
 * Resolve a relation manager by the slug of the resource it points at, restricted to the
 * relations this resource actually declares.
 *
 * `deleteRelated(slug, id)` used to call `Panel.find(String(slug))`, which resolves *any*
 * registered resource — so from a page like `/admin/posts/1` a crafted frame could invoke
 * `deleteRelated("users", 1)` and destroy an unrelated record. Resolving from
 * `resource.relations()` instead means the slug can only name something this page genuinely
 * manages.
 *
 * @returns the matching relation manager, or `null` when the slug is not a declared relation.
 */
export function resolveDeclaredRelation(
  resource: ResourceClass,
  slug: string,
): RelationManager | null {
  return (
    resource.relations().find((rel: RelationManager) => rel._resource.getSlug() === slug) ?? null
  );
}

/**
 * Resolve a relation manager by the parent model's relationship *method* name, restricted to
 * the relations this resource declares as BelongsToMany.
 *
 * `attachRelated`/`detachRelated` took a raw method name and invoked it on the parent model,
 * so any zero-argument method reachable on the model could be called. Only names a relation
 * manager declares via `_relationName` are accepted now.
 */
export function resolveDeclaredRelationByName(
  resource: ResourceClass,
  relationName: string,
): RelationManager | null {
  return (
    resource
      .relations()
      .find((rel: RelationManager) => rel._relationName === relationName && rel._canAttach) ?? null
  );
}
