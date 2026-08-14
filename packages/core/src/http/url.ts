/**
 * The application URL service — generation **and** signing in one place.
 *
 * There are two URL constructs in Zerotal; this is the high-level one:
 *
 *  - {@link Uri} (`uri()`) — a low-level, immutable URI *value object*: parse a URL and
 *    fluently rewrite its scheme/host/path/query/fragment. Use it to manipulate any URL.
 *  - **`Url` / `url()`** (this file) — the app-aware URL *service*: build fully-qualified
 *    URLs for paths, named routes, the current/previous request, the `intended` URL, AND
 *    generate/verify HMAC-signed, time-limited links.
 *
 * `Url` and `url()` are the same object — `url()` is the function form, `Url` the facade.
 *
 * @example
 * url("user/profile");          // "https://app.test/user/profile"
 * url("user/profile", [1]);     // "https://app.test/user/profile/1"  (extra path segments)
 *
 * Url.current();                // current URL, without the query string
 * Url.full();                   // current URL, with the query string
 * Url.to("posts", [42]);        // "https://app.test/posts/42"
 * Url.route("posts.show", { id: 42 });
 * Url.intended("/dashboard");   // the post-login target, with open-redirect guard
 *
 * // Signed, time-limited links (uses APP_KEY unless a secret is passed):
 * const link = Url.sign("https://app.test/verify", { email }, 15); // expires in 15 min
 * if (Url.verify(link)) { ... }                                    // false if tampered/expired
 */
import { RequestContext } from "../context/RequestContext.ts";
import { route } from "../router/Router.ts";
import type { RouteArgs, RouteParamValues, RouteQuery, RouteTarget } from "../router/registry.ts";
import { ZerotalError } from "../errors/ZerotalError.ts";
import { URLSigner } from "../crypt/URLSigner.ts";
import { Uri, appBaseUrl, type QueryInput } from "./Uri.ts";

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

// ── Signing ──────────────────────────────────────────────────────────────────
// HMAC-SHA256 signed URLs for email verification, password resets, invite/one-time
// links. Signs with APP_KEY by default (the same key as `Crypt`), or an explicit secret.

/** Raised when signing is used without an `APP_KEY` configured and no explicit secret. */
export class UrlKeyMissingError extends ZerotalError {
  constructor() {
    super(
      "[Zerotal] URL signing requires APP_KEY. Generate one with `zerotal key:generate`.",
      "E_URL_NO_KEY",
      500,
    );
  }
}

let _secret: string | null = null;
let _signer: URLSigner | null = null;

function _signerFor(secret?: string): URLSigner {
  if (secret) return new URLSigner(secret);
  if (_signer) return _signer;
  const key = _secret ?? Bun.env["APP_KEY"];
  if (!key) throw new UrlKeyMissingError();
  _signer = new URLSigner(key);
  return _signer;
}

/** Resolve the base origin: configured app URL, else the current request's origin, else "". */
function base(): string {
  const configured = appBaseUrl();
  if (configured) return configured;
  return RequestContext.tryGet()?.url.origin ?? "";
}

/** Join a path with extra segments: ("user/profile", [1]) → "/user/profile/1". */
function joinPath(path: string, extra: (string | number)[] = []): string {
  if (SCHEME_RE.test(path)) {
    const tail = extra.map((e) => encodeURIComponent(String(e))).join("/");
    return tail ? `${path.replace(/\/+$/, "")}/${tail}` : path;
  }
  const head = path.replace(/^\/+|\/+$/g, "");
  const segs = extra.map((e) => encodeURIComponent(String(e)));
  return "/" + [head, ...segs].filter((s) => s !== "").join("/");
}

/** Build a fully-qualified URL string for a path (+ optional extra segments). */
function toUrl(path: string, extra: (string | number)[] = [], secure = false): string {
  const joined = joinPath(path, extra);
  if (SCHEME_RE.test(joined)) {
    return secure ? Uri.of(joined).withScheme("https").value() : joined;
  }
  const origin = base();
  const abs = origin ? `${origin}${joined}` : joined;
  return secure ? Uri.of(abs).withScheme("https").value() : abs;
}

/** Returned by `url()` (no arguments) — the URL generator surface. */
export interface UrlGenerator {
  /** Checks if the current URL matches a given path. */
  is(path: string): boolean;
  /** The current request URL, WITHOUT the query string. */
  current(): string;
  /** The current request URL, WITH the query string. */
  full(): string;
  /** The previous URL (the `Referer` header), falling back to `fallback`. */
  previous(fallback?: string): string;
  /** A fully-qualified URL for a path (+ optional extra path segments). */
  to(path: string, extra?: (string | number)[], secure?: boolean): string;
  /** A fully-qualified HTTPS URL. */
  secure(path: string, extra?: (string | number)[]): string;
  /** A fully-qualified URL with a query string appended. */
  query(path: string, query: QueryInput, extra?: (string | number)[]): string;
  /**
   * A fully-qualified URL for a named route. Same arguments as the global
   * {@link route} helper — params are exact, query values go third. For a name
   * only known at runtime: `url().to(route.dynamic(name, params))`.
   */
  route<N extends RouteTarget>(name: N, ...args: RouteArgs<N>): string;
  /**
   * The URL the user was heading to before authentication (the session's `intended_url`),
   * falling back to `fallback`. Cross-origin stored URLs are rejected (open-redirect guard).
   * Returns a plain string.
   *
   * @example
   * url().intended("/dashboard");
   */
  intended(fallback?: string): string;

  // ── Signed URLs ──────────────────────────────────────────────────────────────

  /**
   * Build an HMAC-signed, time-limited URL. Signs with `APP_KEY` unless `secret` is given.
   *
   * @param base   The base URL (scheme + host + path).
   * @param params Extra query parameters to include (encoded into the signature).
   * @param expiresInMinutes Minutes until the link expires. Default 60.
   * @param secret Sign with this key instead of `APP_KEY`.
   */
  sign(
    base: string,
    params?: Record<string, string>,
    expiresInMinutes?: number,
    secret?: string,
  ): string;
  /** Verify a signed URL — `false` if tampered, expired, or unsigned. */
  verify(signedUrl: string, secret?: string): boolean;
  /** Override the default signing secret (otherwise derived from `APP_KEY`). */
  setSecret(secret: string): void;
}

const generator: UrlGenerator = {
  is(path) {
    if (path.endsWith("*")) {
      const prefix = path.slice(0, -1);
      return Uri.current().value().startsWith(prefix);
    }
    return Uri.current().value() === toUrl(path);
  },
  current() {
    return Uri.current().replaceQuery({}).withFragment(undefined).value();
  },
  full() {
    return RequestContext.get().fullUrl();
  },
  previous(fallback = "/") {
    const ctx = RequestContext.tryGet();
    const referer = ctx?.request.headers.get("referer") ?? ctx?.request.headers.get("referrer");
    return referer ?? toUrl(fallback);
  },
  to(path, extra = [], secure = false) {
    return toUrl(path, extra, secure);
  },
  secure(path, extra = []) {
    return toUrl(path, extra, true);
  },
  query(path, query, extra = []) {
    return Uri.of(toUrl(path, extra)).withQuery(query).value();
  },
  route<N extends RouteTarget>(name: N, ...args: RouteArgs<N>) {
    const [params = {}, query = {}] = args as [RouteParamValues?, RouteQuery?];
    return toUrl(route.dynamic(name, params, query));
  },
  intended(fallback = "/") {
    // Uri.intended reads (and clears) the session's intended_url with an open-redirect guard.
    return Uri.of("/").intended(fallback).value();
  },
  sign(base, params = {}, expiresInMinutes = 60, secret) {
    return _signerFor(secret).sign(base, params, expiresInMinutes);
  },
  verify(signedUrl, secret) {
    return _signerFor(secret).verify(signedUrl);
  },
  setSecret(secret) {
    _secret = secret;
    _signer = null;
  },
};

/**
 * The application URL facade — the same object {@link url} returns, exported for direct
 * `Url.to(...)` / `Url.route(...)` / `Url.sign(...)` calls. Generation + signing in one place.
 */
export const Url: UrlGenerator = generator;

export function url(): UrlGenerator;
export function url(path: string, extra?: (string | number)[], secure?: boolean): string;
export function url(
  path?: string,
  extra: (string | number)[] = [],
  secure = false,
): string | UrlGenerator {
  if (path === undefined) return generator;
  return toUrl(path, extra, secure);
}
