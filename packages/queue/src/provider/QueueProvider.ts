import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment, DevProcessDefinition } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { _getConnection } from "@zerotal/orm";
import { QueueManager } from "../QueueManager.ts";
import { SqliteDriver } from "../drivers/SqliteDriver.ts";
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
          const driver = config.get<string>("queue.driver", "sqlite");
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
      const driver = config.get<string>("queue.driver", "sqlite");

      switch (driver) {
        case "redis":
          return new QueueManager(new RedisDriver());

        case "sync":
          return new QueueManager(new SyncDriver());

        case "sqlite":
        default:
          return new QueueManager(new SqliteDriver(_getConnection()));
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
   */
  override doctorChecks(): DoctorCheck[] {
    return [
      workerLivenessCheck({
        id: "queue-worker-running",
        label: "Queue worker",
        name: "queue",
        hasWork: async () => {
          try {
            const depth = (await this.app.container.tryMake("queue")?.size()) ?? 0;
            return { has: depth > 0, summary: `${depth} job(s) waiting` };
          } catch {
            // An unreadable queue is not a finding about the worker.
            return { has: false, summary: "" };
          }
        },
        staleAfter: 15 * 60,
        command: "bun zt worker",
      }),
    ];
  }
}
