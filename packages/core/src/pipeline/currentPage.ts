import { HttpContext } from "./HttpContext.ts";

/**
 * Resolves the page a paginator should return when the caller doesn't name one.
 *
 * @param pageName - The paginator's name, so one request can drive several independently.
 * @returns The 1-based page, or `undefined` to fall back to the query string.
 *
 * @internal
 */
export type CurrentPageResolver = (pageName: string) => number | undefined;

/**
 * Override where `paginate()` reads the current page for the rest of this request.
 *
 * The default reads the query string, which is what a plain HTTP request wants. A
 * server-driven view whose page number lives in component state rather than the URL
 * registers its own instead — Flow's `Pagination` mixin does exactly this, so
 * `Post.paginate(10)` inside a component follows the component's page.
 *
 * Scoped to the request: the resolver goes on the active {@link HttpContext}, reached through
 * request-scoped storage, so it lasts exactly as long as the request does and never reaches
 * another one. Keep it that way — a module-level slot would not be request-scoped.
 *
 * @param resolver - Called with the paginator name; return `undefined` to defer to the query string.
 *
 * @internal
 */
export function setCurrentPageResolver(resolver: CurrentPageResolver): void {
  const ctx = HttpContext.tryGet();
  if (ctx) ctx._pageResolver = resolver;
}

/**
 * The page a paginator should return, for the request in flight.
 *
 * Order: a resolver registered for this request, then the query string, then `1`. Outside a
 * request — a queue worker, a CLI command, a test — there is nothing to read, so it is `1`.
 *
 * @param pageName - The paginator's name. Defaults to `"page"`.
 * @returns A 1-based page number, never below 1.
 */
export function currentPage(pageName = "page"): number {
  const ctx = HttpContext.tryGet();
  if (!ctx) return 1;

  const resolved = ctx._pageResolver?.(pageName);
  const page = resolved ?? ctx.integer(pageName, 1);
  return Math.max(1, Math.trunc(page ?? 1));
}
