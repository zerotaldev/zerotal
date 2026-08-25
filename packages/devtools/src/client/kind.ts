/**
 * What kind of request a trace is — the page, the app talking, or a file the
 * browser fetched because the page said to.
 *
 * The panel had no such notion, and one behaviour made that expensive: live mode
 * selects every trace as it arrives, so opening `/login` selected `/login` for a
 * few milliseconds and then `/favicon.ico`, `/css/app.css`, and whatever else the
 * page pulled. The bar named a request nobody asked about, the detail below it
 * described that request's headers and its empty session, and the page you were
 * actually looking at had scrolled into the list. The information was never
 * wrong; it was about the wrong thing.
 *
 * Three kinds, because two would not do the job. Suppressing "not the document"
 * would suppress the form post and the Inertia visit — the requests most worth
 * watching. What deserves to be skipped over is narrower than that: a
 * sub-resource the browser fetched on its own initiative.
 *
 * ## Why the browser is asked rather than the URL
 *
 * `Sec-Fetch-Dest` is the purpose-built answer — the browser states what it
 * wanted the response for, and it is the only source here that cannot be fooled.
 * A `.js` path can serve an API, a route with no extension can serve a
 * stylesheet, and an app that hashes its asset names has neither. The extension
 * rule is last and exists for the clients that send no such header at all.
 */
import type { RequestTrace } from "../RequestTrace.ts";

/**
 * - `document` — a navigation. The page in the address bar.
 * - `api` — the app talking: form posts, Inertia visits, fetch, anything a
 *   script asked for on purpose.
 * - `asset` — a sub-resource the browser fetched by itself.
 */
export type RequestKind = "document" | "api" | "asset";

/** `Sec-Fetch-Dest` values that mean the browser wanted a file, not an answer. */
const ASSET_DESTINATIONS = new Set([
  "image",
  "style",
  "script",
  "font",
  "manifest",
  "audio",
  "video",
  "track",
  "embed",
  "object",
  "worker",
  "sharedworker",
  "serviceworker",
  "paintworklet",
  "audioworklet",
  "xslt",
  "report",
]);

/** Content types served as files. Checked as prefixes — parameters follow. */
const ASSET_TYPES = [
  "text/css",
  "image/",
  "font/",
  "audio/",
  "video/",
  "application/javascript",
  "text/javascript",
  "application/font",
  "application/manifest",
];

/** The last resort, for a client that announces nothing about itself. */
const ASSET_EXTENSIONS = new Set([
  "css",
  "js",
  "mjs",
  "map",
  "ico",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "avif",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "mp3",
  "mp4",
  "webm",
  "wasm",
  "webmanifest",
]);

/** Case-insensitive header read — a trace's headers are whatever the client sent. */
function header(trace: RequestTrace, name: string): string {
  const headers = trace.headers ?? {};
  const hit = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return hit ? String(headers[hit] ?? "").toLowerCase() : "";
}

function responseType(trace: RequestTrace): string {
  const headers = trace.responseHeaders ?? {};
  const hit = Object.keys(headers).find((k) => k.toLowerCase() === "content-type");
  return hit ? String(headers[hit] ?? "").toLowerCase() : "";
}

/** Classify one trace. Never throws, and never guesses `asset` without a reason. */
export function requestKind(trace: RequestTrace): RequestKind {
  // 1. What the browser says it wanted the response for. Unfoolable, and absent
  //    only from clients that are not browsers.
  const dest = header(trace, "sec-fetch-dest");
  if (dest === "document" || dest === "iframe" || dest === "frame") return "document";
  if (ASSET_DESTINATIONS.has(dest)) return "asset";
  if (dest === "empty") return "api";

  // 2. What was actually served. A page is a page whatever asked for it, which
  //    is what makes this right for curl and for a server-rendered form post.
  const type = responseType(trace);
  if (type.startsWith("text/html")) return "document";
  if (ASSET_TYPES.some((prefix) => type.startsWith(prefix))) return "asset";

  // 3. The path, for a client that announced nothing and a response that carried
  //    no type — a 404 for a missing stylesheet, most often.
  const extension = (trace.path ?? "").split("?")[0]?.split(".").pop()?.toLowerCase() ?? "";
  if (extension && ASSET_EXTENSIONS.has(extension)) return "asset";

  // Unclassifiable is `api`, never `asset`. Being wrong here decides whether a
  // request is skipped over, and skipping the wrong one is how the panel stops
  // showing you what you came to see.
  return "api";
}

/** Whether live mode should move the selection onto this trace. */
export function worthSelecting(trace: RequestTrace): boolean {
  return requestKind(trace) !== "asset";
}
