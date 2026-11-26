/**
 * Settings: defaults, overrides per tenant and per user, hiding without deleting,
 * and tenant isolation — against every store the package has.
 *
 * The behaviour suite runs on the in-memory store, on SQLite, and on PostgreSQL
 * and MySQL when a server is configured, the same way the ORM's smoke suite does:
 *
 * ```bash
 * ZT_PG_URL=postgres://postgres:postgres@localhost:5432/zerotal_test bun test src/settings.test.ts
 * ZT_MYSQL_URL=mysql://root:root@localhost:3306/zerotal_test         bun test src/settings.test.ts
 * ```
 */
import { describe, it, expect, expectTypeOf, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { Application, currentApp } from "@zerotal/core";
import {
  _setBaseModelConnection,
  _setBaseModelDialect,
  _setDbConnection,
  Schema,
} from "@zerotal/orm";
import type { SQLInstance } from "@zerotal/orm";
import { TenantContext } from "@zerotal/tenancy";
import type { Tenant } from "@zerotal/tenancy";
import { defineSettings } from "./defineSettings.ts";
import { setting } from "./setting.ts";
import { SettingsManager } from "./SettingsManager.ts";
import { SettingsFake } from "./SettingsFake.ts";
import { MemoryStore } from "./stores/MemoryStore.ts";
import { DatabaseStore } from "./stores/DatabaseStore.ts";
import type { SettingsStore } from "./stores/SettingsStore.ts";
import { _createSettingsTable } from "./settingsSchemaConcern.ts";
import { _scopeRef } from "./scope.ts";
import {
  DuplicateSettingError,
  InvalidSettingValueError,
  SettingScopeError,
  UnknownSettingError,
} from "./errors.ts";

// ── Definitions ─────────────────────────────────────────────────────────────

const billing = defineSettings({
  "billing.invoicePrefix": setting.string({ default: "INV-", maxLength: 8 }),
  "billing.paymentTermsDays": setting.number({ default: 30, min: 0, max: 120, integer: true }),
  "billing.locale": setting.enum(["en", "fr", "de"], {
    default: "en",
    scopes: ["global", "tenant", "user"],
  }),
});

const ui = defineSettings({
  "ui.compactTables": setting.boolean({ default: false, scopes: ["tenant", "user"] }),
  "ui.dashboard": setting.json<{ widgets: string[] }>({
    default: { widgets: ["revenue"] },
    validate: (v) => (Array.isArray(v?.widgets) ? undefined : "needs a widgets list"),
  }),
  "ui.brandColour": setting.string({ default: "#000000", scopes: ["global"] }),
});

const acme: Tenant = { id: 1, slug: "acme", name: "Acme", isActive: true };
const globex: Tenant = { id: 2, slug: "globex", name: "Globex", isActive: true };

const inTenant = <T>(tenant: Tenant, fn: () => Promise<T>): Promise<T> =>
  TenantContext.run(tenant, fn);

// ── App ─────────────────────────────────────────────────────────────────────

let app: Application;
let created = false;

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

// ── Stores ──────────────────────────────────────────────────────────────────

type Engine = "memory" | "sqlite" | "postgres" | "mysql";
const ENGINES: { engine: Engine; url: string }[] = [
  { engine: "memory", url: "memory" },
  { engine: "sqlite", url: ":memory:" },
  { engine: "postgres", url: Bun.env["ZT_PG_URL"] ?? "" },
  { engine: "mysql", url: Bun.env["ZT_MYSQL_URL"] ?? "" },
];

const TABLE = "zt_settings_test";

for (const { engine, url } of ENGINES) {
  (url ? describe : describe.skip)(`settings on the ${engine} store`, () => {
    let db: SQL | undefined;
    let store: SettingsStore;
    let settings: SettingsManager;

    async function connect(): Promise<void> {
      if (engine === "memory") return;
      db = new SQL(url);
      _setBaseModelDialect(engine === "sqlite" ? "sqlite" : engine);
      _setDbConnection(db as unknown as SQLInstance);
      _setBaseModelConnection(db as unknown as SQLInstance);
    }

    beforeAll(async () => {
      await connect();
      if (db) {
        await db.unsafe(`DROP TABLE IF EXISTS ${TABLE}`);
        await _createSettingsTable(TABLE);
        // Creating it twice is a no-op: the provider does this on every boot.
        await _createSettingsTable(TABLE);
      }
    });

    afterAll(async () => {
      if (!db) return;
      await db.unsafe(`DROP TABLE IF EXISTS ${TABLE}`);
      _setDbConnection(null);
      _setBaseModelConnection(null);
      _setBaseModelDialect("sqlite");
      await db.end();
    });

    beforeEach(async () => {
      if (db) await db.unsafe(`DELETE FROM ${TABLE}`);
      store = engine === "memory" ? new MemoryStore() : new DatabaseStore(TABLE);
      settings = new SettingsManager(store, { audit: false });
      app.container.value("settings", settings);
    });

    // ── Defaults and overrides ──────────────────────────────────────────

    it("reads the default in code when nothing overrides it", async () => {
      expect(await billing.get("billing.paymentTermsDays")).toBe(30);
      expect((await billing.explain("billing.invoicePrefix")).source).toBe("default");
      expect(await ui.get("ui.dashboard")).toEqual({ widgets: ["revenue"] });
    });

    it("applies a tenant's override inside that tenant", async () => {
      await inTenant(acme, () => billing.set("billing.paymentTermsDays", 14));

      const resolved = await inTenant(acme, () => billing.explain("billing.paymentTermsDays"));
      expect(resolved.value).toBe(14);
      expect(resolved.source).toBe("tenant");
      expect(resolved.default).toBe(30);
    });

    it("reads in order: the user's override, the tenant's, the app's, then the default", async () => {
      await billing.set("billing.locale", "de"); // outside a tenant: app-wide
      expect(await billing.get("billing.locale")).toBe("de");

      await inTenant(acme, () => billing.set("billing.locale", "fr"));
      expect(await inTenant(acme, () => billing.get("billing.locale"))).toBe("fr");

      await inTenant(acme, () => billing.set("billing.locale", "en", { at: "user", user: 7 }));
      expect(await inTenant(acme, () => billing.get("billing.locale", { user: 7 }))).toBe("en");
      // Another user in the same tenant still gets the tenant's value.
      expect(await inTenant(acme, () => billing.get("billing.locale", { user: 8 }))).toBe("fr");
      // A tenant with no override of its own falls through to the app-wide one.
      expect(await inTenant(globex, () => billing.get("billing.locale"))).toBe("de");
    });

    it("reads every setting of a group at once, typed by its definitions", async () => {
      await inTenant(acme, () => billing.set("billing.invoicePrefix", "AC-"));
      const all = await inTenant(acme, () => billing.all());
      expect(all).toEqual({
        "billing.invoicePrefix": "AC-",
        "billing.paymentTermsDays": 30,
        "billing.locale": "en",
      });
    });

    it("takes the tenant and user from the call when it names them, outside any context", async () => {
      await billing.set("billing.invoicePrefix", "GX-", { tenant: 2 });
      expect(await billing.get("billing.invoicePrefix", { tenant: 2 })).toBe("GX-");
      expect(await inTenant(globex, () => billing.get("billing.invoicePrefix"))).toBe("GX-");
    });

    // ── Tenant isolation ────────────────────────────────────────────────

    it("never shows one tenant's override to another tenant", async () => {
      await inTenant(acme, async () => {
        await billing.set("billing.invoicePrefix", "ACME-");
        await billing.set("billing.paymentTermsDays", 7);
        await billing.set("billing.locale", "fr", { at: "user", user: 1 });
        await ui.set("ui.compactTables", true);
      });

      await inTenant(globex, async () => {
        // Not through get(), not through all(), and not as a stored level either.
        expect(await billing.get("billing.invoicePrefix")).toBe("INV-");
        expect(await billing.get("billing.paymentTermsDays")).toBe(30);
        expect(await ui.get("ui.compactTables")).toBe(false);
        // Same user id, different tenant: the user's override belongs to Acme.
        expect(await billing.get("billing.locale", { user: 1 })).toBe("en");
        expect(Object.values(await billing.all())).toEqual(["INV-", 30, "en"]);
        for (const key of ["billing.invoicePrefix", "billing.paymentTermsDays"] as const) {
          const resolved = await billing.explain(key);
          expect(resolved.source).toBe("default");
          expect(resolved.levels).toEqual([]);
        }
      });
    });

    it("never lets a write in one tenant change another tenant's value", async () => {
      await inTenant(acme, () => billing.set("billing.paymentTermsDays", 7));
      await inTenant(globex, () => billing.set("billing.paymentTermsDays", 60));
      await inTenant(globex, () => billing.hide("billing.paymentTermsDays"));

      expect(await inTenant(acme, () => billing.get("billing.paymentTermsDays"))).toBe(7);
      // Hiding Globex's override exposes the default to Globex, not Acme's value.
      expect(await inTenant(globex, () => billing.get("billing.paymentTermsDays"))).toBe(30);
    });

    it("cannot hide or unhide another tenant's override", async () => {
      await inTenant(acme, () => billing.set("billing.paymentTermsDays", 7));
      expect(await inTenant(globex, () => billing.hide("billing.paymentTermsDays"))).toBe(false);
      expect(await inTenant(acme, () => billing.get("billing.paymentTermsDays"))).toBe(7);
    });

    it("refuses code inside one tenant that names another, for every operation", async () => {
      // A request in Acme that passed `{ tenant: Number(body.tenantId) }` used to
      // read, write, hide and read the history of Globex's settings.
      await inTenant(globex, () => billing.set("billing.paymentTermsDays", 60));
      const other = { tenant: globex.id };

      await inTenant(acme, async () => {
        for (const attempt of [
          () => billing.get("billing.paymentTermsDays", other),
          () => billing.explain("billing.paymentTermsDays", other),
          () => billing.set("billing.paymentTermsDays", 1, other),
          () => billing.hide("billing.paymentTermsDays", other),
          () => billing.unhide("billing.paymentTermsDays", other),
          () => billing.history("billing.paymentTermsDays", other),
        ]) {
          await expect(attempt()).rejects.toBeInstanceOf(SettingScopeError);
        }
        // Naming its own tenant is not crossing anything.
        expect(await billing.get("billing.paymentTermsDays", { tenant: acme.id })).toBe(30);
      });

      expect(await inTenant(globex, () => billing.get("billing.paymentTermsDays"))).toBe(60);
    });

    it("refuses an app-wide write from inside a tenant, even when asked for", async () => {
      await inTenant(acme, async () => {
        await expect(billing.set("billing.locale", "de", { at: "global" })).rejects.toBeInstanceOf(
          SettingScopeError,
        );
      });
      expect(await billing.get("billing.locale")).toBe("en");
    });

    // ── Hide, never delete ──────────────────────────────────────────────

    it("hides an override so the next level shows through", async () => {
      await billing.set("billing.locale", "de");
      await inTenant(acme, () => billing.set("billing.locale", "fr"));

      expect(await inTenant(acme, () => billing.hide("billing.locale"))).toBe(true);
      const resolved = await inTenant(acme, () => billing.explain("billing.locale"));
      expect(resolved.value).toBe("de");
      expect(resolved.source).toBe("global");
      expect(resolved.levels.map((l) => [l.kind, l.value, l.hidden])).toEqual([
        ["tenant", "fr", true],
        ["global", "de", false],
      ]);
    });

    it("keeps a hidden value: it is still stored, and unhiding puts it back", async () => {
      await inTenant(acme, () => billing.set("billing.invoicePrefix", "ACME-"));
      await inTenant(acme, () => billing.hide("billing.invoicePrefix"));

      const [row] = await store.find(["billing.invoicePrefix"], ["tenant:1"]);
      expect(row).toMatchObject({ value: '"ACME-"', hidden: true, tenantId: 1 });

      expect(await inTenant(acme, () => billing.unhide("billing.invoicePrefix"))).toBe(true);
      expect(await inTenant(acme, () => billing.get("billing.invoicePrefix"))).toBe("ACME-");
    });

    it("offers no way to delete an override", () => {
      const surfaces: object[] = [settings, store, billing];
      for (const surface of surfaces) {
        for (const name of ["delete", "forget", "remove", "destroy", "clear", "unset", "reset"]) {
          expect(name in surface).toBe(false);
        }
      }
    });

    it("writing over a hidden override makes it apply again, with the new value", async () => {
      await inTenant(acme, async () => {
        await billing.set("billing.paymentTermsDays", 7);
        await billing.hide("billing.paymentTermsDays");
        await billing.set("billing.paymentTermsDays", 21);
        expect(await billing.get("billing.paymentTermsDays")).toBe(21);
      });
      const rows = await store.find(["billing.paymentTermsDays"], ["tenant:1"]);
      expect(rows).toHaveLength(1);
    });

    it("says false when there is nothing at that level to hide", async () => {
      expect(await inTenant(acme, () => billing.hide("billing.paymentTermsDays"))).toBe(false);
      expect(await billing.unhide("billing.paymentTermsDays")).toBe(false);
    });

    // ── Validation and levels ───────────────────────────────────────────

    it("refuses a value its definition does not accept, and stores nothing", async () => {
      await expect(
        inTenant(acme, () => billing.set("billing.paymentTermsDays", 500)),
      ).rejects.toBeInstanceOf(InvalidSettingValueError);
      await expect(
        inTenant(acme, () => billing.set("billing.invoicePrefix", "FAR-TOO-LONG")),
      ).rejects.toThrow(/longer than 8/);
      await expect(
        ui.set("ui.dashboard", { widgets: "revenue" } as never, { tenant: 1 }),
      ).rejects.toThrow(/needs a widgets list/);
      expect(await store.find(["billing.paymentTermsDays", "ui.dashboard"], ["tenant:1"])).toEqual(
        [],
      );
    });

    it("parses text from a form into the setting's type", async () => {
      await settings.setFromText("billing.paymentTermsDays", "45", { tenant: 1 });
      await settings.setFromText("ui.compactTables", "true", { tenant: 1 });
      await settings.setFromText("ui.dashboard", '{"widgets":["churn"]}', { tenant: 1 });
      expect(await billing.get("billing.paymentTermsDays", { tenant: 1 })).toBe(45);
      expect(await ui.get("ui.compactTables", { tenant: 1 })).toBe(true);
      expect(await ui.get("ui.dashboard", { tenant: 1 })).toEqual({ widgets: ["churn"] });
    });

    it("writes only at the levels a setting allows, and only where they exist", async () => {
      // App-wide only: no tenant may override the brand colour.
      await expect(
        inTenant(acme, () => ui.set("ui.brandColour", "#ff0000")),
      ).rejects.toBeInstanceOf(SettingScopeError);
      await ui.set("ui.brandColour", "#ff0000"); // outside a tenant, app-wide
      expect(await inTenant(acme, () => ui.get("ui.brandColour"))).toBe("#ff0000");

      // Tenant and user only, so outside a tenant there is nowhere to write.
      await expect(ui.set("ui.compactTables", true)).rejects.toThrow(/no tenant here/);
      // A user override needs a user.
      await expect(
        inTenant(acme, () => billing.set("billing.locale", "fr", { at: "user" })),
      ).rejects.toThrow(/no signed-in user/);
      // Not every setting is per-user.
      await expect(
        inTenant(acme, () => billing.set("billing.invoicePrefix", "X", { at: "user", user: 1 })),
      ).rejects.toThrow(/cannot be overridden per user/);
    });

    it("skips a stored value that no longer fits its definition, falling to the next level", async () => {
      await store.put("billing.paymentTermsDays", _scopeRef("tenant", 1, null), "999", null);
      const resolved = await billing.explain("billing.paymentTermsDays", { tenant: 1 });
      expect(resolved.value).toBe(30);
      expect(resolved.source).toBe("default");
      expect(resolved.levels[0]!.value).toBeUndefined();
    });
  });
}

// ── Registry ────────────────────────────────────────────────────────────────

describe("declaring settings", () => {
  it("refuses a key declared twice with different definitions", () => {
    expect(() =>
      defineSettings({ "billing.invoicePrefix": setting.string({ default: "X" }) }),
    ).toThrow(DuplicateSettingError);
  });

  it("refuses a default its own definition would reject", () => {
    expect(() => setting.number({ default: 5, min: 10 })).toThrow(InvalidSettingValueError);
  });

  it("names an undeclared key", async () => {
    app.container.value("settings", new SettingsManager(new MemoryStore()));
    await expect(
      (billing as unknown as { get(k: string): Promise<unknown> }).get("billing.nope"),
    ).rejects.toBeInstanceOf(UnknownSettingError);
  });
});

// ── The test helper ─────────────────────────────────────────────────────────

describe("SettingsFake", () => {
  let fake: SettingsFake | undefined;
  beforeEach(() => {
    fake?.restore();
    fake = undefined;
  });

  it("pins a setting for every reader, whatever is stored", async () => {
    fake = SettingsFake.install({ "billing.paymentTermsDays": 7 });
    await inTenant(acme, () => billing.set("billing.paymentTermsDays", 60));

    expect(await inTenant(acme, () => billing.get("billing.paymentTermsDays"))).toBe(7);
    expect(await inTenant(globex, () => billing.get("billing.paymentTermsDays"))).toBe(7);
    expect((await billing.explain("billing.paymentTermsDays")).source).toBe("override");

    fake.release("billing.paymentTermsDays");
    expect(await inTenant(acme, () => billing.get("billing.paymentTermsDays"))).toBe(60);
  });

  it("refuses to pin a value the app could never hold", () => {
    fake = SettingsFake.install();
    expect(() => fake!.override("billing.paymentTermsDays", -1)).toThrow(InvalidSettingValueError);
    expect(() => fake!.override("billing.nope", 1)).toThrow(UnknownSettingError);
  });

  it("runs tenant overrides and hiding in memory, with no table", async () => {
    fake = SettingsFake.install();
    await inTenant(acme, async () => {
      await billing.set("billing.invoicePrefix", "AC-");
      await billing.hide("billing.invoicePrefix");
    });
    expect(fake.stored()).toMatchObject([
      { key: "billing.invoicePrefix", scope: "tenant:1", hidden: true },
    ]);
    expect(await inTenant(acme, () => billing.get("billing.invoicePrefix"))).toBe("INV-");
  });

  it("given its groups, takes only their keys, each as its declared type", async () => {
    const typed = SettingsFake.install(billing, { "billing.paymentTermsDays": 7 });
    fake = typed;
    expectTypeOf<Parameters<typeof typed.override>[0]>().toEqualTypeOf<
      "billing.invoicePrefix" | "billing.paymentTermsDays" | "billing.locale"
    >();

    typed.override("billing.locale", "fr");
    // @ts-expect-error — a key the group does not declare
    expect(() => typed.override("billing.nope", 1)).toThrow(UnknownSettingError);
    // @ts-expect-error — a number setting given a string
    expect(() => typed.override("billing.paymentTermsDays", "7")).toThrow(InvalidSettingValueError);
    // @ts-expect-error — not one of the enum's values
    expect(() => typed.override("billing.locale", "es")).toThrow(InvalidSettingValueError);
    // @ts-expect-error — a key the group does not declare
    typed.release("ui.compactTables");

    expect(await billing.get("billing.paymentTermsDays")).toBe(7);
    expect(await billing.get("billing.locale")).toBe("fr");
  });

  it("given several groups, takes the keys of all of them", async () => {
    const typed = SettingsFake.install([billing, ui], {
      "billing.invoicePrefix": "AC-",
      "ui.compactTables": true,
    });
    fake = typed;
    typed.override("ui.dashboard", { widgets: [] });
    // @ts-expect-error — the JSON setting's declared shape
    expect(() => typed.override("ui.dashboard", { widgets: "all" })).toThrow();
    // @ts-expect-error — a boolean setting given a string
    expect(() => SettingsFake.install([billing, ui], { "ui.compactTables": "yes" })).toThrow(
      InvalidSettingValueError,
    );

    expect(await billing.get("billing.invoicePrefix")).toBe("AC-");
    expect(await ui.get("ui.dashboard")).toEqual({ widgets: [] });
  });

  it("puts the original binding back on restore", () => {
    const original = new SettingsManager(new MemoryStore());
    app.container.value("settings", original);
    const installed = SettingsFake.install();
    expect(app.container.makeSync("settings")).toBe(installed);
    installed.restore();
    expect(app.container.makeSync("settings")).toBe(original);
  });
});

// ── Audit ───────────────────────────────────────────────────────────────────

describe("settings and @zerotal/audit", () => {
  let db: SQL;

  beforeAll(async () => {
    const { Auditor, DatabaseDriver } = await import("@zerotal/audit");
    db = new SQL(":memory:");
    _setBaseModelDialect("sqlite");
    _setDbConnection(db as unknown as SQLInstance);
    _setBaseModelConnection(db as unknown as SQLInstance);
    await _createSettingsTable(TABLE);
    await Schema.create("audit_logs", (t) => {
      t.increments("id");
      t.string("event");
      t.string("auditable_type");
      t.string("auditable_id").nullable();
      t.string("actor_type").nullable();
      t.integer("actor_id").nullable();
      t.text("old_values").nullable();
      t.text("new_values").nullable();
      t.text("tags").nullable();
      t.string("ip_address").nullable();
      t.string("user_agent").nullable();
      t.string("url").nullable();
      t.timestamp("created_at").nullable();
    });
    const auditor = new Auditor(new DatabaseDriver("audit_logs"), {
      driver: "database",
      captureRequest: false,
    });
    app.container.value("audit" as never, auditor as never);
    app.container.value("settings", new SettingsManager(new DatabaseStore(TABLE)));
  });

  afterAll(async () => {
    app.container.registry.delete("audit");
    _setDbConnection(null);
    _setBaseModelConnection(null);
    await db.end();
  });

  it("records each change at its level, and reads the history back per tenant", async () => {
    await inTenant(acme, async () => {
      await billing.set("billing.paymentTermsDays", 14);
      await billing.set("billing.paymentTermsDays", 21);
      await billing.hide("billing.paymentTermsDays");
      await billing.unhide("billing.paymentTermsDays");
    });

    const history = await inTenant(acme, () => billing.history("billing.paymentTermsDays"));
    expect(history.map((h) => [h.event, h.from, h.to])).toEqual([
      ["setting.unhidden", undefined, 21],
      ["setting.hidden", 21, undefined],
      ["setting.updated", 14, 21],
      ["setting.updated", undefined, 14],
    ]);

    // Globex's trail is its own, and empty.
    expect(await inTenant(globex, () => billing.history("billing.paymentTermsDays"))).toEqual([]);
  });

  it("records nothing, and reads no history, when auditing is switched off", async () => {
    app.container.value(
      "settings",
      new SettingsManager(new DatabaseStore(TABLE), { audit: false }),
    );
    await billing.set("billing.invoicePrefix", "OFF-");
    expect(await billing.history("billing.invoicePrefix")).toEqual([]);
  });
});
