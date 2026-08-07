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

    const secure: Record<string, string> = {
      // Always-on security headers
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": this.options.referrerPolicy ?? "strict-origin-when-cross-origin",
    };

    const frameOptions = this.options.frameOptions ?? "SAMEORIGIN";
    if (frameOptions) secure["X-Frame-Options"] = frameOptions;

    const permissionsPolicy = this.options.permissionsPolicy ?? DEFAULT_PERMISSIONS_POLICY;
    if (permissionsPolicy) secure["Permissions-Policy"] = permissionsPolicy;

    if (this.options.contentSecurityPolicy) {
      secure["Content-Security-Policy"] = this.options.contentSecurityPolicy;
    }

    // HSTS only over HTTPS — emitting it on HTTP can lock users out
    if (this.options.secure) {
      const maxAge = this.options.hstsMaxAge ?? 31_536_000;
      if (maxAge > 0) {
        const parts = [`max-age=${maxAge}`];
        if (this.options.hstsIncludeSubDomains !== false) parts.push("includeSubDomains");
        if (this.options.hstsPreload) parts.push("preload");
        secure["Strict-Transport-Security"] = parts.join("; ");
      }
    }

    return withHeaders(response, secure);
  }
}
