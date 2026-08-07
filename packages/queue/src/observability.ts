/**
 * Queue → observer bridges. The queue emits its own `JobRan` framework event on
 * the core `FrameworkEvents` bus; this module forwards it to whichever observer
 * packages are installed.
 *
 * Each observer's write surface is resolved from the container by binding key and
 * typed through a local structural interface, so the queue depends on none of the
 * observer packages — installing or removing an observer requires no change here.
 */
import { FrameworkEvents, RequestContext } from "@zerotal/core";
import type { Application } from "@zerotal/core";
import { JobRan } from "./events.ts";

/** The subset of the telemetry tracer this bridge calls (bound as `telemetry`). */
interface TelemetrySink {
  recordCompleted(
    name: string,
    durationMs: number,
    options?: {
      kind?: "internal" | "server" | "client" | "producer" | "consumer";
      attributes?: Record<string, string | number | boolean>;
      status?: "ok" | "error";
      errorMessage?: string;
    },
  ): unknown;
}

/** The subset of the monitor store this bridge calls (bound as `monitor.store`). */
interface MonitorSink {
  recordJob(job: {
    status: string;
    className?: string;
    queue?: string;
    ms?: number;
    error?: string | null;
  }): void;
}

/** The subset of the devtools trace sink this bridge calls (bound as `devtools.trace`). */
interface DevtoolsSink {
  bufferJob(
    ctx: object,
    j: { className: string; queue: string; status: string; durationMs: number; error?: string },
  ): void;
}

/** The subset of the logger this bridge calls (bound as `log`). */
interface LogSink {
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>, error?: unknown): void;
}

/**
 * Subscribe the queue's events to every installed observer. Returns a disposer
 * that removes every subscription; call it from the queue provider's `onStopping()`.
 */
export function installQueueObservability(app: Application): () => void {
  const unsubs: Array<() => void> = [];

  const tracer = app.container.tryMake("telemetry" as never) as TelemetrySink | undefined;
  if (tracer) {
    unsubs.push(
      FrameworkEvents.on(JobRan, (e) => {
        if (e.status !== "completed" && e.status !== "failed") return;
        void tracer.recordCompleted("queue.job", e.durationMs, {
          kind: "consumer",
          attributes: { "job.class": e.className, "job.queue": e.queue },
          status: e.status === "failed" ? "error" : "ok",
          ...(e.error ? { errorMessage: e.error } : {}),
        });
      }),
    );
  }

  const store = app.container.tryMake("monitor.store" as never) as MonitorSink | undefined;
  if (store) {
    unsubs.push(
      FrameworkEvents.on(JobRan, (e) =>
        store.recordJob({
          status: e.status,
          className: e.className,
          queue: e.queue,
          ms: e.durationMs,
          error: e.error ?? null,
        }),
      ),
    );
  }

  const trace = app.container.tryMake("devtools.trace" as never) as DevtoolsSink | undefined;
  if (trace) {
    unsubs.push(
      FrameworkEvents.on(JobRan, (e) => {
        const ctx = RequestContext.tryGet();
        if (!ctx) return;
        trace.bufferJob(ctx, {
          className: e.className,
          queue: e.queue,
          status: e.status,
          durationMs: e.durationMs,
          ...(e.error ? { error: e.error } : {}),
        });
      }),
    );
  }

  const log = app.container.tryMake("log" as never) as LogSink | undefined;
  if (log) {
    unsubs.push(
      FrameworkEvents.on(JobRan, (e) => {
        if (e.status === "failed") {
          log.error(
            "Job failed",
            { className: e.className, queue: e.queue, durationMs: e.durationMs },
            new Error(e.error ?? "Job execution failed"),
          );
        } else if (e.status === "retried") {
          log.warn("Job retried", {
            className: e.className,
            queue: e.queue,
            durationMs: e.durationMs,
          });
        }
      }),
    );
  }

  return () => {
    for (const unsub of unsubs) unsub();
  };
}
