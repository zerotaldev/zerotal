import type { NextFn } from "@zerotal/core";
import {
  HttpContext,
  BaseMiddleware,
  deepMerge,
  RequestContext,
  safeEqual,
  buildCookie,
} from "@zerotal/core";
import type { SessionManager } from "./SessionManager.ts";

const CSRF_TOKEN_KEY = "_csrf_token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface CsrfOptions {
  /**
   * Set the `Secure` flag on the XSRF-TOKEN cookie.
   * Enable in production when serving over HTTPS.
   */
  secure?: boolean;
}

/**
 * CSRF protection middleware.
 *
 * Generates a random token on first request and stores it in the session.
 * On mutating requests (POST, PUT, PATCH, DELETE), validates that the client
 * sent the token back via the `x-csrf-token` or `x-xsrf-token` header.
 *
 * Token comparison uses a constant-time algorithm to prevent timing attacks.
 *
 * Design note — why not native `Bun.CSRF`? `Bun.CSRF` issues *stateless* HMAC
 * tokens, whereas this middleware deliberately uses a *session-bound
 * double-submit* token: the token lives in the user's session and is mirrored
 * into a readable `XSRF-TOKEN` cookie. The session binding is intentional — it
 * ties each token to a specific authenticated session and integrates with the
 * SPA/Inertia auto-header flow below — so we keep the session-bound scheme
 * rather than switching to stateless tokens.
 *
 * After every request it automatically sets a non-HttpOnly `XSRF-TOKEN` cookie
 * so that Axios (and therefore Inertia) can read it and attach it as the
 * `X-XSRF-TOKEN` header on subsequent mutating requests — zero manual config.
 *
 * Register it after {@link SessionMiddleware} (it reads/writes the session).
 * On a failed check the pipeline short-circuits with an HTTP `419` JSON
 * response and `next()` is never called.
 *
 * @example
 * ```ts
 * // Usage order — after SessionMiddleware:
 * app.use(CsrfMiddleware);                        // HTTP (dev)
 * app.use(CsrfMiddleware.with({ secure: true })); // HTTPS (production)
 *
 * // Expose the token server-side (e.g. in Inertia shared props):
 * Inertia.share({ csrf_token: () => CsrfMiddleware.token() });
 * ```
 */
export class CsrfMiddleware extends BaseMiddleware<CsrfOptions> {
  protected options: CsrfOptions = { secure: false };

  constructor(options: CsrfOptions = {}) {
    super();
    this.options = deepMerge(this.options, options);
  }

  /**
   * @internal Middleware entry point. Ensures a token exists in the session,
   * validates the header token on unsafe methods (returning a `419` response on
   * mismatch), then mirrors the token into a readable `XSRF-TOKEN` cookie on the
   * outgoing response.
   */
  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const session = http.session as SessionManager | undefined;

    // Ensure a CSRF token exists in the session for this request.
    if (!session?.has(CSRF_TOKEN_KEY)) {
      session?.set(CSRF_TOKEN_KEY, crypto.randomUUID());
    }

    const method = http.request.method.toUpperCase();

    // Safe methods (GET, HEAD, OPTIONS) skip the token check.
    if (!SAFE_METHODS.has(method)) {
      const sessionToken = session?.get(CSRF_TOKEN_KEY) as string | undefined;
      const headerToken =
        http.request.headers.get("x-csrf-token") ?? http.request.headers.get("x-xsrf-token");

      if (!sessionToken || !headerToken || !_tokensMatch(sessionToken, headerToken)) {
        return new Response(JSON.stringify({ message: "CSRF token mismatch." }), {
          status: 419,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const response = await next();

    // Set the XSRF-TOKEN cookie so Axios / Inertia picks it up automatically.
    // This cookie intentionally omits the HttpOnly flag — JavaScript must read it.
    const token = session?.get(CSRF_TOKEN_KEY) as string | undefined;
    if (token && response) {
      // Non-HttpOnly on purpose — Axios/Inertia read this cookie to echo the token.
      response.headers.append(
        "Set-Cookie",
        buildCookie({
          name: "XSRF-TOKEN",
          value: token,
          httpOnly: false,
          secure: this.options.secure ?? false,
        }),
      );
    }

    return response;
  }

  /**
   * Return the CSRF token stored in the current request's session.
   *
   * Use this to embed the token in Inertia shared props or HTML meta tags.
   * Defaults to the active request context, so it works inside a no-arg
   * shared-prop factory.
   *
   * @param ctx - HTTP context to read the token from; defaults to the active
   * request context via {@link RequestContext.get}.
   * @returns The token string, or `undefined` if none is set (or no session).
   */
  static token(ctx: HttpContext = RequestContext.get()): string | undefined {
    return (ctx.session as SessionManager | undefined)?.get(CSRF_TOKEN_KEY) as string | undefined;
  }
}

/**
 * @internal Constant-time token comparison to prevent timing attacks —
 * delegates to the shared `safeEqual` helper (its length pre-check is safe:
 * token length is public).
 */
function _tokensMatch(a: string, b: string): boolean {
  return safeEqual(a, b);
}
