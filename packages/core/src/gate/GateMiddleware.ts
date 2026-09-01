/**
 * The gate itself: what happens to a request while the site is closed.
 *
 * Runs in the kernel layer, before routing, before the session is resolved and
 * before anything touches the database — because in maintenance mode the
 * database may be the thing that is unavailable, and a gate that needs it cannot
 * report that it is down.
 *
 * @module
 */
import type { NextFn } from "../pipeline/types.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";
import { BaseMiddleware } from "../middleware/BaseMiddleware.ts";
import { config } from "../helpers/config.ts";
import { hmacHex, safeEqual } from "../support/crypto.ts";
import { deployEnv, isProdLike } from "../support/env.ts";
import { gateExpired, hashToken, readGate, type GateState } from "./state.ts";

/** The cookie the gate issues once a token has been accepted. */
export const GATE_COOKIE = "zerotal_preview";

/** The query parameter that carries a preview token. */
export const GATE_QUERY = "preview";

/**
 * Paths that stay reachable while the gate is up, whatever mode it is in.
 *
 * Every entry is something a naive gate breaks:
 *
 * - **The health endpoint**, or the uptime monitor pages the on-call about a
 *   planned window, and a deploy gate that polls health fails its own release.
 * - **Static assets**, or the maintenance page 503s its own stylesheet and the
 *   apology arrives unstyled.
 *
 * Webhooks are deliberately *not* here — see `gate.allow` in config, and the
 * warning next to it.
 */
const ALWAYS_ALLOWED = ["/__zerotal/", "/css/", "/js/", "/assets/", "/favicon.ico"];

/** Shape read from `config/gate.ts`, all optional. */
interface GateConfig {
  /**
   * Extra path prefixes that stay reachable while the gate is up.
   *
   * **Put your webhook paths here.** This is the item on the list that costs
   * money: a payment provider posting a settlement into a maintenance window
   * gets a 503, and depending on the provider that is a retry, a dropped
   * callback, or a payment your books never learn about. Nothing can infer which
   * of your routes a third party calls, so it has to be declared.
   */
  allow?: string[];
  /**
   * Roles admitted to a preview without a token.
   *
   * An **allowlist**, defaulting to `["admin"]`. An app whose staff role is named
   * something else declares it here:
   *
   * ```ts
   * // config/gate.ts
   * export default { staffRoles: ["admin", "editor"] };
   * ```
   *
   * It is a list rather than a rule because the framework cannot know an app's
   * role names, and the shape it replaced — "anyone who is not a customer" —
   * admitted every signed-in user in an app that has no role called `customer`.
   */
  staffRoles?: string[];
  /**
   * What the public gets during a **preview** — not maintenance, which is always
   * 503.
   *
   * `"holding"` (default) serves the holding view at `200`, which is right for a
   * pre-launch site collecting an email address. `"notFound"` serves `404`, which
   * is right when the site's existence is itself not public. Both are legitimate
   * and the framework does not pick.
   */
  publicResponse?: "holding" | "notFound";
}

/**
 * Middleware that answers for a closed site.
 *
 * @category Middleware
 */
/**
 * The gate's decision for one request, or `null` to let it through.
 *
 * A plain function over `Request` rather than a method on the middleware,
 * because the middleware is not the only place this has to run.
 * {@link Router.raw} handlers bypass the pipeline by design, and a gate that
 * covers the pipeline alone is the worst kind: it gates the homepage, so it
 * looks like it works, while every raw route stays public. This framework's own
 * documentation site serves all of `/docs/*` from raw routes, which is how that
 * was found — the front page said "coming soon" and every page of content was
 * open.
 *
 * @param request - The incoming request.
 * @param staff - Whether the caller has already established this is a staff
 *   user. Raw routes have no session resolved, so they pass `false`.
 * @returns The response to send, or `null` when the request may proceed.
 * @internal
 */
export function _gateResponse(request: Request, staff: boolean): Response | null {
  const state = readGate();
  if (!state) return null;

  // A preview whose `until` has passed lifts itself. The alternative is a gate
  // that outlives its purpose because the person who set it moved on, which is
  // the ordinary way pre-launch gates end.
  if (state.mode === "preview" && gateExpired(state)) return null;

  const url = new URL(request.url);
  if (_allowed(url.pathname)) return null;

  if (state.mode === "maintenance") return _maintenance(state);

  const offered = url.searchParams.get(GATE_QUERY);
  if (offered && state.tokenHash && safeEqual(hashToken(offered), state.tokenHash)) {
    // Redirect with the parameter removed, and not for tidiness. A token left in
    // the address bar travels into `Referer` on every outbound link, into
    // analytics, into screenshots, and into the message where somebody shares
    // "the page I was looking at". Strip it on first use and the secret lives
    // only in a cookie.
    url.searchParams.delete(GATE_QUERY);
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${url.pathname}${url.search}${url.hash}`,
        "Set-Cookie": _cookie(state),
        "Cache-Control": "no-store",
      },
    });
  }

  if (_hasValidCookie(request, state)) return null;
  if (staff) return null;

  return config.safe<GateConfig>("gate", {}).publicResponse === "notFound"
    ? new Response(_notFoundHtml(), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      })
    : new Response(_holdingHtml(), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
}

/**
 * Whether this path stays reachable while the gate is up.
 *
 * Read through `config.safe`, not `config`: this has to answer on a request
 * where the application may not be resolvable at all. A gate that throws because
 * the container is unavailable is a gate that cannot report the app is down,
 * which is the one job it has.
 */
function _allowed(pathname: string): boolean {
  const extra = config.safe<GateConfig>("gate", {}).allow ?? [];
  return [...ALWAYS_ALLOWED, ...extra].some((prefix) => pathname.startsWith(prefix));
}

/** Whether the request carries a cookie this gate issued. */
function _hasValidCookie(request: Request, state: GateState): boolean {
  const raw = _readCookie(request.headers.get("cookie"), GATE_COOKIE);
  if (!raw || !state.tokenHash) return false;
  // Signed over the token hash, so rotating the token invalidates every cookie
  // issued under the previous one without tracking who holds what.
  return safeEqual(raw, _signature(state.tokenHash));
}

/**
 * 503 with `Retry-After`, and never anything else.
 *
 * The status is not cosmetic. Sites have lost their search rankings to a
 * two-hour window served at 200, because a crawler that gets 200 believes the
 * apology *is* the page. 503 tells it to come back and keep what it had.
 */
function _maintenance(state: GateState): Response {
  return new Response(_maintenanceHtml(), {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": String(state.retryAfter ?? 60),
      // Nothing about a maintenance response should be cached: the next request
      // after the window is a different answer at the same URL.
      "Cache-Control": "no-store",
    },
  });
}

export class GateMiddleware extends BaseMiddleware<GateConfig> {
  /**
   * Read per-request rather than captured here, because the gate is changed
   * while the process is running — that is the entire point of it — and options
   * frozen at construction would need a restart to take effect.
   */
  protected options: GateConfig = {};

  async handle(ctx: HttpContext, next: NextFn): Promise<Response | void> {
    const answer = _gateResponse(ctx.request, _isStaff(ctx));
    return answer ?? next();
  }
}

/**
 * Whether the request is already an authenticated non-customer.
 *
 * An app that has staff accounts should not need a second secret for the people
 * who already sign in. Read defensively: this runs before the session middleware
 * on a request that may have no session at all, so anything unexpected means
 * "not staff" rather than an exception from the gate.
 */
function _isStaff(ctx: HttpContext): boolean {
  // `in` rather than a cast: `user` is attached by the auth package at runtime
  // and is not on `HttpContext`, so narrowing is the honest way to read it.
  if (!("user" in ctx)) return false;
  const user = ctx.user;
  if (typeof user !== "object" || user === null || !("role" in user)) return false;

  // Widened to `string` deliberately. Comparing against an app's own role union
  // is a type error when the app has no such member — 1.13.3 shipped
  // `role !== "customer"` and broke `tsc` for every app whose roles are, say,
  // `"user" | "admin"`, on a feature they were not using. The framework cannot
  // know an app's role names, so it must not narrow to them.
  const role: string = typeof user.role === "string" ? user.role : "";
  if (!role) return false;

  // An **allowlist**, and this is the load-bearing part. 1.13.3 asked
  // `role !== "customer"`, which reads as "everyone except customers is staff" —
  // so in an app whose roles are `user` and `admin`, every signed-in visitor was
  // staff and the gate let the public straight through. A gate that fails *open*
  // is worse than no gate, because it reports success.
  //
  // Defaulting to `admin` alone rather than to something broad, for the same
  // reason: an app that names its staff role something else gets no bypass and
  // notices, which is the safe direction to be wrong in.
  return config.safe<string[]>("gate.staffRoles", ["admin"]).includes(role);
}

/** HMAC of the token hash under the app key, so the cookie cannot be forged. */
function _signature(tokenHash: string): string {
  const key = String(Bun.env["APP_KEY"] ?? "");
  return hmacHex(`gate:${tokenHash}`, key);
}

/** The `Set-Cookie` value admitting this visitor. */
function _cookie(state: GateState): string {
  const parts = [
    `${GATE_COOKIE}=${_signature(state.tokenHash ?? "")}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    // Days, not months. A preview cookie with no lifetime means an ex-tester
    // keeps access to a site that has since gone live with real customer data.
    `Max-Age=${7 * 24 * 60 * 60}`,
  ];
  // `deployEnv()`, not the raw variable: after `setAppEnv()` the latter holds the
  // runtime mode rather than the deployment name.
  if (isProdLike(deployEnv())) parts.push("Secure");
  return parts.join("; ");
}

/** Read one cookie out of a `Cookie` header. */
function _readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const pair of header.split(";")) {
    const index = pair.indexOf("=");
    if (index === -1) continue;
    if (pair.slice(0, index).trim() === name) return pair.slice(index + 1).trim();
  }
  return undefined;
}

/** Deliberately plain. Nobody wants a framework's opinion about their apology. */
function _maintenanceHtml(): string {
  return _page("Back shortly", "We are carrying out planned maintenance. Please try again soon.");
}

function _holdingHtml(): string {
  return _page("Coming soon", "This site is not open to the public yet.");
}

function _notFoundHtml(): string {
  return _page("Not found", "");
}

function _page(heading: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:32rem;margin:20vh auto;padding:0 1.5rem;color:#111}h1{font-size:1.5rem;margin:0 0 .5rem}p{margin:0;color:#555}</style>
</head><body><h1>${heading}</h1>${body ? `<p>${body}</p>` : ""}</body></html>`;
}
