import { describe, it, expect, beforeEach } from "bun:test";
import { MonitorPanel } from "./panel.ts";
import type { MonitorSection } from "./panel.ts";

const section = (id: string, overrides: Partial<MonitorSection> = {}): MonitorSection => ({
  id,
  label: id,
  resolve: () => ({ stats: [{ label: "Tasks", value: 1 }] }),
  ...overrides,
});

beforeEach(() => MonitorPanel.reset());

describe("MonitorPanel", () => {
  it("registers a contributed section and resolves it by id", () => {
    MonitorPanel.host().section(section("scheduler", { label: "Scheduled tasks" }));

    expect(MonitorPanel.find("scheduler")?.label).toBe("Scheduled tasks");
    expect(MonitorPanel.sections()).toHaveLength(1);
  });

  it("is idempotent by id, so a provider booting twice doesn't duplicate a section", () => {
    MonitorPanel.host().section(section("scheduler"));
    MonitorPanel.host().section(section("scheduler"));

    expect(MonitorPanel.sections()).toHaveLength(1);
  });

  it("sorts by weight, breaking ties alphabetically", () => {
    const host = MonitorPanel.host();
    host.section(section("b", { label: "B", sort: 10 }));
    host.section(section("a", { label: "A", sort: 10 }));
    host.section(section("c", { label: "C", sort: 1 }));

    expect(MonitorPanel.sections().map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("reports a contributor as disabled when config switches it off", () => {
    MonitorPanel.configure({ scheduler: false });

    expect(MonitorPanel.host().enabled("scheduler")).toBe(false);
    expect(MonitorPanel.host().enabled("queue")).toBe(true);
  });

  it("treats every contributor as enabled when nothing is configured", () => {
    expect(MonitorPanel.host().enabled("anything")).toBe(true);
  });

  it("resolves a section's content for the requested range", async () => {
    let seen = "";
    MonitorPanel.host().section(
      section("scheduler", {
        resolve: (range) => {
          seen = range;
          return { stats: [{ label: "Tasks", value: 3 }] };
        },
      }),
    );

    const data = await MonitorPanel.find("scheduler")!.resolve("24h");
    expect(seen).toBe("24h");
    expect(data.stats?.[0]?.value).toBe(3);
  });
});
