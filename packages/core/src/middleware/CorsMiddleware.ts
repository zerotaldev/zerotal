/**
 * CORS middleware: applies `Access-Control-*` headers to responses and answers
 * preflight `OPTIONS` requests, configurable per-origin and via app config.
 */
import type { NextFn } from "../pipeline/types.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";
import { BaseMiddleware, deepMerge } from "./BaseMiddleware.ts";
import { withHeaders } from "../http/withHeaders.ts";
import { config } from "../helpers/config.ts";

export interface CorsOptions {
  /**
   * Allowed origins. Default: `[]` — same-origin only, so nothing is shared until an app
   * names what it means to share with.
   *
   * A **string** or **array** is matched exactly against the request's `Origin`, scheme
   * and port included.
   *
   * `'*'` allows any origin. It cannot be combined with `credentials: true` (the browser
   * rejects that pairing outright), and it means every page on the internet can read any
   * response this middleware covers that is not separately credential-gated.
   *
   * A **function** receives the raw `Origin` header and returns whether to allow it. Match
   * the whole origin, not a suffix: `o.endsWith('.example.com')` also matches
   * `https://evil.example.com.attacker.test` and `http://x.example.com` — write
   * `new URL(o).hostname.endsWith('.example.com') && o.startsWith('https://')`, or just
   * list the origins.
   */
  origin?: string | string[] | ((origin: string) => boolean);
  /** Allowed HTTP methods. Default: `['GET','POST','PUT','PATCH','DELETE','OPTIONS']`. */
  methods?: string[];
  /** Allowed request headers. Default: `['Content-Type','Authorization','X-Requested-With']`. */
  allowedHeaders?: string[];
  /** Headers the browser may expose to JS. Default: `[]`. */
  exposedHeaders?: string[];
  /** Allow cookies / auth headers in cross-origin requests. Default: `false`. */
  credentials?: boolean;
  /** Preflight cache duration in seconds. Default: `600`. */
  maxAge?: number;
}

/**
 * CORS middleware — adds Access-Control-* headers to every response and
 * short-circuits HTTP OPTIONS preflight requests with 204.
 *
 * @example
 * // Global (most common):
 * app.use(new CorsMiddleware());
 *
 * // Restrict to specific origins (the usual case):
 * app.use(CorsMiddleware.with({ origin: 'https://app.example.com', credentials: true }));
 *
 * // Dynamic per-origin check — compare the whole origin, never a suffix:
 * app.use(CorsMiddleware.with({
 *   origin: (o) => o.startsWith('https://') && new URL(o).hostname.endsWith('.example.com'),
 * }));
 */
export class CorsMiddleware extends BaseMiddleware<CorsOptions> {
  protected options: CorsOptions = {
    origin: [],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    exposedHeaders: [],
    credentials: false,
    maxAge: 600,
  };

  constructor(options: CorsOptions = {}) {
    super();
    // App-level defaults from config('app.cors') layer over the built-ins; explicit
    // options (constructor arg or .with(...)) win over both.
    this.options = deepMerge(this.options, config.safe("app.cors", {} as Partial<CorsOptions>));
    this.options = deepMerge(this.options, options);
  }

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const requestOrigin = http.request.headers.get("Origin") ?? "";
    const allowedOrigin = this._resolveOrigin(requestOrigin);

    // Preflight: respond immediately without going deeper into the pipeline
    if (http.request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: this._buildHeaders(allowedOrigin, http),
      });
    }

    const response = await next();

    // Attach CORS headers to the actual response
    if (response && allowedOrigin) {
      return withHeaders(response, this._buildHeaders(allowedOrigin, http));
    }
  }

  private _resolveOrigin(requestOrigin: string): string {
    const origin = this.options.origin ?? [];
    if (origin === "*") {
      // `Access-Control-Allow-Origin: *` and `Allow-Credentials: true` is a combination
      // browsers reject, so an app that sets both has a misconfiguration rather than a
      // wildcard. Reflecting the caller's origin there would quietly turn it into
      // "any origin, with cookies" — refuse instead.
      if (this.options.credentials) return "";
      return "*";
    }
    if (typeof origin === "function") {
      return origin(requestOrigin) ? requestOrigin : "";
    }
    if (Array.isArray(origin)) {
      return origin.includes(requestOrigin) ? requestOrigin : "";
    }
    return origin === requestOrigin ? requestOrigin : "";
  }

  private _buildHeaders(allowedOrigin: string, ctx: HttpContext): Record<string, string> {
    if (!allowedOrigin) return {};

    const methods = this.options.methods ?? ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
    const allowedHeaders = this.options.allowedHeaders ?? [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
    ];
    const exposedHeaders = this.options.exposedHeaders ?? [];
    const credentials = this.options.credentials ?? false;
    const maxAge = this.options.maxAge ?? 600;

    const headers: Record<string, string> = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": methods.join(", "),
      "Access-Control-Allow-Headers": allowedHeaders.join(", "),
      "Access-Control-Max-Age": String(maxAge),
    };

    if (credentials) {
      headers["Access-Control-Allow-Credentials"] = "true";
    }

    if (exposedHeaders.length > 0) {
      headers["Access-Control-Expose-Headers"] = exposedHeaders.join(", ");
    }

    // Vary by Origin for non-wildcard responses so shared caches don't serve
    // one origin's CORS headers to another.
    if (allowedOrigin !== "*") {
      const existing = ctx.response?.headers.get("Vary") ?? "";
      headers["Vary"] = existing ? `${existing}, Origin` : "Origin";
    }

    return headers;
  }
}
