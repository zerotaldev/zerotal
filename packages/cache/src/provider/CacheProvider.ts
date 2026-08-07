import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import type { LockManager } from "@zerotal/core/lock";
import { CacheManager } from "../CacheManager.ts";
import { MemoryDriver } from "../drivers/MemoryDriver.ts";
import { SqliteDriver } from "../drivers/SqliteDriver.ts";
import { RedisDriver } from "../drivers/RedisDriver.ts";
import { installCacheObservability } from "../observability.ts";
import { SQL } from "bun";

// Extend the core container registry
declare module "@zerotal/core" {
  interface ContainerBindings {
    cache: CacheManager;
  }
}

export class CacheProvider extends ServiceProvider {
  static override provides = ["cache"] as const;
  static override environments: AppEnvironment[] = ["web", "console", "test", "repl"];

  private _disposeObservability: (() => void) | undefined = undefined;

  override onRegister(): void {
    this.app.container.singleton("cache", () => {
      const config = this.app.container.makeSync("config") as ConfigManager;

      const driver = config.get<string>("cache.driver", "sqlite");
      const prefix = config.get<string>("cache.prefix", "zerotal:");
      const ttl = config.get<number>("cache.ttl", 3600);
      const sqlitePath = config.get<string>("cache.sqlite.path", ":memory:");
      const stampede = config.get<boolean>("cache.stampedeProtection", true);

      // Cross-process stampede protection uses the lock primitive when LockProvider
      // is registered; otherwise remember() degrades to in-process coalescing.
      const lock = (this.app.container.tryMake("lock") as LockManager | null) ?? null;

      switch (driver) {
        case "redis":
          return new CacheManager(new RedisDriver(prefix), "", ttl, lock, stampede);

        case "memory":
          return new CacheManager(new MemoryDriver(), prefix, ttl, lock, stampede);

        case "sqlite":
        default: {
          const sqlInstance = new SQL(_toSqliteUrl(sqlitePath));
          return new CacheManager(new SqliteDriver(sqlInstance), prefix, ttl, lock, stampede);
        }
      }
    });
  }

  override async onBooted(): Promise<void> {
    // Pre-resolve so the Cache facade (makeSync) works after boot.
    await this.app.container.make("cache");

    this._disposeObservability = installCacheObservability(this.app);

    const runner = this.app.container.tryMake("commands");
    if (!runner) return;

    runner.registerLazy("cache:clear", () =>
      import("../commands/CacheClearCommand.ts").then((m) => m.CacheClearCommand),
    );
  }

  override async onStopping(): Promise<void> {
    this._disposeObservability?.();
    this._disposeObservability = undefined;
  }
}

// Bun v1.3.x on Windows only opens SQLite when the URL starts with 'sqlite:'
// or is ':memory:'. Bare file paths are treated as PostgreSQL URLs.
function _toSqliteUrl(path: string): string {
  if (!path || path === ":memory:") return path;
  if (path.startsWith("sqlite:")) return path;
  if (path.startsWith("sqlite://")) return path.replace("sqlite://", "sqlite:");
  if (path.startsWith("file:")) return "sqlite:" + path.slice("file:".length);
  return "sqlite:" + path;
}
