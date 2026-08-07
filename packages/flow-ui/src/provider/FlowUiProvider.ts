import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";

/**
 * Registers the flow-ui console commands (`flow:list`, `flow:add`, `flow:init`).
 *
 * flow-ui is a component library, not a runtime service — this provider exists
 * only to expose its scaffolding CLI. Add it to your app's providers list:
 *
 *   import { FlowUiProvider } from "@zerotal/flow-ui";
 *   // …
 *   const providers = [ …, FlowUiProvider ];
 */
export class FlowUiProvider extends ServiceProvider {
  // Console for the CLI; web/test so it doesn't break those boots (commands just
  // won't register when the `commands` binding is absent).
  static override environments: AppEnvironment[] = ["console", "web", "test", "repl"];

  override async onBooted(): Promise<void> {
    const runner = this.app.container.tryMake("commands");
    if (!runner) return;

    runner.registerLazy("flow:list", () =>
      import("../commands/FlowListCommand.ts").then((m) => m.FlowListCommand),
    );
    runner.registerLazy("flow:add", () =>
      import("../commands/FlowAddCommand.ts").then((m) => m.FlowAddCommand),
    );
    runner.registerLazy("flow:init", () =>
      import("../commands/FlowInitCommand.ts").then((m) => m.FlowInitCommand),
    );
  }
}
