import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";
import type { LockManager } from "@zerotal/core/lock";
import { SchedulerManager } from "../SchedulerManager.ts";
import { ScheduledTask } from "../ScheduledTask.ts";
import { schedulesConcern } from "../conventions.ts";
import { installSchedulerObservability } from "../observability.ts";
import { installSchedulerMonitor } from "../monitor.ts";

declare module "@zerotal/core" {
  interface ContainerBindings {
    scheduler: SchedulerManager;
  }
}

export class SchedulerProvider extends ServiceProvider {
  static override provides = ["scheduler"] as const;
  static override environments: AppEnvironment[] = ["web", "console", "worker"];

  private _disposeObservability: (() => void) | undefined = undefined;

  override onRegister(): void {
    // Convention-based auto-discovery of app/schedules. (Optional-chained so bare-container
    // unit tests with a minimal app stub don't need to stub registerConcern.)
    this.app.registerConcern?.(schedulesConcern);

    this.app.container.singleton("scheduler", () => new SchedulerManager());
  }

  override async onBooting(): Promise<void> {
    await this.app.container.make("scheduler");

    // Offer the scheduled-tasks section to the monitor panel, if one is
    // installed. The panel reads its section registry when it renders, so
    // contributing during the booting phase is early enough.
    installSchedulerMonitor(this.app);
  }

  override async onBooted(): Promise<void> {
    this._disposeObservability = installSchedulerObservability(this.app);

    // Wire the distributed lock for cross-process withoutOverlapping. Falls back to
    // the in-process guard when no LockProvider is registered.
    ScheduledTask.lockManager = (this.app.container.tryMake("lock") as LockManager | null) ?? null;

    const runner = this.app.container.tryMake("commands");
    if (!runner) return;
    runner.registerLazy("schedule:list", () =>
      import("../commands/ScheduleListCommand.ts").then((m) => m.ScheduleListCommand),
    );
  }

  override async onStarted(): Promise<void> {
    const scheduler = this.app.container.makeSync("scheduler") as SchedulerManager;
    scheduler.start();
  }

  override async onStopped(): Promise<void> {
    this._disposeObservability?.();
    this._disposeObservability = undefined;

    const scheduler = this.app.container.tryMake("scheduler") as SchedulerManager | undefined;
    scheduler?.stop();
  }
}
