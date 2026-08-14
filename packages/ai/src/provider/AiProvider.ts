import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { AiManager } from "../AiManager.ts";
import { AiConfigFromEnv } from "../config.ts";
import type { AiConfigShape } from "../types.ts";
import { installAiObservability } from "../observability.ts";
import { installAiMonitor } from "../monitor.ts";
import { modelStats, recentGenerations } from "../stats.ts";
import { spentToday } from "../spend.ts";

declare module "@zerotal/core" {
  interface ContainerBindings {
    ai: AiManager;
  }
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

  override async onStopping(): Promise<void> {
    this._disposeObservability?.();
    this._disposeObservability = undefined;
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
