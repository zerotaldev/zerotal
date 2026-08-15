import { RedisClient } from "bun";
import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { CookieDriver } from "../drivers/CookieDriver.ts";
import type { SessionDriver } from "../drivers/CookieDriver.ts";
import { RedisDriver } from "../drivers/RedisDriver.ts";
import { SessionAccessor } from "../SessionAccessor.ts";
import { SessionMiddleware } from "../SessionMiddleware.ts";
import { validateSessionConfig } from "../config.ts";

declare module "@zerotal/core" {
  interface ContainerBindings {
    "session.driver": SessionDriver;
    session: SessionAccessor;
  }
}

/**
 * Service provider that wires up sessions: it registers the `session.driver`
 * and `session` (the {@link SessionAccessor} facade) container singletons,
 * auto-registers {@link SessionMiddleware} on boot, and warns when running in
 * production without `session.secure`.
 *
 * @remarks
 * The `session.driver` binding builds a {@link CookieDriver} (default) or
 * {@link RedisDriver} from the `session` config namespace. Config keys read:
 * - `session.driver`   — `'cookie'` (default) | `'redis'`
 * - `session.secret`   — signing/encryption secret (default: `'changeme'`)
 * - `session.cookie`   — cookie name (default: `'session'`)
 * - `session.lifetime` — session lifetime in seconds (default: `86400`)
 * - `session.secure`   — require HTTPS for the cookie (default: `false`)
 * - `session.redis`    — Redis URL, redis driver only (default:
 *   `'redis://localhost:6379'`)
 *
 * Registered only in the `web` and `test` environments.
 */
export class SessionProvider extends ServiceProvider {
  static override provides = ["session.driver", "session"] as const;
  static override environments: AppEnvironment[] = ["web", "test"];

  /**
   * @internal Bind `session.driver` (cookie or redis, from config) and the
   * `session` accessor singleton into the container.
   */
  override onRegister(): void {
    this.app.container.singleton("session.driver", () => {
      const config = this.app.container.makeSync("config") as ConfigManager;
      const driver = config.get<string>("session.driver", "cookie");
      const secret = config.get<string>("session.secret", "changeme");
      const cookieName = config.get<string>("session.cookie", "session");
      const ttl = config.get<number>("session.lifetime", 86_400);
      const secure = config.get<boolean>("session.secure", false);

      if (driver === "redis") {
        const url = config.get<string>("session.redis", "redis://localhost:6379");
        const redis = new RedisClient(url);
        return new RedisDriver(redis, cookieName, ttl, secret || undefined);
      }
      return new CookieDriver(secret, cookieName, ttl, secure);
    });

    this.app.container.singleton("session", () => new SessionAccessor());

    // Refuse a production boot on a placeholder secret or a non-secure cookie
    // (warns in development). Runs before onBooting via the boot-time config pass.
    this.app.registerConfigValidator("session", validateSessionConfig);
  }

  /**
   * @internal Auto-register {@link SessionMiddleware} (via `useOnce`, so an
   * explicit `app.use([SessionMiddleware])` does not double-register it).
   *
   * Insecure-config enforcement lives in {@link validateSessionConfig} (registered
   * in {@link onRegister}), which the boot-time config pass runs before booting.
   */
  override async onBooting(): Promise<void> {
    // Auto-register SessionMiddleware so the session is available on every request.
    // useOnce() prevents double-registration if the user also calls .use([SessionMiddleware]).
    this.app.useOnce(SessionMiddleware);
  }

  /**
   * @internal Pre-resolve both singletons so the synchronous `Session` facade
   * (`makeSync`) works after boot.
   */
  override async onBooted(): Promise<void> {
    // Pre-resolve both singletons so makeSync works via the Session facade.
    await this.app.container.make("session.driver");
    await this.app.container.make("session");
  }
}
