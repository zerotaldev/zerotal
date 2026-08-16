/**
 * Security-headers middleware: adds a sensible baseline of protective response
 * headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
 * `Permissions-Policy`, optional CSP and HSTS) to every response.
 */
import type { NextFn } from "../pipeline/types.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";
import { BaseMiddleware } from "./BaseMiddleware.ts";
import { withHeaders } from "../http/withHeaders.ts";
import { config } from "../helpers/config.ts";

export interface SecureHeadersOptions {
  /**
   * `Content-Security-Policy` header value.
   * Omitted by default — set this to a policy appropriate for your application.
   */
  contentSecurityPolicy?: string;

  /**
   * `Strict-Transport-Security` max-age in seconds.
   * Defaults to 1 year (31 536 000 s). Set to `0` to disable HSTS entirely.
   * Only emitted when `secure: true` to avoid HSTS issues in plain-HTTP dev environments.
   */
  hstsMaxAge?: number;

  /**
   * Include `includeSubDomains` in the HSTS header. Defaults to `true`.
   */
  hstsIncludeSubDomains?: boolean;

  /**
   * Set the HSTS `preload` directive. Defaults to `false`.
   * Only set this if you have registered the domain with the HSTS preload list.
   */
  hstsPreload?: boolean;

  /**
   * Enable HSTS and the `Secure` flag on the XSRF-TOKEN cookie.
   * Default `false` — set to `true` in production when serving over HTTPS.
   */
  secure?: boolean;

  /**
   * `X-Frame-Options` value. Defaults to `'SAMEORIGIN'`.
   * Set to `'DENY'` for maximum protection, or `false` to omit the header.
   */
  frameOptions?: "DENY" | "SAMEORIGIN" | false;

  /**
   * `Referrer-Policy` value. Defaults to `'strict-origin-when-cross-origin'`.
   */
  referrerPolicy?: string;

  /**
   * `Permissions-Policy` header value.
   * Defaults to a conservative policy disabling sensitive APIs.
   */
  permissionsPolicy?: string | false;
}

const DEFAULT_PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=()";

/**
 * Adds common security response headers to every request.
 *
 * Defaults provide a solid security baseline out of the box:
 *   - `X-Content-Type-Options: nosniff`
 *   - `X-Frame-Options: SAMEORIGIN`
 *   - `Referrer-Policy: strict-origin-when-cross-origin`
 *   - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
 *   - `Strict-Transport-Security` (only when `secure: true`)
 *
 * @example
 * // Development (HTTP)
 * app.use([SecureHeadersMiddleware]);
 *
 * // Production (HTTPS)
 * app.use([SecureHeadersMiddleware.with({ secure: true })]);
 *
 * // Custom CSP
 * app.use([SecureHeadersMiddleware.with({
 *   secure: true,
 *   contentSecurityPolicy: "default-src 'self'; script-src 'self' 'nonce-{nonce}'",
 * })]);
 */
export class SecureHeadersMiddleware extends BaseMiddleware<SecureHeadersOptions> {
  protected options: SecureHeadersOptions;
  constructor() {
    super();
    // App-level defaults from config('app.secureHeaders'); .with(...) overrides these.
    this.options = { ...config.safe("app.secureHeaders", {} as SecureHeadersOptions) };
  }

  async handle(_ctx: HttpContext, next: NextFn): Promise<Response | void> {
    const response = await next();
    if (!response) return;
    return withHeaders(response, securityHeaders(this.options));
  }
}

/**
 * The headers this middleware adds, as a plain object.
 *
 * Separated from `handle()` because the middleware is not the only thing that
 * has to send them. Static files are registered with Bun as native
 * `Response(Bun.file)` routes and are answered without ever entering JavaScript,
 * so the pipeline — and therefore this middleware — never runs for them. That
 * left `/css/app.css` served with no `X-Content-Type-Options: nosniff`, which is
 * precisely the kind of response sniffing protection exists for, while the
 * framework advertised the header as automatic. {@link Router.static} calls this
 * so the same set is attached at registration time and Bun still serves the file
 * natively.
 *
 * @param options - Resolved secure-header options, usually `app.secureHeaders`.
 * @returns Header name → value. Never includes HSTS unless `secure` is set.
 */
export function securityHeaders(options: SecureHeadersOptions): Record<string, string> {
  const secure: Record<string, string> = {
    // Always-on security headers
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": options.referrerPolicy ?? "strict-origin-when-cross-origin",
  };

  const frameOptions = options.frameOptions ?? "SAMEORIGIN";
  if (frameOptions) secure["X-Frame-Options"] = frameOptions;

  const permissionsPolicy = options.permissionsPolicy ?? DEFAULT_PERMISSIONS_POLICY;
  if (permissionsPolicy) secure["Permissions-Policy"] = permissionsPolicy;

  if (options.contentSecurityPolicy) {
    secure["Content-Security-Policy"] = options.contentSecurityPolicy;
  }

  // HSTS only over HTTPS — emitting it on HTTP can lock users out
  if (options.secure) {
    const maxAge = options.hstsMaxAge ?? 31_536_000;
    if (maxAge > 0) {
      const parts = [`max-age=${maxAge}`];
      if (options.hstsIncludeSubDomains !== false) parts.push("includeSubDomains");
      if (options.hstsPreload) parts.push("preload");
      secure["Strict-Transport-Security"] = parts.join("; ");
    }
  }

  return secure;
}

/**
 * The security headers a static file should carry, read from `app.secureHeaders`.
 *
 * A separate entry point from {@link securityHeaders} so the caller does not
 * have to reach for the config facade itself, and so the fallback is stated in
 * one place: an app with no `app.secureHeaders` block still gets the baseline,
 * which is the whole point of the defaults.
 */
export function staticSecurityHeaders(): Record<string, string> {
  return securityHeaders(config.safe("app.secureHeaders", {} as SecureHeadersOptions));
}
