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
/** The form field a page's own form sends the token back in. */
const CSRF_FIELD = "_token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The hidden field {@link CsrfMiddleware.field} renders. Flow renders it as the markup it is; in
 * a template string it is that markup too.
 */
export interface CsrfField {
  /** `<input type="hidden" name="_token" value="…">`, or empty when there is no token. */
  readonly html: string;
  toString(): string;
}

export interface CsrfOptions {
  /**
   * Set the `Secure` flag on the XSRF-TOKEN cookie.
   * Enable in production when serving over HTTPS.
   */
  secure?: boolean | undefined;
}

/**
 * CSRF protection middleware.
 *
 * Generates a random token on first request and stores it in the session.
 * On mutating requests (POST, PUT, PATCH, DELETE), validates that the client
 * sent the token back: in the `x-csrf-token` or `x-xsrf-token` header, or in a
 * `_token` field of a form body (urlencoded or multipart), which is how a plain
 * HTML form sends it. {@link CsrfMiddleware.field} renders that field.
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
 * so that a client script can read it and attach it as the `X-XSRF-TOKEN`
 * header on subsequent mutating requests, as common HTTP clients do on their own.
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
      const sentToken =
        http.request.headers.get("x-csrf-token") ??
        http.request.headers.get("x-xsrf-token") ??
        (sessionToken ? await _formToken(http.request) : undefined);

      if (!sessionToken || !sentToken || !_tokensMatch(sessionToken, sentToken)) {
        return new Response(JSON.stringify({ message: "CSRF token mismatch." }), {
          status: 419,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const response = await next();

    // Set the XSRF-TOKEN cookie, for a client script to send back as a header.
    // This cookie intentionally omits the HttpOnly flag — JavaScript must read it.
    const token = session?.get(CSRF_TOKEN_KEY) as string | undefined;
    if (token && response) {
      // Non-HttpOnly on purpose — a client script reads this cookie to echo the token.
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

  /**
   * The hidden `_token` field a form posts the token back in. Put it in every form that posts:
   *
   * ```tsx
   * <form method="post" action="/login">
   *   {CsrfMiddleware.field()}
   *   …
   * </form>
   * ```
   *
   * A Flow page renders it as markup, and a compiled page compiles it. Outside a request, or
   * with no session, it renders nothing.
   *
   * @param ctx - HTTP context to read the token from; defaults to the active request context.
   */
  static field(ctx: HttpContext | undefined = RequestContext.tryGet()): CsrfField {
    const token = ctx ? CsrfMiddleware.token(ctx) : undefined;
    const html = token
      ? `<input type="hidden" name="${CSRF_FIELD}" value="${_escapeAttr(token)}">`
      : "";
    return { html, toString: () => html };
  }
}

/**
 * @internal The `_token` field of a form body, read from a copy of the request so the handler
 * still reads the body itself, in whichever way it reads it. Undefined for a body that is not a
 * form, or a form without one.
 */
async function _formToken(request: Request): Promise<string | undefined> {
  const type = request.headers.get("content-type") ?? "";
  if (
    !type.includes("application/x-www-form-urlencoded") &&
    !type.includes("multipart/form-data")
  ) {
    return undefined;
  }
  try {
    const value = (await request.clone().formData()).get(CSRF_FIELD);
    return typeof value === "string" && value ? value : undefined;
  } catch {
    return undefined;
  }
}

/** @internal A value for a double-quoted attribute. */
function _escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * @internal Constant-time token comparison to prevent timing attacks —
 * delegates to the shared `safeEqual` helper (its length pre-check is safe:
 * token length is public).
 */
function _tokensMatch(a: string, b: string): boolean {
  return safeEqual(a, b);
}
