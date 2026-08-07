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
