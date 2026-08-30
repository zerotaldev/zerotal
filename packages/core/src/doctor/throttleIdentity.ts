/**
 * Can the rate limiter tell two people apart?
 *
 * `ThrottleMiddleware` keys its buckets on the client IP, and resolves that IP
 * from the socket address unless `trustedProxies` says how many proxies sit in
 * front of the app. That default is right: `X-Forwarded-For` is written by the
 * client, and trusting it without being told how deep the real value sits is how a
 * limiter is bypassed with one header.
 *
 * But behind a reverse proxy the socket address is `127.0.0.1` — for every request
 * ever made. Every visitor shares one bucket per form, and the middleware inverts
 * into the thing it was installed to prevent: one attacker making twenty bad
 * sign-ins a minute locks the entire staff out of the console, and five
 * registrations in five minutes stops anybody in the world from creating an
 * account. A limiter that cannot tell two people apart is a denial-of-service tool
 * aimed at its own users.
 *
 * Nothing observable says this is happening. The proxy goes in, everything works,
 * and the limiter quietly stops distinguishing people. The docblock on the option
 * explains it, but the option is read while writing middleware and the mistake is
 * made while writing a Caddyfile — so the two never meet. That gap is what this
 * check closes.
 *
 * @module
 */
import type { Application } from "../application/Application.ts";
import { ThrottleMiddleware, _isIpDerived } from "../middleware/ThrottleMiddleware.ts";
import { Router } from "../router/Router.ts";

/** A registered throttle and how it decides who is who. */
export interface ThrottleIdentity {
  /** The middleware class name, as it appears in a pipeline listing. */
  name: string;
  /** Where it is registered — `global`, or the route it guards. */
  where: string;
  /** Whether it resolves identity from a client-supplied header chain. */
  trustsProxies: boolean;
  /** Whether the app replaced IP-keying with its own resolver. */
  customKey: boolean;
}

/** Whether a middleware class is `ThrottleMiddleware` or one of its `.with()` subclasses. */
function isThrottle(cls: unknown): boolean {
  if (typeof cls !== "function") return false;
  if (cls === ThrottleMiddleware) return true;
  return Object.prototype.isPrototypeOf.call(ThrottleMiddleware, cls);
}

/**
 * Read a throttle's configured identity strategy.
 *
 * `.with()` applies its options in the constructor, so the only way to see them is
 * to build one. That is safe here — the constructor merges `app.throttle` config
 * over the defaults and does nothing else — and it is also the only way to observe
 * the config layer, which can set `trustedProxies` for every throttle at once.
 */
function readIdentity(cls: unknown, where: string): ThrottleIdentity | null {
  try {
    const instance = new (cls as new () => unknown)() as {
      options?: { trustedProxies?: number; keyResolver?: unknown };
    };
    const options = instance.options ?? {};
    return {
      name: (cls as { name?: string }).name || "ThrottleMiddleware",
      where,
      trustsProxies: typeof options.trustedProxies === "number" && options.trustedProxies > 0,
      // A resolver that keys on the client address is not an exemption — it is
      // exactly the case this check exists for. `RateLimiter`'s `.byIp()`,
      // `.byUser()` and `.byApiKey()` all mark themselves, so the named-limiter API
      // stops slipping past the audit that covers the middleware it builds on.
      customKey: typeof options.keyResolver === "function" && !_isIpDerived(options.keyResolver),
    };
  } catch {
    // A middleware that will not construct is a different problem, and not one
    // the doctor should report as a rate-limiting finding.
    return null;
  }
}

/**
 * Every throttle registered in this app, global and per-route.
 *
 * @param app - The booted application.
 */
export function registeredThrottles(app: Application): ThrottleIdentity[] {
  const found: ThrottleIdentity[] = [];

  for (const cls of app.globalMiddleware ?? []) {
    if (!isThrottle(cls)) continue;
    const identity = readIdentity(cls, "global");
    if (identity) found.push(identity);
  }

  try {
    for (const route of Router.routes.values()) {
      for (const cls of route.middleware ?? []) {
        if (!isThrottle(cls)) continue;
        const identity = readIdentity(cls, `${route.method} ${route.path}`);
        if (identity) found.push(identity);
      }
    }
  } catch {
    // No compiled router — a console-only app, or a test harness. Global
    // middleware alone is still worth reporting on.
  }

  return found;
}

/**
 * The throttles that will key every visitor to the same bucket behind a proxy.
 *
 * A custom `keyResolver` is excluded: an app that keys on a user id or an API key
 * has already decided identity for itself, and this check has nothing to add.
 */
export function throttlesKeyedOnSocket(app: Application): ThrottleIdentity[] {
  return registeredThrottles(app).filter((t) => !t.trustsProxies && !t.customKey);
}
