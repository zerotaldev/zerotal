/**
 * Scheduler → observer bridges. The scheduler emits its own `TaskRan` / `TaskFailed`
 * / `TaskSkipped` framework events on the core `FrameworkEvents` bus; this module
 * forwards them to whichever observer packages are installed.
 *
 * Each observer's write surface is resolved from the container by binding key and
 * typed through a local structural interface, so the scheduler depends on none of
 * the observer packages — installing or removing an observer requires no change here.
 */
import { FrameworkEvents } from "@zerotal/core";
import type { Application } from "@zerotal/core";
import { TaskRan, TaskFailed, TaskSkipped } from "./events.ts";

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
  recordEvent(e: {
    kind: string;
    label: string;
    status?: "ok" | "warn" | "bad" | "info";
    route?: string | null;
    data?: Record<string, unknown>;
  }): void;
}

/** The subset of the logger this bridge calls (bound as `log`). */
interface LogSink {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>, error?: unknown): void;
}

/**
 * Subscribe the scheduler's events to every installed observer. Returns a disposer
 * that removes every subscription; call it from the scheduler provider's `onStopping()`.
 */
export function installSchedulerObservability(app: Application): () => void {
  const unsubs: Array<() => void> = [];

  const tracer = app.container.tryMake("telemetry" as never) as TelemetrySink | undefined;
  if (tracer) {
    unsubs.push(
      FrameworkEvents.on(TaskRan, (e) => {
        void tracer.recordCompleted("schedule.task", e.durationMs, {
          attributes: { "task.name": e.name },
          status: e.ok ? "ok" : "error",
        });
      }),
      FrameworkEvents.on(TaskFailed, (e) => {
        void tracer.recordCompleted("schedule.task", e.durationMs, {
          attributes: { "task.name": e.name },
          status: "error",
          errorMessage: e.error,
        });
      }),
    );
  }

  const store = app.container.tryMake("monitor.store" as never) as MonitorSink | undefined;
  if (store) {
    unsubs.push(
      FrameworkEvents.on(TaskRan, (e) =>
        store.recordEvent({
          kind: "task",
          label: e.name,
          status: e.ok ? "ok" : "bad",
          route: null,
          data: { ms: e.durationMs },
        }),
      ),
      FrameworkEvents.on(TaskFailed, (e) =>
        store.recordEvent({
          kind: "task",
          label: e.name,
          status: "bad",
          route: null,
          data: { ms: e.durationMs, detail: e.error },
        }),
      ),
      FrameworkEvents.on(TaskSkipped, (e) =>
        store.recordEvent({
          kind: "task",
          label: e.name,
          status: "info",
          route: null,
          data: { detail: e.reason },
        }),
      ),
    );
  }

  const log = app.container.tryMake("log" as never) as LogSink | undefined;
  if (log) {
    unsubs.push(
      FrameworkEvents.on(TaskRan, (e) => {
        if (e.ok) log.info("Scheduled task ran", { name: e.name, durationMs: e.durationMs });
        else log.error("Scheduled task failed", { name: e.name, durationMs: e.durationMs });
      }),
      FrameworkEvents.on(TaskFailed, (e) =>
        log.error(
          "Scheduled task threw",
          { name: e.name, durationMs: e.durationMs },
          new Error(e.error),
        ),
      ),
    );
  }

  return () => {
    for (const unsub of unsubs) unsub();
  };
}
