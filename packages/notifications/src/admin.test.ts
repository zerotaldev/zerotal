import { describe, it, expect, beforeEach } from "bun:test";
import { installNotificationsAdmin } from "./admin.ts";
import { _resetStats, installNotificationStats } from "./stats.ts";
import { FrameworkEvents } from "@zerotal/core";
import { NotificationSent } from "./events.ts";
import type { Application } from "@zerotal/core";

type Row = Record<string, unknown>;

interface CapturedConsole {
  slug: string;
  title: string;
  ability: string;
  navigationBadge?: () => Promise<string | number | null>;
  tabs: Array<{
    key: string;
    rows: () => Promise<Row[]>;
    headerActions?: Array<{ key: string; run: () => Promise<string | void> }>;
    rowActions?: Array<{ key: string; run: (row: Row) => Promise<string | void> }>;
    columns: Array<{ key: string; format?: (v: unknown, row: Row) => string }>;
  }>;
}

/** A container stub exposing only what the contribution reads. */
function makeApp(options: {
  panelEnabled?: boolean;
  noPanel?: boolean;
  database?: Record<string, unknown>;
}): { app: Application; consoles: CapturedConsole[] } {
  const consoles: CapturedConsole[] = [];
  const panel = {
    enabled: () => options.panelEnabled ?? true,
    console: (c: CapturedConsole) => consoles.push(c),
  };

  const app = {
    container: {
      tryMake: (key: string) => (key === "admin.panel" && !options.noPanel ? panel : undefined),
      makeSync: () => ({ database: options.database ?? {} }),
    },
  } as unknown as Application;

  return { app, consoles };
}

let dispose: (() => void) | undefined;

beforeEach(() => {
  dispose?.();
  _resetStats();
  dispose = installNotificationStats();
});

describe("installNotificationsAdmin", () => {
  it("does nothing when no admin panel is installed", () => {
    const { app, consoles } = makeApp({ noPanel: true });
    expect(() => installNotificationsAdmin(app)).not.toThrow();
    expect(consoles).toHaveLength(0);
  });

  it("does nothing when the contributor is switched off", () => {
    const { app, consoles } = makeApp({ panelEnabled: false });
    installNotificationsAdmin(app);
    expect(consoles).toHaveLength(0);
  });

  it("registers a console gated on the notifications.view ability", () => {
    const { app, consoles } = makeApp({});
    installNotificationsAdmin(app);

    expect(consoles).toHaveLength(1);
    expect(consoles[0]!.slug).toBe("notifications");
    expect(consoles[0]!.ability).toBe("notifications.view");
    expect(consoles[0]!.tabs.map((t) => t.key)).toEqual(["recent", "channels", "stored"]);
  });

  it("badges the sidebar only while there are failures", async () => {
    const { app, consoles } = makeApp({});
    installNotificationsAdmin(app);
    const badge = consoles[0]!.navigationBadge!;

    expect(await badge()).toBeNull();

    FrameworkEvents.emit(new NotificationSent("X", "slack", "a@b.test", false, 1, "boom"));
    expect(await badge()).toBe(1);
  });

  it("projects recent deliveries into rows", async () => {
    const { app, consoles } = makeApp({});
    installNotificationsAdmin(app);

    FrameworkEvents.emit(new NotificationSent("OrderShipped", "mail", "a@b.test", true, 12));
    FrameworkEvents.emit(
      new NotificationSent("OrderShipped", "slack", "a@b.test", false, 4, "500"),
    );

    const rows = await consoles[0]!.tabs[0]!.rows();
    expect(rows).toHaveLength(2);
    // Newest first.
    expect(rows[0]!["channel"]).toBe("slack");
    expect(rows[0]!["ok"]).toBe(false);
    expect(rows[0]!["error"]).toBe("500");
  });

  it("summarises per-channel totals", async () => {
    const { app, consoles } = makeApp({});
    installNotificationsAdmin(app);

    FrameworkEvents.emit(new NotificationSent("X", "mail", "a@b.test", true, 10));
    FrameworkEvents.emit(new NotificationSent("X", "mail", "a@b.test", true, 20));
    FrameworkEvents.emit(new NotificationSent("X", "mail", "a@b.test", false, 5, "nope"));

    const rows = await consoles[0]!.tabs[1]!.rows();
    expect(rows[0]).toMatchObject({ channel: "mail", sent: 2, failed: 1, avgMs: 15 });
  });

  it("wires the stored tab to the database channel", async () => {
    const pruned: number[] = [];
    const deleted: string[] = [];
    const { app, consoles } = makeApp({
      database: {
        recent: async () => [{ id: "abc", type: "OrderShipped" }],
        prune: async (days: number) => {
          pruned.push(days);
          return 7;
        },
        delete: async (id: string) => {
          deleted.push(id);
        },
      },
    });
    installNotificationsAdmin(app);
    const stored = consoles[0]!.tabs[2]!;

    expect(await stored.rows()).toEqual([{ id: "abc", type: "OrderShipped" }]);

    const message = await stored.headerActions![0]!.run();
    expect(pruned).toEqual([30]);
    expect(message).toBe("7 notification(s) pruned.");

    await stored.rowActions![0]!.run({ id: "abc" });
    expect(deleted).toEqual(["abc"]);
  });

  it("renders an unread row as unread rather than a blank cell", async () => {
    const { app, consoles } = makeApp({ database: { recent: async () => [] } });
    installNotificationsAdmin(app);

    const readColumn = consoles[0]!.tabs[2]!.columns.find((c) => c.key === "read_at")!;
    expect(readColumn.format!(null, {})).toBe("unread");
  });
});
