/**
 * The authenticated user for the current request.
 * Extend this interface in your app via declaration merging to match your User model.
 *
 * @remarks
 * The root-level alias of the kernel-owned {@link AuthenticatableUser} contract
 * (from `@zerotal/core/contracts`) which it extends, so augmenting either
 * interface resolves to the same shape.
 *
 * @example
 * // app/models/User.ts
 * declare module '@zerotal/core' {
 *   interface AuthenticatedUser extends User {}
 * }
 */
import type { AuthenticatableUser } from "../contracts/auth.ts";

export interface AuthenticatedUser extends AuthenticatableUser {}

/**
 * Where the signed-in user's type is registered, so code that never imports the auth package
 * still reads a typed user.
 *
 * @remarks
 * Empty in core. `@zerotal/auth` fills it with its `UserModel`, so an app that declaration-merges
 * its own `User` into `UserModel` gets that type from {@link CurrentUser} too. An app without
 * `@zerotal/auth` that puts its own user on the request registers it here the same way:
 *
 * @example
 * ```ts
 * declare module "@zerotal/core" {
 *   interface UserRegistry {
 *     user: Account;
 *   }
 * }
 * ```
 *
 * Kept off `HttpContext` on purpose: declaring `user` on the context class would collide with an
 * app's own `user` field there.
 *
 * @category Auth
 */
export interface UserRegistry {}

/**
 * The shape every signed-in user has, whatever model backs it: an identifier.
 *
 * @category Auth
 */
export interface UserIdentity {
  /** The user's primary key. */
  id?: unknown;
}

/**
 * The signed-in user's type: the one registered in {@link UserRegistry}, or
 * {@link AuthenticatedUser} when nothing is registered, with its {@link UserIdentity}.
 *
 * @category Auth
 */
export type CurrentUser = (UserRegistry extends { user: infer U extends object }
  ? U
  : AuthenticatedUser) &
  UserIdentity;
