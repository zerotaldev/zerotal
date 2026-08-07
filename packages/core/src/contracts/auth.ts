/**
 * The authenticatable-user contract — the identity of "the current user" as the
 * kernel and first-party packages refer to it, with **no** commitment to any
 * particular User model or ORM.
 *
 * It is intentionally empty. An application makes it concrete by merging its own
 * User type in, which flows through every core surface that speaks of the
 * authenticated user (`ctx.user`, the `Auth` facade, policies):
 *
 * @example
 * ```ts
 * // app/models/User.ts
 * declare module "@zerotal/core/contracts" {
 *   interface AuthenticatableUser extends User {}
 * }
 * ```
 *
 * @remarks
 * The `AuthenticatedUser` interface exported from `@zerotal/core` extends this,
 * so augmenting either interface resolves to the same shape.
 *
 * @category Contracts
 */
export interface AuthenticatableUser {}
