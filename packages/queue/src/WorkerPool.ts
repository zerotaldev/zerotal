import type { JobRecord } from "./drivers/QueueDriver.ts";
import { frameworkLog } from "@zerotal/core/logger";

export interface WorkerPoolOptions {
  /** Number of OS threads to spawn. */
  size: number;
  /**
   * Optional absolute path or file URL to a module that imports+registers all job
   * classes. When omitted, the worker thread discovers jobs by convention (imports
   * every `app/jobs/*.ts`). Set it only to override that with an explicit bootstrap.
   */
  bootstrapPath?: string | undefined;
  /**
   * Most jobs allowed to wait in memory for a free thread. Default: `size * 64`.
   *
   * A job sitting in this backlog is already *claimed* — the driver has reserved it and is
   * counting down its visibility timeout. Queue more than the pool can work through and
   * those jobs are reclaimed and executed a second time while the first copy is still
   * waiting its turn. Past the cap, `run()` reports failure immediately so the job goes
   * back to the driver instead of aging out.
   */
  maxPending?: number | undefined;
  /**
   * How many times a slot may respawn after its worker dies before the pool gives up on it.
   * Default: 5. A worker whose script throws on load would otherwise respawn forever.
   */
  maxRespawns?: number | undefined;
}

export type WorkerResult = { success: true } | { success: false; error: string };

interface WorkerState {
  worker: Worker;
  busy: boolean;
  resolve?: (r: WorkerResult) => void;
  /** Consecutive respawns for this slot; reset by a successful job. */
  respawns: number;
  /** Set once the slot has exhausted its respawns — it is skipped when handing out work. */
  dead: boolean;
}

/**
 * Manages a pool of Bun Web Worker threads for off-main-thread job execution.
 *
 * Each worker is a genuine OS thread (not just a separate V8 context), so
 * CPU-intensive jobs run without stalling the HTTP event loop.
 *
 * Usage:
 *   const pool = new WorkerPool({ size: 2, bootstrapPath: '...' });
 *   await pool.start();                    // spawns + bootstraps threads
 *   const result = await pool.run(record); // executes job on a free thread
 *   await pool.terminate();                // cleanly shuts threads down
 */
export class WorkerPool {
  private _workers: WorkerState[] = [];
  private _pending: Array<{ record: JobRecord; resolve: (r: WorkerResult) => void }> = [];

  constructor(private readonly opts: WorkerPoolOptions) {}

  /** True once {@link terminate} has run, so a dying worker is not respawned. */
  private _terminated = false;

  /** Spawn all worker threads and wait until every thread has bootstrapped. */
  async start(): Promise<void> {
    this._terminated = false;
    const readyPromises: Promise<void>[] = [];

    for (let i = 0; i < this.opts.size; i++) {
      const state: WorkerState = { worker: null!, busy: false, respawns: 0, dead: false };
      this._workers.push(state);
      readyPromises.push(this._spawn(state));
    }

    await Promise.all(readyPromises);
  }

  /**
   * Bring up a worker in `state` and wire its full lifecycle.
   *
   * Every path that ends a worker settles the in-flight promise and clears `busy`. Without
   * `error`/`close` listeners a thread that died mid-job left its caller's promise pending
   * forever and its slot marked busy — permanently wedging a `size: 1` pool — and a
   * bootstrap failure that surfaced as an error rather than a message hung `start()`, and
   * with it `app.boot()`.
   *
   * @returns Resolves when the thread reports ready; rejects if it fails to bootstrap.
   */
  private _spawn(state: WorkerState): Promise<void> {
    const scriptUrl = new URL("./queue-worker.ts", import.meta.url);
    const worker = new Worker(scriptUrl);
    state.worker = worker;
    state.busy = false;

    let settleReady: (() => void) | undefined;
    let failReady: ((err: Error) => void) | undefined;
    const ready = new Promise<void>((resolve, reject) => {
      settleReady = resolve;
      failReady = reject;
    });

    const onInit = (event: MessageEvent) => {
      const msg = event.data as { type: string; message?: string };
      if (msg.type === "ready") {
        worker.removeEventListener("message", onInit as EventListener);
        settleReady?.();
      } else if (msg.type === "bootstrap-error") {
        worker.removeEventListener("message", onInit as EventListener);
        failReady?.(new Error(`[Zerotal Queue] Worker bootstrap failed: ${msg.message}`));
      }
    };
    worker.addEventListener("message", onInit as EventListener);

    // Job results.
    worker.addEventListener("message", (event: MessageEvent) => {
      const msg = event.data as { type: string; message?: string };
      if (msg.type !== "done" && msg.type !== "error") return;

      const result: WorkerResult =
        msg.type === "done"
          ? { success: true }
          : { success: false, error: msg.message ?? "Unknown error" };

      // A thread that completed a job is healthy, whatever the job's own outcome.
      state.respawns = 0;
      this._settle(state, result);
    });

    // The thread threw outside a job, or failed to load its script.
    worker.addEventListener("error", (event: ErrorEvent) => {
      const detail = event.message || "worker error";
      failReady?.(new Error(`[Zerotal Queue] Worker failed to start: ${detail}`));
      this._onWorkerLost(state, `Worker errored: ${detail}`);
    });

    // The thread exited — crashed, killed, or terminated by us.
    worker.addEventListener("close", () => {
      failReady?.(new Error("[Zerotal Queue] Worker exited before bootstrapping"));
      this._onWorkerLost(state, "Worker exited before the job completed");
    });

    worker.postMessage({ type: "bootstrap", modulePath: this.opts.bootstrapPath });
    return ready;
  }

  /** Release a worker's in-flight job with `result` and hand it the next one. */
  private _settle(state: WorkerState, result: WorkerResult): void {
    state.busy = false;
    const resolve = state.resolve;
    delete state.resolve;
    resolve?.(result);
    this._drainPending();
  }

  /**
   * A worker died. Settle whatever it was running, then replace it so the pool does not
   * quietly shrink toward zero throughput.
   */
  private _onWorkerLost(state: WorkerState, reason: string): void {
    if (this._terminated || state.dead) return;
    this._settle(state, { success: false, error: reason });

    if (++state.respawns > (this.opts.maxRespawns ?? 5)) {
      // Respawning a worker whose script throws on load is an infinite loop. Mark the slot
      // dead and keep serving from the rest; a pool with no live slots fails jobs fast
      // rather than accumulating them.
      state.dead = true;
      frameworkLog("queue").error(`Worker slot gave up after ${state.respawns} respawns`, {
        respawns: state.respawns,
        reason,
      });
      this._drainPending();
      return;
    }

    void this._spawn(state).catch(() => {
      // The replacement failed to bootstrap; its own error/close listener handles the
      // next attempt, so there is nothing to do here but not crash.
    });
  }

  /**
   * Send a job record to a free worker thread.
   *
   * When every thread is busy the job waits in memory, up to {@link WorkerPoolOptions.maxPending}.
   * Beyond that it is reported as failed straight away: a waiting job is already claimed
   * from the driver, and one that waits past its visibility timeout gets reclaimed and run
   * a second time while the first copy is still queued here.
   */
  run(record: JobRecord): Promise<WorkerResult> {
    const maxPending = this.opts.maxPending ?? this.opts.size * 64;
    if (this._pending.length >= maxPending) {
      return Promise.resolve({
        success: false,
        error: `WorkerPool backlog is full (${maxPending}) — job returned to the queue`,
      });
    }
    if (this._workers.length > 0 && this._workers.every((w) => w.dead)) {
      return Promise.resolve({
        success: false,
        error: "WorkerPool has no live workers — job returned to the queue",
      });
    }
    return new Promise((resolve) => {
      this._pending.push({ record, resolve });
      this._drainPending();
    });
  }

  /** Terminate all worker threads. Call after QueueManager.drain() completes. */
  async terminate(): Promise<void> {
    // Set first: terminate() closes every worker, and the close listener must not read
    // that as a crash and respawn what we are shutting down.
    this._terminated = true;

    // Reject any callers still waiting for a worker — avoids hanging promises.
    for (const { resolve } of this._pending) {
      resolve({ success: false, error: "WorkerPool terminated before job could run" });
    }
    this._pending = [];

    for (const state of this._workers) {
      // Reject any job currently in-flight on this thread.
      if (state.busy && state.resolve) {
        state.resolve({ success: false, error: "WorkerPool terminated while job was running" });
        delete state.resolve;
      }
      state.worker.terminate();
    }
    this._workers = [];
  }

  private _drainPending(): void {
    while (this._pending.length > 0) {
      const free = this._workers.find((w) => !w.busy && !w.dead);
      if (!free) break;
      const next = this._pending.shift()!;
      free.busy = true;
      free.resolve = next.resolve;
      free.worker.postMessage({ type: "job", record: next.record });
    }
  }
}
