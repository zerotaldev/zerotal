import { registerColumn, type Constructor } from "@zerotal/orm";

/**
 * Brand marking a model (or one of its ancestors) as carrying the auth contract.
 * `Symbol.for` keeps it stable across module instances. Set on the mixin class and
 * inherited by every subclass, so detection works for both
 * `extends AuthUser` and `extends BaseModelWith(Authenticatable, …)`.
 */
export const AUTHENTICATABLE: unique symbol = Symbol.for("zerotal.auth.authenticatable");

/** True when the given model constructor composes `Authenticatable` (directly or via a base). */
export function isAuthenticatable(model: unknown): boolean {
  return !!(model as Record<symbol, unknown> | undefined)?.[AUTHENTICATABLE];
}

/**
 * The authenticatable contract as a composable mixin: identity (`getAuthId`) and
 * the hashed password (`getAuthPassword`), plus "remember me" token accessors.
 * Stack it with `BaseModelWith` instead of nesting wrappers around a concrete base.
 *
 * @remarks
 * These are the methods the auth flow reads: `getAuthId()` is stored in the
 * session by {@link Auth.login} and identifies the user; `getAuthPassword()` is
 * what {@link Auth.attempt} / {@link Auth.confirmPassword} verify against (returns
 * `null` for passwordless auth); the `RememberToken` accessors back the persistent
 * "remember me" cookie. Applying the mixin also brands the class (so
 * {@link isAuthenticatable} detects it) and registers the `remember_token` column.
 *
 * For the common single-contract case, `extends AuthUser` (which is just
 * `Authenticatable(BaseModel)`) reads fine too.
 *
 * @example
 * ```ts
 * import { BaseModelWith } from "@zerotal/orm";
 * import { Authenticatable, Permissions, Roles } from "@zerotal/auth";
 *
 * class User extends BaseModelWith(Authenticatable) {
 *   @column() email!: string;
 *   @column() password!: string;
 * }
 *
 * // with roles + permissions, still flat:
 * class AdminUser extends BaseModelWith(Authenticatable, Permissions, Roles) {}
 * ```
 */
export function Authenticatable<TBase extends Constructor>(Base: TBase) {
  class Authenticatable extends Base {
    /** The value stored in the session to identify this user. */
    getAuthId(): number {
      return (this as Record<string, unknown>)["id"] as number;
    }

    /** The hashed password. Returns null when the model uses passwordless auth. */
    getAuthPassword(): string | null {
      return ((this as Record<string, unknown>)["password"] as string | null | undefined) ?? null;
    }

    /** The hashed "remember me" token, or null when none is set. */
    getRememberToken(): string | null {
      return (
        ((this as Record<string, unknown>)["rememberToken"] as string | null | undefined) ?? null
      );
    }

    /** Set (or clear, with `null`) the hashed "remember me" token. */
    setRememberToken(value: string | null): void {
      (this as Record<string, unknown>)["rememberToken"] = value;
    }

    /** Database column name backing the remember token. */
    getRememberTokenName(): string {
      return "remember_token";
    }
  }

  // Brand imperatively (inherited by subclasses via the static prototype chain).
  (Authenticatable as unknown as Record<symbol, unknown>)[AUTHENTICATABLE] = true;

  // Register the `remember_token` column on the mixin class so the concrete model
  // hydrates/persists it without declaring it (columnsFor() walks the prototype
  // chain). authSchemaConcern ensures the column exists on the table at boot.
  registerColumn(Authenticatable, "rememberToken", {
    type: "string",
    nullable: true,
  });

  return Authenticatable;
}
