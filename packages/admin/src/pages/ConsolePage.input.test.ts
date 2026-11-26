/**
 * A console row action that asks for a value: the field opens filled from the
 * row, the submitted value reaches `run`, and the ability is checked on every
 * call the client can make — opening, submitting and the plain row dispatcher.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { FlowTest } from "@zerotal/flow/testing";
import { Panel } from "../Panel.ts";
import { makeConsolePage } from "./ConsolePage.tsx";
import type { ConsoleContribution, ConsoleRow } from "../plugin.ts";

const ORIGINAL_ENV = Bun.env["APP_ENV"];

let saved: Array<{ key: unknown; value: string | undefined }>;
let rows: ConsoleRow[];

function settingsConsole(): ConsoleContribution {
  return {
    slug: "settings",
    title: "Settings",
    ability: "settings.manage",
    tabs: [
      {
        key: "all",
        label: "All",
        rowKey: "key",
        columns: [
          { key: "key", label: "Key" },
          { key: "value", label: "Value" },
        ],
        rows: () => rows,
        rowActions: [
          {
            key: "change",
            label: "Change",
            input: {
              label: "New value",
              value: (row) => String(row["value"]),
              options: (row) => (row["key"] === "mode" ? ["light", "dark"] : []),
              help: () => "Saved for this tenant.",
            },
            run: (row, value) => {
              saved.push({ key: row["key"], value });
              return `${String(row["key"])} saved`;
            },
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  Panel.reset();
  Bun.env["APP_ENV"] = "test";
  saved = [];
  rows = [
    { key: "prefix", value: "INV-" },
    { key: "mode", value: "light" },
  ];
});

afterEach(() => {
  Panel.reset();
  if (ORIGINAL_ENV === undefined) delete Bun.env["APP_ENV"];
  else Bun.env["APP_ENV"] = ORIGINAL_ENV;
});

describe("console row actions that ask for a value", () => {
  it("opens a field filled from the row, and runs the action with what was submitted", async () => {
    Panel.configure({ authorize: () => true });
    const t = await FlowTest.mount(makeConsolePage(settingsConsole(), Panel.current()));

    await t.call("openInput", "change", "prefix");
    t.assertSee("New value");
    t.assertSee("Saved for this tenant.");
    expect(t.html()).toContain('value="INV-"');

    await t.set("inputValue", "BILL-");
    await t.call("submitInput");

    expect(saved).toEqual([{ key: "prefix", value: "BILL-" }]);
    expect(t.page().editing).toEqual([]);
    t.assertFlashed("success", "prefix saved");
  });

  it("offers a select when the action gives choices for the row", async () => {
    Panel.configure({ authorize: () => true });
    const t = await FlowTest.mount(makeConsolePage(settingsConsole(), Panel.current()));
    await t.call("openInput", "change", "mode");
    expect(t.html()).toContain("<select");
    expect(t.html()).toContain(">dark</option>");
  });

  it("does not run an input action through the plain row dispatcher, without a value", async () => {
    Panel.configure({ authorize: () => true });
    const t = await FlowTest.mount(makeConsolePage(settingsConsole(), Panel.current()));
    await t.call("runRowAction", "change", "prefix");
    expect(saved).toEqual([]);
  });

  it("closes the field on cancel without running anything", async () => {
    Panel.configure({ authorize: () => true });
    const t = await FlowTest.mount(makeConsolePage(settingsConsole(), Panel.current()));
    await t.call("openInput", "change", "prefix");
    await t.call("cancelInput");
    expect(t.html()).not.toContain("New value");
    expect(saved).toEqual([]);
  });

  it("checks the ability when the value is submitted, not only when the page loads", async () => {
    let allowed = true;
    Panel.configure({ authorize: () => allowed });
    const t = await FlowTest.mount(makeConsolePage(settingsConsole(), Panel.current()));
    await t.call("openInput", "change", "prefix");

    allowed = false;
    t.tolerateErrors();
    await t.call("submitInput");
    t.assertErrored();
    expect(saved).toEqual([]);
  });
});
