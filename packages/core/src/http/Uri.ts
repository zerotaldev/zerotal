/**
 * Fluent, immutable URI builder for composing and manipulating URLs as objects.
 *
 * Every mutator returns a NEW `Uri`, so instances are safe to share. Works with both absolute
 * URLs (`https://example.com/p?x=1`) and relative ones (`/dashboard?tab=2`).
 *
 * @example
 * uri("https://example.com/users?page=1")
 *   .withQuery({ page: 2, sort: "name" })
 *   .withFragment("top")
 *   .value(); // "https://example.com/users?page=2&sort=name#top"
 *
 * uri("/login").redirect();                 // → ResponseBuilder (302)
 * uri().intended("/dashboard").redirect();  // → redirect to the stored intended URL
 */
import { RequestContext } from "../context/RequestContext.ts";
import { route } from "../router/Router.ts";
import type { RouteArgs, RouteParamValues, RouteQuery, RouteTarget } from "../router/registry.ts";
import { safeRedirectPath } from "../pipeline/HttpContext.ts";
import { ResponseBuilder } from "../helpers/response.ts";
import { config } from "../helpers/config.ts";

type QueryValue = string | string[];

/**
 * Accepted shape for query parameters passed to the `Uri` query mutators
 * ({@link Uri.withQuery}, {@link Uri.replaceQuery}, …) and the `url()` service.
 * Values are coerced to strings; arrays become repeated (multi-value) parameters.
 */
export type QueryInput = Record<string, string | number | boolean | string[]>;

interface UriParts {
  scheme?: string;
  user?: string;
  password?: string;
  host?: string;
  port?: number;
  path: string;
  query: Record<string, QueryValue>;
  fragment?: string;
}

/** Read-only view over a URI's query string, returned by `Uri.query()`. */
export interface UriQueryString {
  /** All query parameters as a plain object. */
  all(): Record<string, QueryValue>;
  /** The first value for a key (or undefined). */
  get(key: string): string | undefined;
  /** Every value for a key as an array. */
  getAll(key: string): string[];
  /** Whether a key is present. */
  has(key: string): boolean;
  /** The encoded query string (without the leading `?`). */
  toString(): string;
}

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i;

function parseQueryString(search: string): Record<string, QueryValue> {
  const out: Record<string, QueryValue> = {};
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    out[key] = values.length > 1 ? values : (values[0] ?? "");
  }
  return out;
}

function buildQueryString(query: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) for (const v of value) params.append(key, v);
    else params.append(key, value);
  }
  return params.toString();
}

function normaliseQueryInput(input: QueryInput): Record<string, QueryValue> {
  const out: Record<string, QueryValue> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = Array.isArray(value) ? value.map(String) : String(value);
  }
  return out;
}

/**
 * The configured application base URL (`config('app.url')`, then `APP_URL`), without a trailing
 * slash. Empty string when neither is set. @internal — shared with the `url()` helper.
 */
export function appBaseUrl(): string {
  let base: string | undefined;
  try {
    base = config("app.url" as never) as string | undefined;
  } catch {
    base = undefined;
  }
  base ??= Bun.env.APP_URL;
  return (base ?? "").replace(/\/+$/, "");
}

function parse(value: string): UriParts {
  if (SCHEME_RE.test(value)) {
    const u = new URL(value);
    return {
      scheme: u.protocol.replace(/:$/, ""),
      user: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      host: u.hostname,
      port: u.port ? Number(u.port) : undefined,
      path: u.pathname,
      query: parseQueryString(u.search),
      fragment: u.hash ? u.hash.slice(1) : undefined,
    } as UriParts;
  }

  // Relative URI — split off #fragment, then ?query, leaving the path.
  let rest = value;
  let fragment: string | undefined;
  const hashIdx = rest.indexOf("#");
  if (hashIdx >= 0) {
    fragment = rest.slice(hashIdx + 1);
    rest = rest.slice(0, hashIdx);
  }
  let query: Record<string, QueryValue> = {};
  const qIdx = rest.indexOf("?");
  if (qIdx >= 0) {
    query = parseQueryString(rest.slice(qIdx));
    rest = rest.slice(0, qIdx);
  }
  return { path: rest, query, fragment } as UriParts;
}

/**
 * Fluent, immutable URI value object. Parse an absolute or relative URL, read its
 * parts, and rewrite scheme/host/path/query/fragment — every mutator returns a
 * NEW `Uri`, so instances are safe to share and reuse.
 *
 * Construct via the {@link uri} helper or the static factories ({@link Uri.of},
 * {@link Uri.to}, {@link Uri.current}, {@link Uri.route}). For app-aware URL
 * generation and signing, see the higher-level {@link Url} / {@link url} service.
 *
 * @example
 * Uri.of("https://example.com/users?page=1")
 *   .withQuery({ page: 2, sort: "name" })
 *   .withFragment("top")
 *   .value(); // "https://example.com/users?page=2&sort=name#top"
 *
 * @throws {Error} from {@link Uri.url} (and, transitively, {@link Uri.current})
 * when called on a relative URI that has no host.
 */
export class Uri {
  readonly #parts: UriParts;

  private constructor(parts: UriParts) {
    this.#parts = parts;
  }

  // ── Factories ──────────────────────────────────────────────────────────────

  /**
   * Build a Uri from a string (or clone another Uri).
   * @category Construction
   */
  static of(value: string | Uri): Uri {
    if (value instanceof Uri) return new Uri({ ...value.#parts, query: { ...value.#parts.query } });
    return new Uri(parse(value));
  }

  /**
   * Build an absolute Uri for `path`, relative to the app URL (`config('app.url')`).
   * @category Construction
   */
  static to(path: string): Uri {
    const base = appBaseUrl();
    const rel = path.startsWith("/") || SCHEME_RE.test(path) ? path : `/${path}`;
    return Uri.of(base && !SCHEME_RE.test(rel) ? `${base}${rel}` : rel);
  }

  /**
   * The current request's full URL.
   * @category Construction
   * @throws {Error} when called outside an active HTTP request.
   */
  static current(): Uri {
    return Uri.of(RequestContext.get().fullUrl());
  }

  /**
   * Build a Uri from a named route + params (+ optional query values), with the
   * same typing as the global {@link route} helper. For a name only known at
   * runtime: `Uri.of(route.dynamic(name, params))`.
   * @category Construction
   */
  static route<N extends RouteTarget>(name: N, ...args: RouteArgs<N>): Uri {
    const [params = {}, query = {}] = args as [RouteParamValues?, RouteQuery?];
    return Uri.of(route.dynamic(name, params, query));
  }

  #clone(patch: Partial<UriParts>): Uri {
    return new Uri({ ...this.#parts, ...patch, query: patch.query ?? { ...this.#parts.query } });
  }

  // ── Inspectors ─────────────────────────────────────────────────────────────

  /**
   * The scheme (e.g. `"https"`), or undefined for a relative URI.
   * @category Components
   */
  scheme(): string | undefined {
    return this.#parts.scheme;
  }
  /**
   * The decoded userinfo username, or undefined.
   * @category Components
   */
  user(): string | undefined {
    return this.#parts.user;
  }
  /**
   * The decoded userinfo password, or undefined.
   * @category Components
   */
  password(): string | undefined {
    return this.#parts.password;
  }
  /**
   * The host (without port), or undefined for a relative URI.
   * @category Components
   */
  host(): string | undefined {
    return this.#parts.host;
  }
  /**
   * The port number, or undefined when none is set.
   * @category Components
   */
  port(): number | undefined {
    return this.#parts.port;
  }
  /**
   * The path component (may be empty).
   * @category Components
   */
  path(): string {
    return this.#parts.path;
  }
  /**
   * The fragment (without the leading `#`), or undefined.
   * @category Components
   */
  fragment(): string | undefined {
    return this.#parts.fragment;
  }
  /**
   * The assembled absolute URL string.
   * @category Output
   * @throws {Error} when the URI is relative (has no host).
   */
  url(): string {
    const p = this.#parts;
    if (!p.host) throw new Error("Cannot call Uri.url() on a relative URI");
    let out = `${p.scheme ?? "http"}://`;
    if (p.user) {
      out += encodeURIComponent(p.user);
      if (p.password) out += `:${encodeURIComponent(p.password)}`;
      out += "@";
    }
    out += p.host;
    if (p.port) out += `:${p.port}`;
    out += p.path || "/";
    const qs = buildQueryString(p.query);
    if (qs) out += `?${qs}`;
    if (p.fragment) out += `#${p.fragment}`;
    return out;
  }

  /**
   * A read-only view over the query string.
   * @category Query
   */
  query(): UriQueryString {
    const q = this.#parts.query;
    return {
      all: () => ({ ...q }),
      get: (key) => {
        const v = q[key];
        return Array.isArray(v) ? v[0] : v;
      },
      getAll: (key) => {
        const v = q[key];
        return v === undefined ? [] : Array.isArray(v) ? [...v] : [v];
      },
      has: (key) => key in q,
      toString: () => buildQueryString(q),
    };
  }

  // ── Mutators (return a new Uri) ──────────────────────────────────────────────

  /**
   * Return a copy with the scheme replaced (trailing `://` is stripped).
   * @category Components
   */
  withScheme(scheme: string): Uri {
    return this.#clone({ scheme: scheme.replace(/:?\/?\/?$/, "") });
  }
  /**
   * Return a copy with the userinfo username (and optional password) set.
   * @category Components
   */
  withUser(user: string | undefined, password?: string): Uri {
    return this.#clone({ user, ...(password !== undefined ? { password } : {}) } as UriParts);
  }
  /**
   * Return a copy with the userinfo password set.
   * @category Components
   */
  withPassword(password: string | undefined): Uri {
    return this.#clone({ password } as UriParts);
  }
  /**
   * Return a copy with the host replaced.
   * @category Components
   */
  withHost(host: string): Uri {
    return this.#clone({ host });
  }
  /**
   * Return a copy with the port set (pass undefined to remove it).
   * @category Components
   */
  withPort(port: number | undefined): Uri {
    return this.#clone({ port } as UriParts);
  }
  /**
   * Return a copy with the path replaced; a non-empty path is given a leading slash.
   * @category Components
   */
  withPath(path: string): Uri {
    return this.#clone({ path: path.startsWith("/") || path === "" ? path : `/${path}` });
  }
  /**
   * Return a copy with the fragment set (pass undefined to remove it).
   * @category Components
   */
  withFragment(fragment: string | undefined): Uri {
    return this.#clone({ fragment } as UriParts);
  }

  /**
   * Merge the given parameters into the query string (overwriting existing keys).
   * @category Query
   */
  withQuery(query: QueryInput): Uri {
    return this.#clone({ query: { ...this.#parts.query, ...normaliseQueryInput(query) } });
  }

  /**
   * Add parameters only when their key is not already present.
   * @category Query
   */
  withQueryIfMissing(query: QueryInput): Uri {
    const merged = { ...this.#parts.query };
    for (const [key, value] of Object.entries(normaliseQueryInput(query))) {
      if (!(key in merged)) merged[key] = value;
    }
    return this.#clone({ query: merged });
  }

  /**
   * Replace the entire query string with the given parameters.
   * @category Query
   */
  replaceQuery(query: QueryInput): Uri {
    return this.#clone({ query: normaliseQueryInput(query) });
  }

  /**
   * Append a value to a key, turning it into a multi-value parameter.
   * @category Query
   */
  pushOntoQuery(key: string, value: string | number): Uri {
    const current = this.#parts.query[key];
    const next: QueryValue =
      current === undefined
        ? String(value)
        : Array.isArray(current)
          ? [...current, String(value)]
          : [current, String(value)];
    return this.#clone({ query: { ...this.#parts.query, [key]: next } });
  }

  /**
   * Remove one or more keys from the query string.
   * @category Query
   */
  withoutQuery(keys: string[]): Uri {
    const next = { ...this.#parts.query };
    for (const key of keys) delete next[key];
    return this.#clone({ query: next });
  }

  // ── Zerotal extras ────────────────────────────────────────────────────────────

  /**
   * Resolve the URL the user was heading to before authentication (the session's
   * `intended_url`, set by RequireAuth), falling back to `fallback`. Cross-origin stored URLs
   * are rejected (open-redirect guard). Returns a fresh Uri pointing at the resolved target.
   *
   * @example
   * return uri().intended("/dashboard").redirect();
   *
   * @category Construction
   */
  intended(fallback = "/"): Uri {
    const ctx = RequestContext.tryGet();
    const session = (
      ctx as unknown as { session?: { get<T>(k: string): T | undefined; forget(k: string): void } }
    )?.session;
    const stored = session?.get<string>("intended_url");
    if (stored) session?.forget("intended_url");
    const origin = ctx?.url.origin ?? "";
    return Uri.of(safeRedirectPath(stored, origin) ?? fallback);
  }

  /**
   * Issue a redirect to this URI, returning a {@link ResponseBuilder} for flash chaining.
   * @category Output
   * @throws {Error} when called outside an active HTTP request.
   */
  redirect(status: 301 | 302 | 303 | 307 | 308 = 302): ResponseBuilder {
    const ctx = RequestContext.get();
    ctx.redirect(this.value(), status);
    return new ResponseBuilder(ctx);
  }

  // ── Output ────────────────────────────────────────────────────────────────────

  /**
   * The assembled URI string. Unlike {@link Uri.url}, this works for both
   * absolute and relative URIs.
   * @category Output
   */
  value(): string {
    const p = this.#parts;
    let out = "";
    if (p.host) {
      out += `${p.scheme ?? "http"}://`;
      if (p.user) {
        out += encodeURIComponent(p.user);
        if (p.password) out += `:${encodeURIComponent(p.password)}`;
        out += "@";
      }
      out += p.host;
      if (p.port) out += `:${p.port}`;
      out += p.path || "/";
    } else {
      out += p.path;
    }
    const qs = buildQueryString(p.query);
    if (qs) out += `?${qs}`;
    if (p.fragment) out += `#${p.fragment}`;
    return out;
  }

  /**
   * Alias for {@link Uri.value} — enables string coercion and template literals.
   * @category Output
   */
  toString(): string {
    return this.value();
  }

  /**
   * Serialize to the URI string when passed to `JSON.stringify`.
   * @category Output
   */
  toJSON(): string {
    return this.value();
  }
}

/**
 * Fluent URI helper. Pass a URL string to build from it, or call with no arguments to start
 * from the current request URL.
 *
 * @example
 * uri("https://example.com/p?x=1").withQuery({ x: 2 }).value();
 * uri().withoutQuery(["page"]).value();          // current URL, page param dropped
 * uri().intended("/dashboard").redirect();       // redirect to the stored intended URL
 */
export function uri(value?: string | Uri): Uri {
  return value === undefined ? Uri.current() : Uri.of(value);
}
