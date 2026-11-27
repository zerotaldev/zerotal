/**
 * `@zerotal/core/auth` — the signed-in user, read from the request with its registered type.
 *
 * Server-only. Browser bundles import `@zerotal/core/errors`, never this.
 *
 * @module
 */
export { currentUser, currentUserId } from "./currentUser.ts";
export type {
  AuthenticatedUser,
  CurrentUser,
  UserIdentity,
  UserRegistry,
} from "./AuthenticatedUser.ts";
