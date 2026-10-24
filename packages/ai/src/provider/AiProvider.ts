import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { AiManager } from "../AiManager.ts";
import { AiConfigFromEnv } from "../config.ts";
import type { AiConfigShape } from "../types.ts";
import { installAiObservability } from "../observability.ts";
import { installAiMonitor } from "../monitor.ts";
import { modelStats, recentGenerations } from "../stats.ts";
import { spentToday, useSharedSpend, type SharedSpendStore } from "../spend.ts";

declare module "@zerotal/core" {
  interface ContainerBindings {
    ai: AiManager;
  }
}

/**
 * Whether a cache with this configuration is one other processes can see.
 *
 * The in-memory driver, and SQLite on `:memory:` (the default), belong to the process that made
 * them: counting a daily ceiling there would change nothing. SQLite on a file and Redis are the
 * same store for the web server, the worker and the next deploy.
 *
 * @internal Backs `AiProvider` and this package's own tests.
 */
export function _cacheIsShared(driver: string, sqlitePath: string): boolean {
  if (driver === "memory") return false;
  if (driver === "sqlite") return sqlitePath !== "" && !sqlitePath.includes(":memory:");
  return true;
}

export class AiProvider extends ServiceProvider {
  static override provides = ["ai"] as const;
  static override environments: AppEnvironment[] = ["web", "console", "worker", "test"];

  private _disposeObservability: (() => void) | undefined = undefined;

  override onRegister(): void {
    this.app.container.singleton("ai", () => {
      const config = this.app.container.makeSync("config") as ConfigManager;
      // No eager default: `AiConfig()` validates, and an app *with* a config
      // file must not pay for — or fail on — a fallback it never uses.
      const declared = config.get<AiConfigShape | undefined>("ai");
      return new AiManager(declared ?? AiConfigFromEnv());
    });
  }

  override async onBooted(): Promise<void> {
    const ai = (await this.app.container.make("ai")) as AiManager;

    this._disposeObservability = installAiObservability(this.app);
    installAiMonitor(this.app, ai.config);
    this._shareSpend(ai);

    const runner = this.app.container.tryMake("commands");
    if (runner) {
      runner.registerLazy("ai:test", () =>
        import("../commands/AiTestCommand.ts").then((m) => m.AiTestCommand),
      );
      runner.registerLazy("ai:spend", () =>
        import("../commands/AiSpendCommand.ts").then((m) => m.AiSpendCommand),
      );
    }
  }

  /**
   * Count the daily spend in the cache of the app, when it is one other processes can see.
   *
   * A shared cache is what makes a daily ceiling mean the same thing in the web server, the
   * worker and the next deploy; see {@link _cacheIsShared}.
   */
  private _shareSpend(ai: AiManager): void {
    if (ai.config.limits.shared === false) return;

    const config = this.app.container.makeSync("config") as ConfigManager;
    const driver = config.get<string>("cache.driver", "sqlite");
    const sqlitePath = config.get<string>("cache.sqlite.path", ":memory:");
    if (!_cacheIsShared(driver, sqlitePath)) return;

    const cache = this.app.container.tryMake("cache" as never) as SharedSpendStore | undefined;
    if (cache) useSharedSpend(cache);
  }

  override async onStopping(): Promise<void> {
    this._disposeObservability?.();
    this._disposeObservability = undefined;
    useSharedSpend(undefined);
  }

  /** What `zt repl` puts on the global scope. */
  override replContext(): Record<string, unknown> {
    return {
      Ai: this.app.container.makeSync("ai"),
      aiSpentToday: spentToday,
      aiModelStats: modelStats,
      aiRecentGenerations: recentGenerations,
    };
  }
}
