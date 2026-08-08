/**
 * Adapters that read real data from the queue, scheduler, and health
 * subsystems when they are installed. Each reader is defensive: if the
 * subsystem isn't bound in the container (the package is an optional peer
 * dependency), it returns `null` and the store falls back to representative
 * sample data so the panel stays populated and useful.
 */
import { Health } from "@zerotal/core/health";
import { ZEROTAL_VERSION } from "../version.ts";
import type {
  CheckIn,
  DeadJob,
  FailedJob,
  HealthEntry,
  QueueRow,
  ScheduledJob,
  Worker,
} from "../store/types.ts";
import { ago } from "../support/time.ts";

// ── Structural interfaces (avoid hard type-coupling to optional peers) ────────

interface QueueStatsShape {
  processedTotal: number;
  failedTotal: number;
  processedLast5m: number;
  failedLast5m: number;
}

interface FailedRecordShape {
  id: number;
  queue: string;
  className: string;
  attempts: number;
  maxAttempts?: number;
  error: string;
  failedAt: string;
}

interface QueueManagerShape {
  queues(): Promise<{ queue: string; pending: number }[]>;
  failed(queue?: string): Promise<FailedRecordShape[]>;
  retryFailed(id: number): Promise<boolean>;
  forgetFailed(id: number): Promise<void>;
  stats(): QueueStatsShape;
  readonly activeJobCount?: number;
}

interface ScheduledTaskShape {
  readonly _name: string;
  readonly _schedule: string;
  readonly _running: boolean;
  readonly _lastRunAt?: Date;
  readonly _lastOk?: boolean;
  readonly _lastDurationMs?: number;
}

interface SchedulerManagerShape {
  readonly tasks: ReadonlyMap<string, ScheduledTaskShape>;
}

interface ContainerShape {
  tryMake(name: string): unknown;
}

interface AppShape {
  container: ContainerShape;
}

function resolve<T>(app: AppShape | undefined, binding: string): T | null {
  if (!app) return null;
  try {
    const v = app.container.tryMake(binding);
    return (v ?? null) as T | null;
  } catch {
    return null;
  }
}

// ── Queues ────────────────────────────────────────────────────────────────────

export function queueManager(app?: AppShape): QueueManagerShape | null {
  return resolve<QueueManagerShape>(app, "queue");
}

export async function liveQueues(app?: AppShape): Promise<QueueRow[] | null> {
  const mgr = queueManager(app);
  if (!mgr) return null;
  try {
    const rows = await mgr.queues();
    return rows.map((r) => ({
      name: r.queue,
      pending: r.pending,
      wait: 0,
      throughput: 0,
      paused: false,
      series: [],
    }));
  } catch {
    return null;
  }
}

export async function liveFailedJobs(app?: AppShape): Promise<FailedJob[] | null> {
  const mgr = queueManager(app);
  if (!mgr) return null;
  try {
    const rows = await mgr.failed();
    return rows.map((r) => ({
      id: r.id,
      name: r.className,
      error: r.error,
      failedAt: r.failedAt,
      attempts: r.attempts,
      tags: [r.queue],
    }));
  } catch {
    return null;
  }
}

// The dead-letter view: jobs that exhausted every retry (attempts ≥ maxAttempts).
// In the SQLite driver the failed store only holds exhausted jobs, so this is the
// authoritative "won't run again without intervention" list backing the Requeue action.
export async function liveDeadLetter(app?: AppShape): Promise<DeadJob[] | null> {
  const mgr = queueManager(app);
  if (!mgr) return null;
  try {
    const rows = await mgr.failed();
    return rows
      .filter((r) => r.attempts >= (r.maxAttempts ?? r.attempts))
      .map((r) => ({
        id: r.id,
        name: r.className,
        error: r.error,
        attempts: r.attempts,
        deadAt: r.failedAt,
      }));
  } catch {
    return null;
  }
}

export function liveQueueStats(app?: AppShape): QueueStatsShape | null {
  const mgr = queueManager(app);
  if (!mgr) return null;
  try {
    return mgr.stats();
  } catch {
    return null;
  }
}

export async function retryFailedJob(app: AppShape | undefined, id: number): Promise<boolean> {
  const mgr = queueManager(app);
  if (!mgr) return false;
  try {
    return await mgr.retryFailed(id);
  } catch {
    return false;
  }
}

export async function forgetFailedJob(app: AppShape | undefined, id: number): Promise<boolean> {
  const mgr = queueManager(app);
  if (!mgr) return false;
  try {
    await mgr.forgetFailed(id);
    return true;
  } catch {
    return false;
  }
}

// Workers are not modelled by the SQLite driver; surface active job count as a
// single logical worker when the manager exposes it.
export function liveWorkers(app?: AppShape): Worker[] | null {
  const mgr = queueManager(app);
  if (!mgr || typeof mgr.activeJobCount !== "number") return null;
  return [
    {
      name: "worker-1",
      status: "running",
      processes: 1,
      jobsPerMin: mgr.activeJobCount,
      series: [],
    },
  ];
}

// ── Scheduler ──────────────────────────────────────────────────────────────────

export function liveCheckins(app?: AppShape): CheckIn[] | null {
  const mgr = resolve<SchedulerManagerShape>(app, "scheduler");
  if (!mgr) return null;
  try {
    const out: CheckIn[] = [];
    for (const task of mgr.tasks.values()) {
      const last = task._lastRunAt ? ago(task._lastRunAt.getTime()) : "never";
      const status: CheckIn["status"] =
        task._lastRunAt == null ? "missed" : task._lastOk === false ? "missed" : "ok";
      out.push({ name: task._name, cron: task._schedule, last, status });
    }
    return out;
  } catch {
    return null;
  }
}

export function liveScheduled(app?: AppShape): ScheduledJob[] | null {
  const mgr = resolve<SchedulerManagerShape>(app, "scheduler");
  if (!mgr) return null;
  try {
    const out: ScheduledJob[] = [];
    for (const task of mgr.tasks.values()) {
      out.push({
        name: task._name,
        runsIn: task._running ? "running" : "—",
        queue: "scheduler",
        tag: "cron",
      });
    }
    return out;
  } catch {
    return null;
  }
}

// ── Health ─────────────────────────────────────────────────────────────────────

export async function liveHealth(_app?: AppShape): Promise<HealthEntry[] | null> {
  if (Health.names.length === 0) return null;
  try {
    const report = await Health.run({
      name: "app",
      version: ZEROTAL_VERSION,
      environment: process.env.NODE_ENV ?? "production",
      uptime: Math.floor(process.uptime()),
    });
    return Object.entries(report.checks).map(([name, check]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      ok: check.status === "ok",
      detail: check.message ?? `${check.status} · ${check.durationMs}ms`,
    }));
  } catch {
    return null;
  }
}

export type { AppShape };
