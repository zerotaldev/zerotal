import { createFacade } from "@zerotal/core";

// `ctx.session` is declared on HttpContext in core, typed against the kernel-owned
// SessionContract (from `@zerotal/core/contracts`), which SessionManager
// implements — so no HttpContext augmentation is needed here.

// ── Session facade ────────────────────────────────────────────────────────────
// Resolved from the container on each access — always reads the in-flight
// request's session via RequestContext inside SessionAccessor.

/**
 * Session facade — reads/writes the current request's session.
 *
 * Requires SessionMiddleware to be registered; throws outside of a request
 * context only if you call methods that require a session to exist.
 */
export const Session = createFacade("session");

// ── Public exports ────────────────────────────────────────────────────────────

export { SessionAccessor } from "./SessionAccessor.ts";
export { SessionManager } from "./SessionManager.ts";
export { SessionMiddleware } from "./SessionMiddleware.ts";
export type { SessionOptions } from "./SessionMiddleware.ts";
export { AuthSessionMiddleware } from "./AuthSessionMiddleware.ts";
export { CsrfMiddleware } from "./CsrfMiddleware.ts";
export type { CsrfOptions } from "./CsrfMiddleware.ts";
export { CookieDriver, SESSION_ISSUED_AT_KEY } from "./drivers/CookieDriver.ts";
export type { SessionDriver, SessionPayload } from "./drivers/CookieDriver.ts";
export { RedisDriver } from "./drivers/RedisDriver.ts";
export { SessionProvider } from "./provider/SessionProvider.ts";

// Config factory
export { SessionConfig } from "./config.ts";
export type { SessionConfigShape } from "./config.ts";

// Typed error vocabulary
export * from "./errors.ts";
