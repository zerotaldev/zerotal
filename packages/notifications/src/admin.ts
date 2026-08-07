/**
 * Notifications → admin panel contribution.
 *
 * When something stops arriving, the question is always the same: did we try,
 * on which channel, and what did the provider say? This console answers that
 * from the delivery counters, and exposes the stored inbox so an operator can
 * see and prune what the database channel has accumulated.
 *
 * The panel's write surface is resolved from the container by binding key and
 * typed through a local structural interface, exactly as the observer bridges in
 * `observability.ts` are: this package depends on `@zerotal/admin` not at all,
 * and an app without the panel pulls in nothing extra — the binding is simply
 * absent and this returns.
 */
import type { Application } from "@zerotal/core";
import { channelStats, recentDeliveries } from "./stats.ts";
import type { NotificationManager } from "./NotificationManager.ts";

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

/** The ability an operator needs to see and act on the notifications console. */
const ABILITY = "notifications.view";

function formatTime(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

/** Trim a long provider error down to its first line. */
function firstLine(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > 140 ? `${line.slice(0, 137)}…` : line || "—";
}

function formatMs(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n)}ms` : "—";
}

/**
 * Contribute the notifications console to the admin panel, when one is installed.
 *
 * Call from `NotificationProvider.onBooting()` — the panel binds its surface
 * during the registration phase, so it is reachable from any provider's booting
 * phase regardless of the order the two were registered in.
 */
export function installNotificationsAdmin(app: Application): void {
  const panel = app.container.tryMake("admin.panel" as never) as AdminPanelSink | undefined;
  if (!panel?.enabled("notifications")) return;

  const manager = (): NotificationManager =>
    app.container.makeSync("notifications") as NotificationManager;

  panel.console({
    slug: "notifications",
    title: "Notifications",
    ability: ABILITY,
    navigationIcon: "bell",
    navigationGroup: "Operations",
    navigationBadgeColor: "destructive",
    // A failure count is the number worth noticing without looking for it.
    navigationBadge: async () => {
      const failed = recentDeliveries().filter((d) => !d.ok).length;
      return failed > 0 ? failed : null;
    },
    tabs: [
      {
        key: "recent",
        label: "Recent",
        description:
          "Delivery attempts since this process booted, newest first. Not persisted history.",
        empty: "Nothing delivered yet.",
        badge: async () => recentDeliveries().length,
        columns: [
          { key: "at", label: "When", format: formatTime },
          { key: "className", label: "Notification" },
          { key: "channel", label: "Channel", badge: () => "muted" },
          { key: "notifiable", label: "To", mono: true },
          {
            key: "ok",
            label: "Result",
            format: (v) => (v ? "sent" : "failed"),
            badge: (v) => (v ? "success" : "destructive"),
          },
          { key: "durationMs", label: "Took", align: "end", format: formatMs },
          { key: "error", label: "Error", mono: true, format: firstLine },
        ],
        rows: async () =>
          recentDeliveries().map((d) => ({
            at: d.at,
            className: d.className,
            channel: d.channel,
            notifiable: d.notifiable,
            ok: d.ok,
            durationMs: d.durationMs,
            error: d.error ?? "",
          })),
      },
      {
        key: "channels",
        label: "Channels",
        description: "Per-channel totals since boot — where failures are concentrated.",
        empty: "No channel has been used yet.",
        rowKey: "channel",
        columns: [
          { key: "channel", label: "Channel" },
          { key: "sent", label: "Sent", align: "end" },
          {
            key: "failed",
            label: "Failed",
            align: "end",
            badge: (v) => (Number(v) > 0 ? "destructive" : "muted"),
          },
          { key: "avgMs", label: "Avg", align: "end", format: formatMs },
        ],
        rows: async () => channelStats().map((s) => ({ ...s })),
      },
      {
        key: "stored",
        label: "Stored",
        description:
          "Rows written by the database channel, newest first. Pruning deletes read notifications.",
        empty: "No stored notifications.",
        columns: [
          { key: "created_at", label: "When", format: formatTime },
          { key: "type", label: "Notification" },
          { key: "notifiable_type", label: "Recipient type", badge: () => "muted" },
          { key: "notifiable_id", label: "Recipient", mono: true },
          {
            key: "read_at",
            label: "Read",
            format: (v) => (v ? formatTime(v) : "unread"),
            badge: (v) => (v ? "muted" : "primary"),
          },
        ],
        rows: async () => (await manager().database.recent(100)).map((r) => ({ ...r })),
        rowActions: [
          {
            key: "delete",
            label: "Delete",
            icon: "trash",
            danger: true,
            confirm: "Delete this stored notification?",
            run: async (row) => {
              await manager().database.delete(String(row["id"]));
              return "Notification deleted.";
            },
          },
        ],
        headerActions: [
          {
            key: "prune",
            label: "Prune read (30d)",
            icon: "trash",
            danger: true,
            confirm: "Delete read notifications older than 30 days?",
            run: async () => {
              const deleted = await manager().database.prune(30);
              return `${deleted} notification(s) pruned.`;
            },
          },
        ],
      },
    ],
  });
}
