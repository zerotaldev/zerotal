import { deepMerge } from "@zerotal/core";
import type { ConfigValidator, ConfigIssue } from "@zerotal/core/config";

/**
 * Shape of the `config/session.ts` object, consumed by {@link SessionProvider}
 * to construct the driver and by `config('session.*')` dot-path lookups.
 */
export interface SessionConfigShape {
  /** Session storage driver. Default: 'cookie' */
  driver: "cookie" | "redis";
  /** Session lifetime in seconds. Default: 86400 (24 hours) */
  lifetime: number;
  /** Cookie name for the session. Default: 'session' */
  cookie: string;
  /** Whether the session cookie is HTTP-only. Default: true */
  httpOnly: boolean;
  /** SameSite policy. Default: 'Lax' */
  sameSite: "Strict" | "Lax" | "None";
  /** Whether the cookie requires HTTPS. Default: false */
  secure: boolean;
  /** Secret key used to sign/encrypt the session cookie. Default: '' */
  secret: string;
}

const defaults: SessionConfigShape = {
  driver: "cookie",
  lifetime: 86400,
  cookie: "session",
  httpOnly: true,
  sameSite: "Lax",
  secure: false,
  secret: "",
};

/**
 * Create a typed session configuration object, deep-merging `options` over the
 * package defaults. Use it as the default export of `config/session.ts`.
 *
 * @param options - Partial overrides; any omitted field keeps its default.
 * @returns A fully populated {@link SessionConfigShape}.
 *
 * @example
 * ```ts
 * import { SessionConfig } from '@zerotal/session';
 * export default SessionConfig({ lifetime: 3600, cookie: 'app_session' });
 * ```
 */
export function SessionConfig(options: Partial<SessionConfigShape> = {}): SessionConfigShape {
  return deepMerge(defaults, options);
}

/**
 * Placeholder secret {@link SessionProvider} falls back to when `session.secret`
 * is unset — mechanically valid, but a hard "must change before production".
 */
const PLACEHOLDER_SECRET = "changeme";

/**
 * Validate the `session` config namespace at boot. In a production-like
 * deployment it refuses boot on a placeholder/empty signing secret or a cookie
 * that isn't `secure`; in development it warns. Registered by
 * {@link SessionProvider} via `app.registerConfigValidator("session", …)`.
 *
 * The values checked mirror {@link SessionProvider}'s effective defaults, so an
 * app with no `config/session.ts` is validated as if it had the defaults.
 */
export const validateSessionConfig: ConfigValidator = (value, { isProduction }) => {
  if (!isProduction) return [];

  const cfg = value as Partial<SessionConfigShape> | undefined;
  const issues: ConfigIssue[] = [];
  const secret = cfg?.secret || PLACEHOLDER_SECRET;
  if (secret === PLACEHOLDER_SECRET) {
    issues.push({
      level: "error",
      message:
        'session.secret is unset or the placeholder "changeme". Set a strong, ' +
        "unique secret in config/session.ts (or SESSION_SECRET) before deploying.",
    });
  }
  if (cfg?.secure !== true) {
    issues.push({
      level: "error",
      message:
        "session.secure is not true. Set session.secure: true so the session cookie " +
        "is only ever sent over HTTPS in production.",
    });
  }
  return issues;
};

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    session: SessionConfigShape;
  }
}
