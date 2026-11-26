/**
 * The generated settings screen, as the data the admin panel renders: every
 * declared setting is a row, "Change" writes at the level the panel is looking
 * at, and hiding keeps the value. Rendering the console is the admin package's
 * job and is tested there (`ConsolePage.input.test.ts`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Application, currentApp } from "@zerotal/core";
import { TenantContext } from "@zerotal/tenancy";
import type { Tenant } from "@zerotal/tenancy";
import { _installSettingsAdmin, _settingsConsole, SETTINGS_ABILITY } from "./admin.ts";
import { defineSettings } from "./defineSettings.ts";
import { setting } from "./setting.ts";
import { SettingsManager } from "./SettingsManager.ts";
import { MemoryStore } from "./stores/MemoryStore.ts";

const screen = defineSettings({
  "screen.title": setting.string({ default: "Dashboard", label: "Page title", group: "Display" }),
  "screen.rows": setting.number({ default: 25, min: 5, max: 100 }),
  "screen.dense": setting.boolean({ default: false }),
  "screen.theme": setting.enum(["light", "dark"], { default: "light" }),
});

const acme: Tenant = { id: 1, slug: "acme", name: "Acme", isActive: true };
const globex: Tenant = { id: 2, slug: "globex", name: "Globex", isActive: true };

let app: Application;
let created = false;
let settings: SettingsManager;

beforeAll(() => {
  try {
    app = Application.create({ env: "test" });
    created = true;
  } catch {
    app = currentApp();
  }
});

afterAll(() => {
  if (created) Application._resetInstance();
});

beforeEach(() => {
  settings = new SettingsManager(new MemoryStore(), { audit: false });
  app.container.value("settings", settings);
});

const spec = () => _settingsConsole(() => settings);
const tab = (key: string) => spec().tabs.find((t) => t.key === key)!;
const action = (tabKey: string, key: string) => tab(tabKey).rowActions!.find((a) => a.key === key)!;
const row = async (key: string) => (await tab("settings").rows()).find((r) => r["key"] === key)!;

describe("the generated settings screen", () => {
  it("is gated on its own ability", () => {
    expect(spec().ability).toBe(SETTINGS_ABILITY);
  });

  it("lists every declared setting with its value and where it came from", async () => {
    const rows = await tab("settings").rows();
    const title = rows.find((r) => r["key"] === "screen.title")!;
    expect(title).toMatchObject({
      label: "Page title",
      group: "Display",
      value: "Dashboard",
      source: "default",
    });
    // Ungrouped settings are filed under the first segment of their key.
    expect(rows.find((r) => r["key"] === "screen.rows")!["group"]).toBe("screen");
  });

  it("fills the field from the value, and offers choices for booleans and enums", async () => {
    const change = action("settings", "change");
    expect(change.input!.value!(await row("screen.rows"))).toBe("25");
    expect(change.input!.options!(await row("screen.dense"))).toEqual(["true", "false"]);
    expect(change.input!.options!(await row("screen.theme"))).toEqual(["light", "dark"]);
    expect(change.input!.options!(await row("screen.title"))).toEqual([]);
  });

  it("changes a setting for the tenant the panel is in, and no other", async () => {
    await TenantContext.run(acme, async () => {
      const message = await action("settings", "change").run(await row("screen.rows"), "50");
      expect(message).toContain("tenant Acme");
      expect((await row("screen.rows"))["source"]).toBe("tenant");
    });
    expect(await TenantContext.run(acme, () => screen.get("screen.rows"))).toBe(50);
    expect(await TenantContext.run(globex, () => screen.get("screen.rows"))).toBe(25);
  });

  it("refuses a value the definition does not accept", async () => {
    await expect(
      TenantContext.run(acme, async () =>
        action("settings", "change").run(await row("screen.rows"), "1000"),
      ),
    ).rejects.toThrow(/more than 100/);
  });

  it("hides an override, keeps it under Hidden, and unhides it", async () => {
    await TenantContext.run(acme, async () => {
      await screen.set("screen.theme", "dark");
      await action("settings", "hide").run(await row("screen.theme"));
      expect(await screen.get("screen.theme")).toBe("light");

      const hidden = await tab("hidden").rows();
      expect(hidden).toEqual([
        expect.objectContaining({ key: "screen.theme", level: "tenant", value: "dark" }),
      ]);

      await action("hidden", "unhide").run(hidden[0]!);
      expect(await screen.get("screen.theme")).toBe("dark");
      expect(await tab("hidden").rows()).toEqual([]);
    });
  });

  it("says so when there is no override to hide", async () => {
    await expect(
      TenantContext.run(acme, async () =>
        action("settings", "hide").run(await row("screen.title")),
      ),
    ).rejects.toThrow(/no override for tenant Acme to hide/);
  });

  it("writes app-wide outside a tenant", async () => {
    const message = await action("settings", "change").run(await row("screen.title"), "Home");
    expect(message).toContain("the whole app");
    expect(await TenantContext.run(acme, () => screen.get("screen.title"))).toBe("Home");
  });
});

describe("contributing the screen", () => {
  it("adds it to the panel when one is installed and has not switched it off", () => {
    const consoles: unknown[] = [];
    const panel = {
      enabled: (id: string) => id === "settings",
      console: (c: unknown) => consoles.push(c),
    };
    app.container.value("admin.panel" as never, panel as never);
    try {
      _installSettingsAdmin(app);
      expect(consoles).toHaveLength(1);
    } finally {
      app.container.registry.delete("admin.panel");
    }
  });

  it("adds nothing when the panel switched it off", () => {
    const consoles: unknown[] = [];
    app.container.value(
      "admin.panel" as never,
      { enabled: () => false, console: (c: unknown) => consoles.push(c) } as never,
    );
    try {
      _installSettingsAdmin(app);
      expect(consoles).toHaveLength(0);
    } finally {
      app.container.registry.delete("admin.panel");
    }
  });

  it("does nothing without an admin panel", () => {
    expect(() => _installSettingsAdmin(app)).not.toThrow();
  });
});
