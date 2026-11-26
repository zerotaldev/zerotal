import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment, DevProcessDefinition } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { _getConnection } from "@zerotal/orm";
import { QueueManager } from "../QueueManager.ts";
import { DatabaseDriver } from "../drivers/DatabaseDriver.ts";
import { SyncDriver } from "../drivers/SyncDriver.ts";
import { RedisDriver } from "../drivers/RedisDriver.ts";
import { WorkerPool } from "../WorkerPool.ts";
import { JobRegistry } from "../JobRegistry.ts";
import { CallQueuedListener } from "@zerotal/core";
import { Bus } from "../Bus.ts";
import { installQueueObservability } from "../observability.ts";
import { installQueueAdmin } from "../admin.ts";
import { validateQueueConfig } from "../config.ts";
import { frameworkLog } from "@zerotal/core/logger";
import { workerLivenessCheck } from "@zerotal/core/heartbeat";
import type { DoctorCheck } from "@zerotal/core";

declare module "@zerotal/core" {
  interface ContainerBindings {
    queue: QueueManager;
  }
}

export class QueueProvider extends ServiceProvider {
  static override provides = ["queue"] as const;
  static override environments: AppEnvironment[] = ["web", "console", "worker", "test"];

  private _workerInterval: ReturnType<typeof setInterval> | undefined = undefined;
  private _workerPool: WorkerPool | undefined = undefined;
  private _disposeObservability: (() => void) | undefined = undefined;

  /**
   * The worker that `bun zt dev` runs beside the server.
   *
   * Two conditions, and both are about not putting a tab on screen that has
   * nothing to do. The `sync` driver runs every dispatched job inline on the
   * request, so a worker would poll an empty queue forever; and an in-process
   * `workers` pool means the server thread is already draining the queue, so a
   * second consumer is duplicated work rather than more of it.
   */
  override devProcesses(): DevProcessDefinition[] {
    return [
      {
        name: "queue",
        command: "queue:work",
        enabled: () => {
          const config = this.app.container.makeSync("config") as ConfigManager;
          const driver = config.get<string>("queue.driver", "database");
          const workers = config.get<number>("queue.workers", 0);
          return driver !== "sync" && (workers ?? 0) === 0;
        },
        // A worker that exits cleanly has been told to stop; one that crashes
        // has not, and the developer wants it back.
        restart: "on-failure",
      },
    ];
  }

  override onRegister(): void {
    // Refuse a production boot on structural queue misconfiguration (unknown
    // driver, workers without a bootstrap module). Runs in the boot-time config pass.
    this.app.registerConfigValidator?.("queue", validateQueueConfig);

    this.app.container.singleton("queue", () => {
      const config = this.app.container.makeSync("config") as ConfigManager;
      const driver = config.get<string>("queue.driver", "database");

      switch (driver) {
        case "redis":
          return new QueueManager(new RedisDriver());

        case "sync":
          return new QueueManager(new SyncDriver());

        // The app's own database, whichever engine it is. `sqlite` is the name
        // this driver had before it ran on PostgreSQL and MySQL too.
        case "database":
        case "sqlite":
        default: {
          // Read from config, so a slow job can be given longer than the 90s
          // default before another worker reclaims it.
          const visibilityTimeout = config.get<number | undefined>("queue.visibilityTimeout");
          return new QueueManager(
            new DatabaseDriver(
              _getConnection(),
              visibilityTimeout !== undefined ? { visibilityTimeout } : {},
            ),
          );
        }
      }
    });
  }

  override async onBooting(): Promise<void> {
    JobRegistry.register(CallQueuedListener as never);
    const manager = (await this.app.container.make("queue")) as QueueManager;
    Bus.setManager(manager);

    // Offer the queue console to the admin panel, if one is installed. This runs
    // in the booting phase (not `onBooted`) because the panel mounts its routes
    // once booting finishes — and `onBooted` runs in parallel, so contributing
    // there would race the mount.
    installQueueAdmin(this.app);
  }

  override async onStarted(): Promise<void> {
    const config = this.app.container.makeSync("config") as ConfigManager;
    const workerCount = config.get<number>("queue.workers", 0);
    const env = this.app._env;

    // Resolve the Bun Worker bootstrap module path. When `queue.workerBootstrap`
    // isn't configured the worker thread discovers jobs by convention (imports
    // every app/jobs/*.ts) — same as the `jobs` convention concern, no codegen.
    const workerBootstrap = config.get<string | undefined>("queue.workerBootstrap", undefined);

    // Start polling when:
    //   - running as a dedicated worker process (queue:work command), OR
    //   - running as the HTTP server with Bun Worker threads configured
    const usingBunWorkers = env === "web" && workerCount > 0;
    const isWorkerProcess = env === "worker";
    if (!usingBunWorkers && !isWorkerProcess) return;

    const queue = this.app.container.makeSync("queue") as QueueManager;
    const pollMs = config.get<number>("queue.pollInterval", 500);
    const queues = config.get<string[]>("queue.queues", ["default"]);

    if (usingBunWorkers) {
      // Spawn N Bun OS threads — CPU-heavy jobs run there, not on the HTTP loop.
      this._workerPool = new WorkerPool({ size: workerCount, bootstrapPath: workerBootstrap });
      await this._workerPool.start();
      queue.setWorkerPool(this._workerPool);
      frameworkLog("queue").info(`Spawned ${workerCount} Bun Worker thread(s) for job execution`, {
        workers: workerCount,
      });
    }

    frameworkLog("queue").info(`Polling [${queues.join(", ")}] every ${pollMs}ms`, {
      queues,
      pollMs,
    });

    this._workerInterval = setInterval(async () => {
      if (queue.isShuttingDown) return;
      for (const q of queues) {
        await queue.processNext(q).catch(console.error);
      }
    }, pollMs);
  }

  override async onStopping(): Promise<void> {
    this._disposeObservability?.();
    this._disposeObservability = undefined;

    if (this._workerInterval !== undefined) {
      clearInterval(this._workerInterval);
      this._workerInterval = undefined;
    }

    const queue = this.app.container.tryMake("queue") as QueueManager | undefined;
    if (queue) {
      frameworkLog("queue").info("Draining in-flight jobs");
      await queue.drain();
      frameworkLog("queue").info("All jobs drained");
    }

    if (this._workerPool) {
      await this._workerPool.terminate();
      this._workerPool = undefined;
      frameworkLog("queue").info("Bun Worker threads terminated");
    }
  }

  override async onBooted(): Promise<void> {
    this._disposeObservability = installQueueObservability(this.app);

    const runner = this.app.container.tryMake("commands");
    if (!runner) return;

    runner.registerLazy("queue:work", () =>
      import("../commands/QueueWorkCommand.ts").then((m) => m.QueueWorkCommand),
    );
    runner.registerLazy("queue:failed", () =>
      import("../commands/QueueFailedCommand.ts").then((m) => m.QueueFailedCommand),
    );
    runner.registerLazy("queue:retry", () =>
      import("../commands/QueueRetryCommand.ts").then((m) => m.QueueRetryCommand),
    );
    runner.registerLazy("queue:flush", () =>
      import("../commands/QueueFlushCommand.ts").then((m) => m.QueueFlushCommand),
    );
  }

  /**
   * Report jobs waiting with no worker running.
   *
   * Same failure as the scheduler's, one layer over: jobs accumulate, nothing
   * errors, and you learn about it when a customer asks where their email went.
   *
   * Keyed on the *pending depth* rather than on whether any job class is
   * registered — an app with an empty queue and no worker may be perfectly fine,
   * and a doctor that says otherwise is one people scroll past.
   *
   * The depth is every queue's, not `default`'s alone: jobs waiting on `emails`
   * with no worker are the same finding. And with nothing waiting the report says
   * how many job classes the app defines rather than "nothing registered". Job
   * classes register themselves when a worker imports `app/jobs/`, so the web
   * process running the doctor has not seen them, and "nothing registered" read as
   * "your jobs are missing" in an app that had several.
   */
  override doctorChecks(): DoctorCheck[] {
    return [
      workerLivenessCheck({
        id: "queue-worker-running",
        label: "Queue worker",
        name: "queue",
        hasWork: async () => {
          const defined = await this._definedJobClasses();
          const idle =
            defined > 0
              ? `${defined} job class(es) defined, none waiting`
              : "no job classes defined, none waiting";
          try {
            const queue = this.app.container.tryMake("queue") as QueueManager | undefined;
            if (!queue) return { has: false, summary: "", idle };
            const queues = await queue.queues();
            const busy = queues.filter((q) => q.pending > 0);
            const depth =
              queues.length > 0 ? busy.reduce((n, q) => n + q.pending, 0) : await queue.size();
            const where =
              busy.length > 1 || (busy.length === 1 && busy[0]!.queue !== "default")
                ? ` on ${busy.map((q) => q.queue).join(", ")}`
                : "";
            return { has: depth > 0, summary: `${depth} job(s) waiting${where}`, idle };
          } catch {
            // An unreadable queue is not a finding about the worker.
            return { has: false, summary: "", idle };
          }
        },
        staleAfter: 15 * 60,
        command: "bun zt worker",
      }),
    ];
  }

  /**
   * The job classes the app defines: the files in its jobs directory, which is
   * what a worker imports. Not `JobRegistry`, which in the web process holds only
   * the framework's own jobs.
   */
  private async _definedJobClasses(): Promise<number> {
    const config = this.app.container.tryMake("config") as ConfigManager | undefined;
    const paths = config?.get<Record<string, string> | undefined>(
      "app.conventions.paths",
      undefined,
    );
    const dir = `${process.cwd()}/${paths?.["jobs"] ?? "app/jobs"}`;
    const names = new Set<string>();
    try {
      for await (const file of new Bun.Glob("**/*.{ts,tsx,js}").scan({ cwd: dir })) {
        if (/\.(test|spec)\.[jt]sx?$/.test(file) || file.endsWith(".d.ts")) continue;
        names.add(file.replace(/\\/g, "/").replace(/\.[jt]sx?$/, ""));
      }
    } catch {
      // No jobs directory: nothing defined there.
    }
    return names.size;
  }
}
