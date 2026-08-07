import { RequestContext, ForbiddenError, FrameworkEvents } from "@zerotal/core";
import { AuthorizationDenied } from "./events.ts";
import type { AuthUser } from "./AuthUser.ts";
import type { Policy } from "./Policy.ts";

type PolicyClass<M> = new () => Policy<M>;
type AnyPolicyClass = PolicyClass<unknown>;
type UserArg = AuthUser | undefined;
type BeforeHook = (user: UserArg, ability: string, model?: unknown) => boolean | undefined;
type AbilityCallback = (user: UserArg, model?: unknown) => boolean;

/**
 * GateService — authorization service.
 *
 * Bound in the container as `'gate'` by AuthProvider.
 * Interact with it through the `Gate` facade or by resolving it from the container.
 *
 * @example
 * // Register a policy:
 * Gate.registerPolicy(Post, PostPolicy);
 *
 * // Define a closure-based ability (no model required):
 * Gate.defineAbility('publish-newsletter', (user) => user?.role === 'admin');
 *
 * // Register a before hook (e.g. super-admin bypass):
 * Gate.before((user) => user?.isSuperAdmin ? true : undefined);
 *
 * // Check in a controller:
 * Gate.allows('update', post);    // boolean
 * Gate.authorize('update', post); // throws ForbiddenError if denied
 *
 * // Explicit policy form:
 * Gate.via(PostPolicy).allows('update', post);
 */
export class GateService {
  private readonly _registry = new Map<Function, AnyPolicyClass>();
  private readonly _before: BeforeHook[] = [];
  private readonly _abilities = new Map<string, AbilityCallback>();

  // ── Registration ─────────────────────────────────────────────────────────────

  /**
   * Map a model class to the {@link Policy} that authorizes it. Once registered,
   * `allows`/`authorize` with an instance of that model dispatch to the policy
   * method named after the ability.
   *
   * @param ModelClass - The model constructor to authorize.
   * @param PolicyClass - The policy class whose methods are the abilities.
   * @category Defining
   */
  registerPolicy<M>(ModelClass: new (...args: never[]) => M, PolicyClass: PolicyClass<M>): void {
    this._registry.set(ModelClass, PolicyClass as AnyPolicyClass);
  }

  /**
   * Register a closure-based ability, checked by name with `allows`/`authorize`.
   * Returns `this` for chaining.
   *
   * @param ability - The ability name (e.g. `'update-post'`).
   * @param callback - Receives the current user and optional model; returns whether access is allowed.
   * @category Defining
   */
  defineAbility(ability: string, callback: AbilityCallback): this {
    this._abilities.set(ability, callback);
    return this;
  }

  /**
   * Register a before-hook that runs ahead of every check. Returning `true`/`false`
   * short-circuits the check (grant/deny); returning `undefined` defers to the
   * normal resolution. Returns `this` for chaining. See {@link superAdmin} for a
   * common use.
   *
   * @category Defining
   */
  before(hook: BeforeHook): this {
    this._before.push(hook);
    return this;
  }

  // ── Checks ───────────────────────────────────────────────────────────────────

  /**
   * Check an ability and return a boolean. Resolves through before-hooks, closure
   * abilities, a registered policy for `model`'s class, then the user's relational
   * permissions. Never throws — any error in resolution denies.
   *
   * @param ability - The ability name to check.
   * @param model - Optional model instance; selects the policy and is passed to the ability.
   * @returns `true` when access is allowed.
   * @category Checking
   */
  allows(ability: string, model?: object): boolean {
    return this._check(ability, model);
  }

  /**
   * Assert an ability, throwing when denied. On denial emits `AuthorizationDenied`.
   *
   * @param ability - The ability name to check.
   * @param model - Optional model instance passed to the policy/ability.
   * @throws {ForbiddenError} when the ability is denied.
   * @category Checking
   */
  authorize(ability: string, model?: object): void {
    if (!this._check(ability, model)) {
      FrameworkEvents.emit(
        new AuthorizationDenied(ability, _currentUserId(), RequestContext.tryGet()),
      );
      throw new ForbiddenError();
    }
  }

  /**
   * Async variants of {@link allows} / {@link authorize} — await policy methods (and closure
   * abilities) that return a `Promise<boolean>`. Use these when an ability needs to hit the
   * database (e.g. a membership/admin lookup); the sync forms treat a returned Promise as
   * truthy and would wrongly allow.
   *
   * @returns (`allowsAsync`) a promise resolving to `true` when allowed.
   * @throws {ForbiddenError} (`authorizeAsync`) when the ability is denied.
   * @category Checking
   */
  async allowsAsync(ability: string, model?: object): Promise<boolean> {
    return this._checkAsync(ability, model);
  }

  /** @category Checking */
  async authorizeAsync(ability: string, model?: object): Promise<void> {
    if (!(await this._checkAsync(ability, model))) {
      FrameworkEvents.emit(
        new AuthorizationDenied(ability, _currentUserId(), RequestContext.tryGet()),
      );
      throw new ForbiddenError();
    }
  }

  /**
   * Authorize against a specific {@link Policy} class explicitly, bypassing the
   * model→policy registry. Returns an object with `allows` (boolean) and
   * `authorize` (throws {@link ForbiddenError} on denial). `model` is optional for
   * class-level abilities such as `create`.
   *
   * @param PolicyClass - The policy class to dispatch to.
   * @example
   * ```ts
   * Gate.via(PostPolicy).allows('update', post);
   * Gate.via(PostPolicy).authorize('create'); // no model instance needed
   * ```
   * @category Policies
   */
  via<M>(PolicyClass: PolicyClass<M>) {
    return {
      // `model` is optional: class-level abilities (e.g. `create`) have no instance — the
      // policy method simply ignores the second argument. Mirrors the top-level `allows()`.
      allows: (ability: string, model?: M): boolean =>
        this._callPolicy(PolicyClass, ability, model as M),
      authorize: (ability: string, model?: M): void => {
        if (!this._callPolicy(PolicyClass, ability, model as M)) {
          FrameworkEvents.emit(
            new AuthorizationDenied(ability, _currentUserId(), RequestContext.tryGet()),
          );
          throw new ForbiddenError();
        }
      },
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  /** @internal */
  _check(ability: string, model?: object): boolean {
    const user = RequestContext.tryGet()?.user;

    for (const hook of this._before) {
      const result = hook(user, ability, model);
      if (result !== undefined) return result;
    }

    const closureAbility = this._abilities.get(ability);
    if (closureAbility) {
      try {
        return closureAbility(user, model);
      } catch {
        return false;
      }
    }

    if (model !== undefined) {
      const ctor = model.constructor as Function;
      const PolicyClass = this._registry.get(ctor);
      if (PolicyClass) return this._callPolicy(PolicyClass, ability, model as never);
    }

    // Fall back to the user's own permission check (relational RBAC via Roles /
    // Permissions), so a permission name like `post.publish` works through the
    // Gate with no extra wiring. Wildcard-aware on the relational model.
    const u = user as unknown as { can?(a: string): boolean } | undefined;
    if (typeof u?.can === "function") {
      try {
        if (u.can(ability)) return true;
      } catch {
        /* authz not loaded → deny */
      }
    }

    return false;
  }

  /**
   * Grant a role unconditional access via a before-hook (e.g. a super admin).
   *
   * @param role - The role granted unconditional access. Default `'super-admin'`.
   * @returns `this` for chaining.
   * @example
   * ```ts
   * Gate.superAdmin();           // users with the 'super-admin' role bypass every check
   * Gate.superAdmin('owner');
   * ```
   * @category Defining
   */
  superAdmin(role = "super-admin"): this {
    return this.before((user) => {
      const u = user as unknown as { hasRole?(r: string): boolean } | undefined;
      return typeof u?.hasRole === "function" && u.hasRole(role) ? true : undefined;
    });
  }

  /** @internal */
  _callPolicy<M>(PolicyClass: PolicyClass<M>, ability: string, model: M): boolean {
    const user = RequestContext.tryGet()?.user;
    const policy = new PolicyClass();
    const method = (policy as Record<string, unknown>)[ability];
    if (typeof method !== "function") return false;
    try {
      return (method as (u: unknown, m: unknown) => boolean).call(policy, user, model);
    } catch {
      return false;
    }
  }

  /** @internal Async mirror of {@link _check} — awaits async closure abilities / policy methods. */
  async _checkAsync(ability: string, model?: object): Promise<boolean> {
    const user = RequestContext.tryGet()?.user;

    for (const hook of this._before) {
      const result = hook(user, ability, model);
      if (result !== undefined) return result;
    }

    const closureAbility = this._abilities.get(ability);
    if (closureAbility) {
      try {
        return await closureAbility(user, model);
      } catch {
        return false;
      }
    }

    if (model !== undefined) {
      const ctor = model.constructor as Function;
      const PolicyClass = this._registry.get(ctor);
      if (PolicyClass) return this._callPolicyAsync(PolicyClass, ability, model as never);
    }

    const u = user as unknown as { can?(a: string): boolean } | undefined;
    if (typeof u?.can === "function") {
      try {
        if (u.can(ability)) return true;
      } catch {
        /* authz not loaded → deny */
      }
    }

    return false;
  }

  /** @internal Async mirror of {@link _callPolicy}. */
  async _callPolicyAsync<M>(
    PolicyClass: PolicyClass<M>,
    ability: string,
    model: M,
  ): Promise<boolean> {
    const user = RequestContext.tryGet()?.user;
    const policy = new PolicyClass();
    const method = (policy as Record<string, unknown>)[ability];
    if (typeof method !== "function") return false;
    try {
      return await (method as (u: unknown, m: unknown) => boolean | Promise<boolean>).call(
        policy,
        user,
        model,
      );
    } catch {
      return false;
    }
  }
}

/**
 * Best-effort resolution of the current user's id for instrumentation.
 * Handles both AuthUser models (getAuthId) and token-attached user shapes ({ id }).
 */
function _currentUserId(): string | number | undefined {
  const user = RequestContext.tryGet()?.user as
    { getAuthId?: () => number; id?: string | number } | undefined;
  if (!user) return undefined;
  if (typeof user.getAuthId === "function") return user.getAuthId();
  return user.id;
}
