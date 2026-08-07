import { describe, it, expect, beforeEach } from "bun:test";
import { installSchedulerMonitor } from "./monitor.ts";
import { SchedulerManager } from "./SchedulerManager.ts";
import type { Application } from "@zerotal/core";

type Row = Record<string, unknown>;

/** A section as the monitor receives it, loosened for assertions. */
type Section = {
  id: string;
  label: string;
  group?: string;
  resolve(range: string): {
    stats?: Array<{ label: string; value: string | number; tone?: string; detail?: string }>;
    tables?: Array<{ title: string; rows: Row[]; columns: Array<{ key: string }> }>;
  };
};

function fakeApp(bindings: Record<string, unknown>): Application {
  return {
    container: { tryMake: (key: string) => bindings[key] ?? null },
  } as unknown as Application;
}

function panelSpy(enabled = true) {
  const sections: Section[] = [];
  return {
    sections,
    sink: { enabled: () => enabled, section: (s: Section) => sections.push(s) },
  };
}

let manager: SchedulerManager;

beforeEach(() => {
  manager = new SchedulerManager();
});

/** Install against a spy panel backed by a fresh manager, and return the section. */
function contribute(): Section {
  const spy = panelSpy();
  installSchedulerMonitor(fakeApp({ "monitor.panel": spy.sink, scheduler: manager }));
  return spy.sections[0]!;
}

describe("installSchedulerMonitor", () => {
  it("contributes nothing when no monitor panel is installed", () => {
    expect(() => installSchedulerMonitor(fakeApp({}))).not.toThrow();
  });

  it("contributes nothing when the app switched the scheduler section off", () => {
    const spy = panelSpy(false);
    installSchedulerMonitor(fakeApp({ "monitor.panel": spy.sink }));
    expect(spy.sections).toHaveLength(0);
  });

  it("registers a scheduled-tasks section under Infrastructure", () => {
    const s = contribute();
    expect(s.id).toBe("scheduler");
    expect(s.label).toBe("Scheduled tasks");
    expect(s.group).toBe("Infrastructure");
  });
});

describe("scheduler section content", () => {
  it("counts tasks, and reports none failing when nothing has run", () => {
    const s = contribute();
    const data = s.resolve("live");

    const byLabel = Object.fromEntries((data.stats ?? []).map((x) => [x.label, x]));
    expect(byLabel["Failing"]?.value).toBe(0);
    expect(byLabel["Failing"]?.tone).toBe("good");
  });

  it("lists each registered task with its cron expression", () => {
    manager.add("nightly-report", "0 2 * * *", () => {});
    manager.add("hourly-sync", "0 * * * *", () => {});

    const table = contribute().resolve("live").tables?.[0];
    expect(table?.title).toBe("Tasks");
    expect(table?.rows.map((r) => r["name"])).toEqual(["nightly-report", "hourly-sync"]);
    expect(table?.rows[0]?.["schedule"]).toBe("0 2 * * *");
  });

  it("reports a task that has never run as such, rather than as healthy", () => {
    manager.add("nightly-report", "0 2 * * *", () => {});

    const data = contribute().resolve("live");
    const table = data.tables?.[0];
    expect(table?.rows[0]?.["status"]).toBe("Never run");

    const neverRun = (data.stats ?? []).find((x) => x.label === "Never run");
    expect(neverRun?.value).toBe(1);
    expect(neverRun?.tone).toBe("warn");
  });

  it("reads the registry at resolve time, so tasks added after boot still appear", () => {
    const s = contribute();
    expect(s.resolve("live").tables?.[0]?.rows).toHaveLength(0);

    manager.add("added-later", "* * * * *", () => {});
    expect(s.resolve("live").tables?.[0]?.rows).toHaveLength(1);
  });
});
