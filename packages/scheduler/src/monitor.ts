/**
 * Scheduler → monitor panel contribution.
 *
 * A cron task that silently stopped firing is one of the harder failures to
 * notice: nothing errors, work just stops happening. Every task already tracks
 * when it last ran, whether it succeeded, how long it took and when it is due
 * next — this puts that in front of an operator.
 *
 * The panel's write surface is resolved from the container by binding key and
 * typed through a local structural interface, exactly as the observer bridges in
 * `observability.ts` are: the scheduler depends on `@zerotal/monitor` not at
 * all, and an app running tasks without the panel pulls in nothing extra.
 */
import type { Application } from "@zerotal/core";
import type { SchedulerManager } from "./SchedulerManager.ts";

type Row = Record<string, unknown>;
type Tone = "default" | "good" | "warn" | "bad";

/** The slice of the monitor panel's contribution surface this module uses. */
interface MonitorPanelSink {
  enabled(id: string): boolean;
  section(section: {
    id: string;
    label: string;
    group?: string;
    sort?: number;
    resolve(range: string): {
      stats?: Array<{
        label: string;
        value: string | number;
        detail?: string;
        tone?: Tone;
        percent?: number;
      }>;
      tables?: Array<{
        title: string;
        columns: Array<{
          key: string;
          label: string;
          align?: "start" | "end";
          mono?: boolean;
          format?: (value: unknown, row: Row) => string;
          tone?: (value: unknown, row: Row) => Tone | null;
        }>;
        rows: Row[];
        empty?: string;
      }>;
    };
  }): void;
}

function formatWhen(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function formatDuration(value: unknown): string {
  if (typeof value !== "number") return "—";
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`;
}

/**
 * Contribute the scheduled-tasks section to the monitor panel, when one is
 * installed. Call from `SchedulerProvider.onBooting()`.
 */
export function installSchedulerMonitor(app: Application): void {
  const panel = app.container.tryMake("monitor.panel" as never) as MonitorPanelSink | undefined;
  if (!panel?.enabled("scheduler")) return;

  panel.section({
    id: "scheduler",
    label: "Scheduled tasks",
    group: "Infrastructure",
    // The manager is resolved at render time rather than captured here: tasks
    // can be registered after boot, and the panel re-reads on every refresh.
    // Going through the container rather than the facade also keeps this
    // callable outside a booted app, which is what makes it testable.
    resolve: () => {
      const scheduler = app.container.tryMake("scheduler") as SchedulerManager | null;
      const tasks = scheduler ? [...scheduler.tasks.values()] : [];
      // The durable run log fills what the in-memory state cannot: after a restart
      // every task reads "never run" in memory even when it ran an hour ago.
      const runStore = app.container.tryMake("scheduler.runs") ?? undefined;
      const lastRecorded = (name: string) => {
        try {
          return runStore?.lastFor(name);
        } catch {
          return undefined;
        }
      };
      const failing = tasks.filter((t) => (t.lastOk ?? lastRecorded(t.name)?.ok) === false);
      const neverRun = tasks.filter(
        (t) => t.lastRunAt === undefined && lastRecorded(t.name) === undefined,
      );

      return {
        stats: [
          { label: "Tasks", value: tasks.length },
          {
            label: "Running now",
            value: tasks.filter((t) => t.isRunning).length,
          },
          {
            label: "Failing",
            value: failing.length,
            tone: failing.length > 0 ? "bad" : "good",
            ...(failing.length > 0 ? { detail: failing.map((t) => t.name).join(", ") } : {}),
          },
          {
            label: "Never run",
            value: neverRun.length,
            tone: neverRun.length > 0 ? "warn" : "default",
          },
        ],
        tables: [
          {
            title: "Tasks",
            empty: "No tasks are scheduled.",
            columns: [
              { key: "name", label: "Task" },
              { key: "schedule", label: "Cron", mono: true },
              {
                key: "status",
                label: "Last result",
                tone: (v) =>
                  String(v).startsWith("Failed")
                    ? "bad"
                    : String(v).startsWith("OK")
                      ? "good"
                      : null,
              },
              { key: "lastRunAt", label: "Last run", format: formatWhen },
              { key: "durationMs", label: "Duration", align: "end", format: formatDuration },
              { key: "nextRunAt", label: "Next run", format: formatWhen },
            ],
            rows: tasks.map((t) => {
              // Fall back to the recorded run when this process has not run the
              // task yet — "(recorded)" marks the value as pre-restart history.
              const recorded = t.lastRunAt === undefined ? lastRecorded(t.name) : undefined;
              const lastOk = t.lastOk ?? recorded?.ok;
              return {
                name: t.name,
                schedule: t.schedule,
                status: t.isRunning
                  ? "Running"
                  : lastOk === undefined
                    ? "Never run"
                    : lastOk
                      ? recorded
                        ? "OK (recorded)"
                        : "OK"
                      : recorded
                        ? "Failed (recorded)"
                        : "Failed",
                lastRunAt: t.lastRunAt ?? recorded?.finishedAt ?? null,
                durationMs: t.lastDurationMs ?? recorded?.durationMs ?? null,
                nextRunAt: t.nextRunAt(),
              };
            }),
          },
          {
            title: "Recent runs",
            empty: "No runs recorded yet.",
            columns: [
              { key: "name", label: "Task" },
              {
                key: "result",
                label: "Result",
                tone: (v) => (v === "OK" ? "good" : "bad"),
              },
              { key: "startedAt", label: "Started", format: formatWhen },
              { key: "durationMs", label: "Duration", align: "end", format: formatDuration },
              { key: "error", label: "Error" },
            ],
            rows: (runStore?.recent(15) ?? []).map((r) => ({
              name: r.name,
              result: r.ok ? "OK" : "Failed",
              startedAt: r.startedAt,
              durationMs: r.durationMs,
              error: r.error ?? "—",
            })),
          },
        ],
      };
    },
  });
}
