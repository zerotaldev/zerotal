/**
 * The application-level configuration shape and its factory: the `app`
 * namespace that every Zerotal app carries (identity, server/TLS, middleware
 * defaults, conventions), with sensible defaults applied over caller overrides.
 */
import { deepMerge } from "../support/deepMerge.ts";
import { isProdLike } from "../support/env.ts";
import type { HealthConfigShape } from "../health/Health.ts";
import type { DevConfigShape } from "../dev/DevProcess.ts";

/** TLS certificate and key paths that enable HTTPS when provided. */
export interface AppTlsConfig {
  /** Path to the TLS certificate file. */
  cert: string;
  /** Path to the TLS private key file. */
  key: string;
}

/** Auto-discovery (convention) settings. See docs/conventions.md. */
export interface ConventionsConfig {
  /** Master switch for convention-based auto-registration. Default: true */
  enabled: boolean;
  /** Per-concern directory overrides, relative to the app root. */
  paths: {
    providers: string;
    middleware: string;
    models: string;
    observers: string;
    policies: string;
    listeners: string;
    events: string;
    jobs: string;
    schedules: string;
    validators: string;
    commands: string;
  };
}

/** App-level CORS defaults (consumed by `CorsMiddleware` when registered without options). */
export interface AppCorsConfig {
  origin: string | string[];
  credentials: boolean;
}

/** App-level rate-limit defaults (consumed by `ThrottleMiddleware`). */
export interface AppThrottleConfig {
  maxAttempts: number;
  windowSeconds: number;
}

/**
 * App-level security-header defaults (consumed by `SecureHeadersMiddleware`).
 *
 * The middleware reads this whole block and layers it over its own defaults, so
 * every one of its options has always worked here — but only `frameOptions` was
 * declared, which made the rest a type error to write down. `secure` is the one
 * that matters: HSTS is emitted only when it is true, so an app that could not
 * name it in config had no supported way to turn HSTS on.
 */
export interface AppSecureHeadersConfig {
  frameOptions: "DENY" | "SAMEORIGIN";
  /**
   * Enable HSTS (and the `Secure` flag on the XSRF-TOKEN cookie). Defaults to
   * `false` — turn it on for any deployment served over HTTPS.
   */
  secure?: boolean;
  /** `Strict-Transport-Security` max-age in seconds. Defaults to one year. */
  hstsMaxAge?: number;
  /** Include `includeSubDomains` in the HSTS header. Defaults to `true`. */
  hstsIncludeSubDomains?: boolean;
  /** Set the HSTS `preload` directive. Only with the domain registered. Defaults to `false`. */
  hstsPreload?: boolean;
  /** `Content-Security-Policy` value. Omitted by default. */
  contentSecurityPolicy?: string;
  /** `Referrer-Policy` value. Defaults to `strict-origin-when-cross-origin`. */
  referrerPolicy?: string;
}

/**
 * Front-end asset bundling. When set, `bun zerotal serve` bundles the
 * entrypoint(s) with Bun's native bundler before starting (and rebuilds them on
 * change under `serve --dev`). A JS/TS entry may `import` its CSS — Bun emits a
 * sibling stylesheet. Tailwind v4 is picked up automatically when
 * `bun-plugin-tailwind` is installed in the app.
 */
export interface AppAssetsConfig {
  /** Entry file(s) to bundle, relative to the app root (e.g. `resources/js/app.ts`). */
  entrypoint: string | string[];
  /** Output directory for built bundles, relative to the app root. Default: `public`. */
  outDir: string;
  /** URL prefix the built assets are served under. Default: `/`. */
  prefix: string;
  /** Minify output. Default: true in production, false otherwise. */
  minify: boolean;
  /**
   * Per-extension loader overrides handed to Bun's bundler, e.g.
   * `{ ".woff2": "file" }`.
   *
   * Bun inlines small files a stylesheet `url()`s as data URIs. That is the right
   * default for an icon, and the wrong one for a font: the bytes move into the
   * render-blocking stylesheet, so nine woff2 subsets can turn a 36KB stylesheet into
   * 260KB that must download before first paint — the opposite of what `font-display:
   * swap` is for. `{ ".woff2": "file" }` emits them as separate files again.
   *
   * @example
   * // config/app.ts
   * assets: { entrypoint: 'resources/css/app.css', loader: { '.woff2': 'file', '.woff': 'file' } }
   */
  loader?: Record<string, AssetLoaderKind>;
}

/**
 * Bun bundler loaders that are meaningful for an asset referenced from CSS/JS.
 * Mirrors Bun's `Loader` union, minus the source-code loaders a `url()` cannot name.
 */
export type AssetLoaderKind = "file" | "dataurl" | "base64" | "text" | "json" | "toml";

/**
 * Default request-body ceiling: 8 MiB.
 *
 * Chosen to comfortably fit a JSON API payload, a form post and an ordinary image upload
 * while keeping the worst case a single request can pin in memory to something a small
 * instance survives under concurrency. Bun's own 128 MiB default does not.
 */
export const DEFAULT_MAX_REQUEST_BODY_SIZE = 8 * 1024 * 1024;

/**
 * CORS defaults: same-origin only.
 *
 * `origin: "*"` was the previous default, which hands every browser on the internet a
 * read of any endpoint that does not separately require a credential. An app that wants
 * cross-origin access names the origins it means — the empty list is the honest default
 * because the framework cannot know them.
 */
const DEFAULT_CORS: AppCorsConfig = { origin: [], credentials: false };
const DEFAULT_THROTTLE: AppThrottleConfig = { maxAttempts: 120, windowSeconds: 60 };
const DEFAULT_SECURE_HEADERS: AppSecureHeadersConfig = { frameOptions: "SAMEORIGIN" };

const DEFAULT_CONVENTION_PATHS: ConventionsConfig["paths"] = {
  providers: "app/providers",
  middleware: "app/middleware",
  models: "app/models",
  observers: "app/observers",
  policies: "app/policies",
  listeners: "app/listeners",
  events: "app/events",
  jobs: "app/jobs",
  schedules: "app/schedules",
  validators: "app/validators",
  commands: "app/commands",
};

// ── Full shape (resolved — what the config store holds after AppConfig()) ────

/** The fully resolved `app` configuration as held in the config store. */
export interface AppConfigShape {
  // ── Identity ──────────────────────────────────────────────────────────────
  /** Human-readable application name. */
  name: string;
  /** Runtime environment string. Mirrors APP_ENV. */
  env: string;
  /** Application secret key used for signing sessions / tokens. */
  key: string;
  /** Show verbose error pages and stack traces. */
  debug: boolean;
  /** Canonical public URL (e.g. https://myapp.com). */
  url: string;
  /** Default HTTP port. Overridden by --port CLI flag. Default: 3000 */
  port: number;
  /** Application locale used for date/number formatting. Default: 'en' */
  locale: string;
  /** Application timezone. Default: 'UTC' */
  timezone: string;

  // ── Server / TLS ──────────────────────────────────────────────────────────
  /** Enable HTTP/3 over QUIC. Requires a valid tls config. Default: false */
  http3: boolean;
  /** TLS certificate + key for HTTPS. Enables HTTPS when set. */
  tls?: AppTlsConfig;
  /**
   * Largest request body the server will accept, in bytes. Default: 8 MiB.
   *
   * Bodies are fully buffered before a handler sees them — a multipart upload
   * materialises every file in RAM before `ctx.file()` reads a byte — so this is the
   * ceiling on memory a single request can claim. Bun's own default is 128 MiB, which
   * twenty concurrent POSTs turn into 2.5 GB resident on any route, authenticated or not.
   *
   * Raise it for an app that genuinely accepts large uploads, and prefer raising it on the
   * upload route's proxy rather than globally.
   */
  maxRequestBodySize: number;
  /**
   * Health endpoint configuration. Pass an object to configure it
   * (`enabled` / `path` / `secret` / `showDetails`); `enabled` defaults to on
   * outside production. A bare `true`/`false` is shorthand for enable/disable
   * with the other defaults. Default: `false`.
   *
   * @example
   * ```ts
   * health: {
   *   enabled: true,                 // default: !production
   *   path: "/health",              // default: '/health'
   *   secret: env("HEALTH_KEY"),    // required in production
   *   showDetails: true,            // false → bare { "status": "ok" }
   * }
   * ```
   */
  health: boolean | HealthConfigShape;

  // ── Transport origins ─────────────────────────────────────────────────────
  /**
   * Origins accepted for credentialed endpoints that bypass the middleware pipeline:
   * WebSocket upgrades and raw routes, of which Flow's `/__flow/http` action fallback
   * is one. Compared exactly — no wildcards, no suffix matching.
   *
   * The app's own origin is always accepted, but "own" means
   * `new URL(request.url).origin` — behind a reverse proxy that is the loopback
   * address it was bound to (`http://127.0.0.1:3000`), never the public URL the
   * browser truthfully sends. So the origin of {@link AppConfigShape.url} is always
   * merged into this list: without it a proxied app renders every page correctly and
   * refuses every browser-initiated action with a 403, which is a far quieter failure
   * than a 500 and passes any health check that reads a status code.
   *
   * Add entries only for a *different* host that legitimately drives this app — an SPA
   * on `app.example.com` calling `api.example.com`. Unlike every other array in this
   * config, what you pass is added to the URL's origin rather than replacing it.
   */
  allowedOrigins: string[];

  // ── Middleware defaults ───────────────────────────────────────────────────
  /** CORS defaults applied by `CorsMiddleware` when registered without explicit options. */
  cors: AppCorsConfig;
  /** Rate-limit defaults applied by `ThrottleMiddleware`. */
  throttle: AppThrottleConfig;
  /** Security-header defaults applied by `SecureHeadersMiddleware`. */
  secureHeaders: AppSecureHeadersConfig;

  // ── Assets ────────────────────────────────────────────────────────────────
  /** Front-end asset bundling, built on `serve`. Omitted means no asset build. */
  assets?: AppAssetsConfig;

  // ── Dev mode ──────────────────────────────────────────────────────────────
  /**
   * Extra processes for `bun zt dev`, and names to drop.
   *
   * App entries are registered after every provider's, so reusing a provider's
   * name replaces it rather than adding a second tab — which is how an app swaps
   * out, say, the queue worker for its own. `disable` removes by name whoever
   * registered it.
   *
   * @example
   * ```ts
   * dev: {
   *   processes: [{ name: "stripe", command: ["stripe", "listen", "--forward-to", "localhost:3000"] }],
   *   disable: ["queue"],
   * }
   * ```
   */
  dev?: DevConfigShape;

  // ── Conventions ───────────────────────────────────────────────────────────
  /** Auto-discovery settings (enabled + per-concern paths). */
  conventions: ConventionsConfig;
}

/**
 * Reduce a list of URLs or origins to the deduplicated origins an `Origin` header can be
 * compared against.
 *
 * Full URLs are accepted because the two things that feed this list — `app.url` and an
 * `ALLOWED_ORIGINS` env var someone pasted a browser address into — usually carry a path
 * or a trailing slash, and `https://app.com/` never equals the `https://app.com` a browser
 * sends. Entries that do not parse are kept verbatim rather than dropped: an unmatchable
 * entry is inert, whereas silently discarding one hides the typo that caused it. `bun zt
 * doctor` reports those.
 */
function _normaliseOrigins(entries: string[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    let origin: string;
    try {
      origin = new URL(trimmed).origin;
      // `new URL("mailto:a@b").origin` is "null" — parsed, but not an origin.
      if (origin === "null") origin = trimmed;
    } catch {
      origin = trimmed;
    }
    if (!out.includes(origin)) out.push(origin);
  }
  return out;
}

// ── AppConfig factory ─────────────────────────────────────────────────────────

/**
 * Build the application-level config with sensible defaults.
 *
 * Pass overrides to customise any setting. Every field has a default that works
 * out of the box so the minimum viable config is just `AppConfig({})`.
 *
 * @param options  Partial overrides; every field has a working default.
 * @returns The fully resolved {@link AppConfigShape} with defaults applied.
 *
 * @example
 * ```ts
 * // config/app.ts
 * import { AppConfig, env } from '@zerotal/core';
 *
 * export default AppConfig({
 *   name: 'My App',
 *   url:  env('APP_URL', 'http://localhost:3000'),
 * });
 * ```
 */
export function AppConfig(options: {
  name?: string;
  env?: string;
  key?: string;
  debug?: boolean;
  url?: string;
  port?: number;
  locale?: string;
  timezone?: string;
  http3?: boolean;
  tls?: AppTlsConfig;
  maxRequestBodySize?: number;
  health?: boolean | HealthConfigShape;
  allowedOrigins?: string[];
  cors?: Partial<AppCorsConfig>;
  throttle?: Partial<AppThrottleConfig>;
  secureHeaders?: Partial<AppSecureHeadersConfig>;
  assets?: {
    entrypoint: string | string[];
    outDir?: string;
    prefix?: string;
    minify?: boolean;
    loader?: Record<string, AssetLoaderKind>;
  };
  dev?: DevConfigShape;
  conventions?: { enabled?: boolean; paths?: Partial<ConventionsConfig["paths"]> };
}): AppConfigShape {
  // Resolve env-derived defaults, then deep-merge the caller's overrides so partial nested
  // overrides (e.g. `conventions.paths.models`) keep every other default in place.
  const defaults: AppConfigShape = {
    name: "Zerotal App",
    // eslint-disable-next-line no-restricted-syntax -- config is loaded before setAppEnv() runs, so APP_ENV still holds the deployment name here
    env: Bun.env["APP_ENV"] ?? "development",
    key: Bun.env["APP_KEY"] ?? "",
    debug: Bun.env["APP_DEBUG"] !== "false",
    url: Bun.env["APP_URL"] ?? "http://localhost:3000",
    port: 3000,
    locale: "en",
    timezone: "UTC",
    http3: false,
    maxRequestBodySize: DEFAULT_MAX_REQUEST_BODY_SIZE,
    health: false,
    allowedOrigins: [],
    cors: DEFAULT_CORS,
    throttle: DEFAULT_THROTTLE,
    secureHeaders: DEFAULT_SECURE_HEADERS,
    conventions: { enabled: true, paths: DEFAULT_CONVENTION_PATHS },
  };
  const resolved = deepMerge(defaults, options as Partial<AppConfigShape>);

  // `allowedOrigins` always contains the origin of `url`, and is the one array here that
  // unions rather than replaces. An app naming a second origin does not mean "and stop
  // trusting my own public URL", and the cost of getting that wrong is asymmetric: the
  // app keeps rendering and every action 403s, with nothing in the logs to say why.
  resolved.allowedOrigins = _normaliseOrigins([resolved.url, ...resolved.allowedOrigins]);

  // Normalise the optional `assets` block: fill outDir/prefix/minify defaults
  // only when the app actually declares an asset entrypoint.
  if (options.assets) {
    // `isProdLike`, so `staging` minifies too. This runs at config-load time, where
    // `resolved.env` is still the deployment name rather than the runtime mode.
    const isProduction = isProdLike(resolved.env);
    resolved.assets = {
      entrypoint: options.assets.entrypoint,
      outDir: options.assets.outDir ?? "public",
      prefix: options.assets.prefix ?? "/",
      minify: options.assets.minify ?? isProduction,
      // Only set when declared: an explicit `undefined` is a distinct value under
      // exactOptionalPropertyTypes, and would override Bun's own defaults with nothing.
      ...(options.assets.loader ? { loader: options.assets.loader } : {}),
    };
  }
  return resolved;
}
