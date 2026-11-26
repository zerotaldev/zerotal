import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment, DevProcessDefinition } from "@zerotal/core";
import type { LockManager } from "@zerotal/core/lock";
import { resolve } from "node:path";
import { SchedulerManager } from "../SchedulerManager.ts";
import { ScheduledTask } from "../ScheduledTask.ts";
import { schedulesConcern } from "../conventions.ts";
import { installSchedulerObservability } from "../observability.ts";
import { installSchedulerMonitor } from "../monitor.ts";
import { FileScheduleRunStore, installScheduleRunLog, resolveRunLogConfig } from "../runLog.ts";
import { workerLivenessCheck } from "@zerotal/core/heartbeat";
import type { DoctorCheck } from "@zerotal/core";

declare module "@zerotal/core" {
  interface ContainerBindings {
    scheduler: SchedulerManager;
  }
}

export class SchedulerProvider extends ServiceProvider {
  static override provides = ["scheduler"] as const;
  static override environments: AppEnvironment[] = ["web", "console", "worker"];

  private _disposeObservability: (() => void) | undefined = undefined;
  private _disposeRunLog: (() => void) | undefined = undefined;

  /**
   * The scheduler that `bun zt dev` runs beside the server, in its own tab.
   *
   * `schedule:work` rather than `worker`: the worker also consumes the queue,
   * which the queue's own tab already does. It restarts with the server on a
   * backend change, so a schedule added or edited under `app/` runs as saved.
   * Leave it out with `--without=scheduler` or `app.dev.disable`.
   */
  override devProcesses(): DevProcessDefinition[] {
    return [
      {
        name: "scheduler",
        command: "schedule:work",
        restart: "on-failure",
        restartOnChange: true,
      },
    ];
  }

  override onRegister(): void {
    // Convention-based auto-discovery of app/schedules. (Optional-chained so bare-container
    // unit tests with a minimal app stub don't need to stub registerConcern.)
    this.app.registerConcern?.(schedulesConcern);

    // `zt doctor`: surface Schedule classes whose config is declared static —
    // convention discovery warns at boot, but a boot log line scrolls away; the
    // doctor holds the finding still.
    this.app.registerDoctorCheck?.({
      id: "schedule-static-config",
      label: "Schedule config",
      run: () => {
        const manager = this.app.container.tryMake("scheduler") as SchedulerManager | undefined;
        const findings = manager?.staticConfigFindings ?? [];
        if (findings.length === 0) return { status: "ok", message: "instance properties" };
        return {
          status: "warn",
          message:
            findings.map((f) => `${f.className} declares static ${f.keys.join(", ")}`).join("; ") +
            " — static schedule config registers nothing.",
          fix: 'Drop the `static` keyword (e.g. `override cron = "0 3 * * *"`).',
        };
      },
    });

    this.app.container.singleton("scheduler", () => new SchedulerManager());

    // Durable run history (see runLog.ts). Registered as its own binding so an app
    // can rebind `scheduler.runs` (e.g. onto Redis) without touching the scheduler.
    // The factory reads config lazily — config is loaded by the time anything makes it.
    this.app.container.singleton("scheduler.runs", () => {
      const config = resolveRunLogConfig(this.app);
      return new FileScheduleRunStore(resolve(process.cwd(), config.path), config.keep);
    });
  }

  override async onBooting(): Promise<void> {
    await this.app.container.make("scheduler");
    // Resolved here so the synchronous lookups that read it succeed:
    // `installScheduleRunLog` in onBooted and `schedule:runs`. Left lazy, both
    // got undefined, so no run was ever recorded and `schedule:runs` reported
    // the store as not registered.
    await this.app.container.make("scheduler.runs");

    // Offer the scheduled-tasks section to the monitor panel, if one is
    // installed. The panel reads its section registry when it renders, so
    // contributing during the booting phase is early enough.
    installSchedulerMonitor(this.app);
  }

  override async onBooted(): Promise<void> {
    this._disposeObservability = installSchedulerObservability(this.app);
    this._disposeRunLog = installScheduleRunLog(this.app);

    // Wire the distributed lock for cross-process withoutOverlapping. Falls back to
    // the in-process guard when no LockProvider is registered.
    ScheduledTask.lockManager = (this.app.container.tryMake("lock") as LockManager | null) ?? null;

    const runner = this.app.container.tryMake("commands");
    if (!runner) return;
    runner.registerLazy("schedule:list", () =>
      import("../commands/ScheduleListCommand.ts").then((m) => m.ScheduleListCommand),
    );
    runner.registerLazy("schedule:runs", () =>
      import("../commands/ScheduleRunsCommand.ts").then((m) => m.ScheduleRunsCommand),
    );
    runner.registerLazy("schedule:run", () =>
      import("../commands/ScheduleRunCommand.ts").then((m) => m.ScheduleRunCommand),
    );
    runner.registerLazy("schedule:work", () =>
      import("../commands/ScheduleWorkCommand.ts").then((m) => m.ScheduleWorkCommand),
    );
  }

  override async onStarted(): Promise<void> {
    const scheduler = this.app.container.makeSync("scheduler") as SchedulerManager;
    scheduler.start();
  }

  override async onStopped(): Promise<void> {
    this._disposeObservability?.();
    this._disposeObservability = undefined;
    this._disposeRunLog?.();
    this._disposeRunLog = undefined;

    const scheduler = this.app.container.tryMake("scheduler") as SchedulerManager | undefined;
    scheduler?.stop();
  }

  /**
   * Report schedules registered with nothing running them.
   *
   * The reported production failure this exists for: an app ran for weeks with no
   * worker process, and every scheduled task silently did not execute. Nothing
   * logged, because from the web process's point of view nothing was wrong.
   */
  override doctorChecks(): DoctorCheck[] {
    return [
      workerLivenessCheck({
        id: "scheduler-running",
        label: "Scheduler",
        name: "scheduler",
        // Registered tasks, read from the manager rather than from config: a
        // schedule that failed to register is not work anything can do.
        hasWork: () => {
          const count = this.app.container.tryMake("scheduler")?.tasks.size ?? 0;
          return { has: count > 0, summary: `${count} schedule(s) registered` };
        },
        // Generous: the beat is every 60s, and a worker mid-restart should not
        // read as a missing one.
        staleAfter: 15 * 60,
        command: "bun zt worker",
      }),
    ];
  }
}
