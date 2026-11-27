import type { HttpContext } from "../pipeline/HttpContext.ts";
import { RequestContext } from "../context/RequestContext.ts";
import type { CurrentUser } from "./AuthenticatedUser.ts";

/**
 * The signed-in user on a request, typed as {@link CurrentUser}, or `undefined` for a guest.
 *
 * @remarks
 * The auth middleware puts the user on the request; this reads it there without the reader
 * having to import the auth package or cast the context. Anything that is not an object (a
 * missing user, `null`) reads as no user.
 *
 * Server-only: it lives on `@zerotal/core/auth`, never on a subpath a browser bundle imports.
 *
 * @param ctx - The request to read. Defaults to the one being handled, if any.
 * @returns The user, or `undefined` when nobody is signed in or there is no request.
 *
 * @example
 * ```ts
 * import { currentUser } from "@zerotal/core/auth";
 *
 * const user = currentUser(ctx);
 * if (user) log.info("seen", { user: String(user.id) });
 * ```
 *
 * @category Auth
 */
export function currentUser(
  ctx: HttpContext | null | undefined = RequestContext.tryGet(),
): CurrentUser | undefined {
  if (!ctx) return undefined;
  const user: unknown = Reflect.get(ctx, "user");
  if (user === null || typeof user !== "object") return undefined;
  return user as CurrentUser;
}

/**
 * The signed-in user's id as a string, or `undefined` for a guest or a user with no id.
 *
 * @remarks
 * What a key, a signature or an ownership check wants: one comparable value. `0` and `""` are
 * ids like any other; only a missing one (`undefined`, `null`) reads as none.
 *
 * @param ctx - The request to read. Defaults to the one being handled, if any.
 * @returns The id, stringified, or `undefined`.
 *
 * @category Auth
 */
export function currentUserId(
  ctx: HttpContext | null | undefined = RequestContext.tryGet(),
): string | undefined {
  const id = currentUser(ctx)?.id;
  return id === undefined || id === null ? undefined : String(id);
}
