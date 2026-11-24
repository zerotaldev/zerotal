import type { HttpContext } from "zerotal";

/** Where the visitor was headed before the sign-in page stopped them, or the dashboard. */
export function intendedUrl(http: HttpContext, fallback = "/dashboard"): string {
  const intended = http.session?.get("intended_url");
  http.session?.forget("intended_url");
  if (typeof intended === "string") {
    try {
      const url = new URL(intended, http.request.url);
      // Only ever back into this app.
      if (url.origin === new URL(http.request.url).origin) return url.pathname + url.search;
    } catch {
      // Not a URL. Fall through.
    }
  }
  return fallback;
}
