/**
 * Queue → admin panel contribution.
 *
 * The queue already knows how to introspect itself — failed jobs, pending depth
 * per queue, retry, forget, flush. This module describes that as a console the
 * admin panel renders, so operators get the same operations the CLI commands
 * expose without an SSH session.
 *
 * The panel's write surface is resolved from the container by binding key and
 * typed through a local structural interface, exactly as the observer bridges in
 * `observability.ts` are: the queue depends on `@zerotal/admin` not at all, and
 * an app running the queue without the panel pulls in nothing extra — the binding
 * simply isn't there and this returns.
 */
import type { Application } from "@zerotal/core";
import { queueStats } from "./QueueManager.ts";
import { Queue } from "./facades/Queue.ts";

/** The slice of the admin panel's contribution surface this module uses. */
interface AdminPanelSink {
  enabled(id: string): boolean;
  console(contribution: ConsoleSpec): void;
}

type Row = Record<string, unknown>;
type Tone = "primary" | "success" | "muted" | "destructive" | "default";

interface ConsoleSpec {
  slug: string;
  title: string;
  ability: string;
  navigationIcon?: string;
  navigationGroup?: string;
  navigationSort?: number;
  navigationBadge?: () => Promise<string | number | null>;
  navigationBadgeColor?: Tone;
  tabs: Array<{
    key: string;
    label: string;
    description?: string;
    columns: Array<{
      key: string;
      label: string;
      align?: "start" | "center" | "end";
      mono?: boolean;
      format?: (value: unknown, row: Row) => string;
      badge?: (value: unknown, row: Row) => Tone | null;
    }>;
    rows: () => Promise<Row[]>;
    rowKey?: string;
    rowActions?: Array<{
      key: string;
      label: string;
      icon?: string;
      danger?: boolean;
      confirm?: string;
      run: (row: Row) => Promise<string | void>;
    }>;
    headerActions?: Array<{
      key: string;
      label: string;
      icon?: string;
      danger?: boolean;
      confirm?: string;
      run: () => Promise<string | void>;
    }>;
    empty?: string;
    badge?: () => Promise<number | null>;
  }>;
}

/** The ability an operator needs to see and act on the queue console. */
const ABILITY = "queue.view";

/** Trim a stack trace down to its first line — the table shows the summary. */
function firstLine(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > 140 ? `${line.slice(0, 137)}…` : line || "—";
}

/** Strip the namespace off a job class so the column stays readable. */
function shortClass(value: unknown): string {
  const text = String(value ?? "");
  return text.split(/[\\/.]/).pop() || text;
}

function formatTime(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

/**
 * Contribute the queue console to the admin panel, when one is installed.
 *
 * Call from `QueueProvider.onBooting()` — the panel binds its surface during the
 * registration phase, so it is reachable from any provider's booting phase
 * regardless of the order the two were registered in.
 */
export function installQueueAdmin(app: Application): void {
  const panel = app.container.tryMake("admin.panel" as never) as AdminPanelSink | undefined;
  if (!panel?.enabled("queue")) return;

  panel.console({
    slug: "jobs",
    title: "Jobs",
    ability: ABILITY,
    navigationIcon: "collection",
    navigationGroup: "Operations",
    navigationBadgeColor: "destructive",
    // A failed-job count in the sidebar is the whole point of putting the queue in
    // front of an operator: it is the number you want to notice without looking.
    navigationBadge: async () => {
      const failed = await Queue.failed();
      return failed.length > 0 ? failed.length : null;
    },
    tabs: [
      {
        key: "failed",
        label: "Failed",
        description: "Jobs that exhausted their attempts. Retry puts one back on its queue.",
        empty: "No failed jobs.",
        badge: async () => (await Queue.failed()).length,
        columns: [
          { key: "id", label: "ID", mono: true },
          { key: "queue", label: "Queue", badge: () => "muted" },
          { key: "className", label: "Job", format: shortClass },
          { key: "attempts", label: "Attempts", align: "end" },
          { key: "error", label: "Error", mono: true, format: firstLine },
          { key: "failedAt", label: "Failed", format: formatTime },
        ],
        // Projected field by field rather than passed straight through: the
        // driver record carries the serialized job payload, which has no place
        // in a table an operator reads over someone's shoulder.
        rows: async () =>
          (await Queue.failed()).map((r) => ({
            id: r.id,
            queue: r.queue,
            className: r.className,
            attempts: r.attempts,
            error: r.error,
            failedAt: r.failedAt,
          })),
        rowActions: [
          {
            key: "retry",
            label: "Retry",
            icon: "undo",
            run: async (row) => {
              const ok = await Queue.retryFailed(Number(row["id"]));
              if (!ok) throw new Error("That job is no longer in the failed table.");
              return `Job ${String(row["id"])} queued for retry.`;
            },
          },
          {
            key: "forget",
            label: "Forget",
            icon: "trash",
            danger: true,
            confirm: "Delete this failed job? It cannot be retried afterwards.",
            run: async (row) => {
              await Queue.forgetFailed(Number(row["id"]));
              return `Job ${String(row["id"])} deleted.`;
            },
          },
        ],
        headerActions: [
          {
            key: "clear-failed",
            label: "Clear failed",
            icon: "trash",
            danger: true,
            confirm: "Delete every failed job? They cannot be retried afterwards.",
            run: async () => {
              await Queue.clearFailed();
              return "Failed jobs cleared.";
            },
          },
        ],
      },
      {
        key: "pending",
        label: "Pending",
        description: "Jobs waiting to be picked up by a worker.",
        empty: "Nothing waiting.",
        badge: async () => (await Queue.pending()).length,
        columns: [
          { key: "id", label: "ID", mono: true },
          { key: "queue", label: "Queue", badge: () => "muted" },
          { key: "className", label: "Job", format: shortClass },
          { key: "attempts", label: "Attempts", align: "end" },
          { key: "availableAt", label: "Available", format: formatTime },
          { key: "createdAt", label: "Queued", format: formatTime },
        ],
        rows: async () =>
          (await Queue.pending()).map((r) => ({
            id: r.id,
            queue: r.queue,
            className: r.className,
            attempts: r.attempts,
            availableAt: r.availableAt,
            createdAt: r.createdAt,
          })),
        headerActions: [
          {
            key: "flush",
            label: "Flush",
            icon: "trash",
            danger: true,
            confirm: "Discard every pending job? This cannot be undone.",
            run: async () => {
              await Queue.flush();
              return "Pending jobs flushed.";
            },
          },
        ],
      },
      {
        key: "queues",
        label: "Queues",
        description: "Pending depth per queue, plus totals since this process started.",
        empty: "No queues have been used yet.",
        columns: [
          { key: "queue", label: "Queue" },
          { key: "pending", label: "Pending", align: "end" },
        ],
        rowKey: "queue",
        rows: async () =>
          (await Queue.queues()).map((q) => ({ queue: q.queue, pending: q.pending })),
      },
      {
        key: "throughput",
        label: "Throughput",
        description: "Counters kept by this process since it booted — not persisted history.",
        empty: "Nothing processed yet.",
        columns: [
          { key: "metric", label: "Metric" },
          { key: "value", label: "Count", align: "end" },
        ],
        rowKey: "metric",
        rows: async () => {
          const s = queueStats();
          return [
            { metric: "Processed (total)", value: s.processedTotal },
            { metric: "Processed (last 5m)", value: s.processedLast5m },
            { metric: "Failed (total)", value: s.failedTotal },
            { metric: "Failed (last 5m)", value: s.failedLast5m },
          ];
        },
      },
    ],
  });
}
