import { describe, it, expect, beforeAll } from "bun:test";
import { SQL } from "bun";
import { BaseModel, Schema, _setBaseModelConnection, _setDbConnection } from "@zerotal/orm";
import { Auditor } from "./Auditor.ts";
import { AuditLog } from "./AuditLog.ts";
import { Auditable } from "./Auditable.ts";
import { auditSchemaConcern } from "./auditSchemaConcern.ts";
import { NullDriver } from "./drivers/NullDriver.ts";
import { AuditConfig } from "./config.ts";
import { AuditObserver } from "./AuditObserver.ts";
import type { AuditDriver } from "./drivers/AuditDriver.ts";
import type { AuditPayload, AuditRecord, AuditConfigShape } from "./types.ts";

class FakeDriver implements AuditDriver {
  records: AuditPayload[] = [];
  forModelArgs: Array<[string, string | number, number | undefined]> = [];
  async record(p: AuditPayload): Promise<void> {
    this.records.push(p);
  }
  async forModel(type: string, id: string | number, limit?: number): Promise<AuditRecord[]> {
    this.forModelArgs.push([type, id, limit]);
    return [];
  }
}
class ThrowingDriver implements AuditDriver {
  async record(): Promise<void> {
    throw new Error("db down");
  }
  async forModel(): Promise<AuditRecord[]> {
    return [];
  }
}
const cfg = (over: Partial<AuditConfigShape> = {}): AuditConfigShape => ({
  driver: "database",
  table: "audit_logs",
  pruneKeep: 0,
  captureRequest: false,
  ...over,
});

describe("Auditor", () => {
  it("records a manual event, merging the event name into the payload", async () => {
    const d = new FakeDriver();
    await new Auditor(d, cfg()).log("login.success", { auditable_type: "User", auditable_id: 7 });
    expect(d.records).toHaveLength(1);
    expect(d.records[0]!.event).toBe("login.success");
    expect(d.records[0]!.auditable_type).toBe("User");
  });

  it("derives auditable_type/id from a model instance passed to log()", async () => {
    class Widget extends BaseModel {}
    const w = new Widget();
    (w as unknown as { id: number }).id = 42;
    const d = new FakeDriver();
    await new Auditor(d, cfg()).log("login.success", w, { tags: { k: 1 } });
    expect(d.records[0]!.auditable_type).toBe("Widget");
    expect(d.records[0]!.auditable_id).toBe("42");
    expect(d.records[0]!.tags).toEqual({ k: 1 });
  });

  it("delegates historyFor to the driver with the limit", async () => {
    const d = new FakeDriver();
    await new Auditor(d, cfg()).historyFor("User", 7, 25);
    expect(d.forModelArgs[0]).toEqual(["User", 7, 25]);
  });

  it("never throws when the driver fails — auditing must not crash the app", async () => {
    const a = new Auditor(new ThrowingDriver(), cfg());
    await expect(a.log("x", { auditable_type: "Y" })).resolves.toBeUndefined();
  });
});

describe("Querying — Audit.logs / instance auditLogs (in-memory DB)", () => {
  const auditor = () => new Auditor(new NullDriver(), cfg());

  beforeAll(async () => {
    const db = new SQL(":memory:");
    _setBaseModelConnection(db);
    _setDbConnection(db);
    await Schema.create("audit_logs", (table) => {
      table.increments("id");
      table.string("event");
      table.string("auditable_type");
      table.string("auditable_id").nullable();
      table.string("actor_type").nullable();
      table.integer("actor_id").nullable();
      table.text("old_values").nullable();
      table.text("new_values").nullable();
      table.text("tags").nullable();
      table.string("ip_address").nullable();
      table.string("user_agent").nullable();
      table.string("url").nullable();
      table.string("created_at").nullable();
    });
    const at = new Date();
    await AuditLog.create({
      event: "created",
      auditableType: "User",
      auditableId: "1",
      actorId: 1,
      createdAt: at,
    });
    await AuditLog.create({
      event: "login.success",
      auditableType: "User",
      auditableId: "1",
      actorId: 9,
      createdAt: at,
    });
    await AuditLog.create({
      event: "created",
      auditableType: "Report",
      auditableId: "5",
      actorId: 1,
      createdAt: at,
    });
  });

  it("logs(type, id) scopes to a model instance; desc() returns newest-first", async () => {
    const rows = await auditor().logs("User", 1).desc().get();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.event).toBe("login.success"); // highest id first
  });

  it("logs(ModelClass, id) derives the auditable_type from the class name", async () => {
    class Report extends BaseModel {}
    const rows = await auditor().logs(Report, 5).get();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.auditableType).toBe("Report");
  });

  it("logsByActor + logsOfEvent scope correctly", async () => {
    expect(await auditor().logsByActor(1).get()).toHaveLength(2);
    expect(await auditor().logsOfEvent("login.success").get()).toHaveLength(1);
  });

  it("logs() returns a chainable builder (limit + paginate)", async () => {
    const one = await auditor().logs("User", 1).desc().limit(1).get();
    expect(one).toHaveLength(1);
    const page = await auditor().logs("User", 1).orderBy("id", "desc").paginate(1, 1);
    expect(page.total).toBe(2);
    expect(page.data).toHaveLength(1);
    expect(page.lastPage).toBe(2);
  });

  it("instance auditLogs() scopes to that instance", async () => {
    class User extends Auditable(BaseModel) {}
    const u = new User();
    (u as unknown as { id: number }).id = 1;
    const rows = await u.auditLogs().desc().get();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.auditableType).toBe("User");
  });
});

describe("auditSchemaConcern — provisions audit_logs on boot", () => {
  const ctxWith = (driver: string) =>
    ({
      resolve: <T>(token: string): T | undefined =>
        token === "config"
          ? ({
              get: (p: string, d?: unknown) => (p === "audit.driver" ? driver : d),
            } as unknown as T)
          : undefined,
    }) as never;

  it("creates the table when missing, idempotently", async () => {
    const db = new SQL(":memory:");
    _setBaseModelConnection(db);
    _setDbConnection(db);

    expect(await Schema.hasTable("audit_logs")).toBe(false);
    await auditSchemaConcern.run!(ctxWith("database"));
    expect(await Schema.hasTable("audit_logs")).toBe(true);
    // Running again is a safe no-op.
    await auditSchemaConcern.run!(ctxWith("database"));
    expect(await Schema.hasTable("audit_logs")).toBe(true);
  });

  it("skips creation for the null driver", async () => {
    const db = new SQL(":memory:");
    _setBaseModelConnection(db);
    _setDbConnection(db);
    await auditSchemaConcern.run!(ctxWith("null"));
    expect(await Schema.hasTable("audit_logs")).toBe(false);
  });
});

describe("NullDriver", () => {
  it("records nothing and returns no history", async () => {
    const d = new NullDriver();
    await d.record({ event: "x", auditable_type: "Y" } as AuditPayload);
    expect(await d.forModel("Y", 1)).toEqual([]);
  });
});

describe("AuditConfig", () => {
  it("applies defaults inside the namespaced block", () => {
    const c = AuditConfig();
    expect(c.audit.driver).toBe("database");
    expect(c.audit.table).toBe("audit_logs");
    expect(c.audit.captureRequest).toBe(true);
  });
  it("respects overrides", () => {
    expect(AuditConfig({ driver: "null" }).audit.driver).toBe("null");
  });
});

// The Auditable mixin attaches hooks to the (anonymous) mixin class, but the
// observer reads config + the logged type name from the concrete subclass's
// constructor PER EVENT — so the real class name and any overridden statics win.
describe("AuditObserver — static config from the model constructor", () => {
  function fakeAuditor(): { payloads: any[]; _recordModel: (p: any) => Promise<void> } {
    const payloads: any[] = [];
    return {
      payloads,

      _recordModel: async (p: any) => {
        payloads.push(p);
      },
    };
  }

  it("defaults auditable_type to the concrete class name", async () => {
    class User {
      id = 1;
      toJSON() {
        return { id: 1, name: "Ada", password: "x" };
      }
    }
    const a = fakeAuditor();
    await new AuditObserver(a as never).created(new User() as never);
    expect(a.payloads[0].auditable_type).toBe("User");
    expect(a.payloads[0].new_values).toEqual({ id: 1, name: "Ada", password: "x" });
  });

  it("honors static auditExcept (scrubs columns)", async () => {
    class User {
      static auditExcept = ["password"];
      id = 1;
      toJSON() {
        return { id: 1, name: "Ada", password: "x" };
      }
    }
    const a = fakeAuditor();
    await new AuditObserver(a as never).created(new User() as never);
    expect(a.payloads[0].new_values).toEqual({ id: 1, name: "Ada" });
  });

  it("honors static auditOnly (allowlist wins over except)", async () => {
    class User {
      static auditOnly = ["name"];
      static auditExcept = ["name"];
      id = 1;
      toJSON() {
        return { id: 1, name: "Ada", password: "x" };
      }
    }
    const a = fakeAuditor();
    await new AuditObserver(a as never).deleted(new User() as never);
    expect(a.payloads[0].old_values).toEqual({ name: "Ada" });
  });

  it("honors a static auditType override", async () => {
    class Account {
      static auditType = "User";
      id = 5;
      toJSON() {
        return { id: 5 };
      }
    }
    const a = fakeAuditor();
    await new AuditObserver(a as never).created(new Account() as never);
    expect(a.payloads[0].auditable_type).toBe("User");
  });

  it("reads config per event, so a subclass override wins", async () => {
    class Base {
      static auditExcept = ["password"];
      id = 1;
      toJSON() {
        return { id: 1, name: "Ada", password: "x", token: "t" };
      }
    }
    class Sub extends Base {
      static auditExcept = ["token"];
    }
    const a = fakeAuditor();
    await new AuditObserver(a as never).created(new Sub() as never);
    expect(a.payloads[0].auditable_type).toBe("Sub");
    expect(a.payloads[0].new_values).toEqual({ id: 1, name: "Ada", password: "x" });
  });
});
