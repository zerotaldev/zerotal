import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { SQL } from "bun";
import { BaseModel } from "./BaseModel.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";
import { HookRegistry } from "./hooks/HookRegistry.ts";
import { _setBaseModelConnection } from "../index.ts";
import type { ModelObserver } from "./Observer.ts";

// ── In-memory DB ──────────────────────────────────────────────────────────────

let db: SQLInstance;

beforeAll(async () => {
  db = new SQL(":memory:") as unknown as SQLInstance;
  _setBaseModelConnection(db as never);
  await db`CREATE TABLE observer_users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT
  )`;
});

afterAll(async () => {
  _setBaseModelConnection(null as never);
  await (db as unknown as { end(): Promise<void> }).end();
});

// Clear hooks between tests so they don't bleed
afterEach(() => {
  (HookRegistry as unknown as { _clear?: () => void })._clear?.();
});

// ── Model fixture ─────────────────────────────────────────────────────────────

@table("observer_users")
class ObsUser extends BaseModel {
  @column({ type: "string" }) name!: string;
}

// ── Observer tests ────────────────────────────────────────────────────────────

describe("BaseModel.observe()", () => {
  it("calls creating() before INSERT", async () => {
    const log: string[] = [];
    class Obs implements ModelObserver<ObsUser> {
      creating() {
        log.push("creating");
      }
    }
    ObsUser.observe(Obs);

    await ObsUser.create({ name: "Alice" } as never);
    expect(log).toContain("creating");
  });

  it("calls created() after INSERT", async () => {
    const log: string[] = [];
    class Obs implements ModelObserver<ObsUser> {
      created() {
        log.push("created");
      }
    }
    ObsUser.observe(Obs);

    await ObsUser.create({ name: "Bob" } as never);
    expect(log).toContain("created");
  });

  it("calls saving() before any save", async () => {
    const log: string[] = [];
    class Obs implements ModelObserver<ObsUser> {
      saving() {
        log.push("saving");
      }
    }
    ObsUser.observe(Obs);

    await ObsUser.create({ name: "Carol" } as never);
    expect(log).toContain("saving");
  });

  it("calls updating() before UPDATE", async () => {
    const log: string[] = [];
    class Obs implements ModelObserver<ObsUser> {
      updating() {
        log.push("updating");
      }
    }
    ObsUser.observe(Obs);

    const user = await ObsUser.create({ name: "Dave" } as never);
    user.name = "David";
    await user.save();
    expect(log).toContain("updating");
  });

  it("calls updated() after UPDATE", async () => {
    const log: string[] = [];
    class Obs implements ModelObserver<ObsUser> {
      updated() {
        log.push("updated");
      }
    }
    ObsUser.observe(Obs);

    const user = await ObsUser.create({ name: "Eve" } as never);
    user.name = "Eva";
    await user.save();
    expect(log).toContain("updated");
  });

  it("calls deleting() before DELETE", async () => {
    const log: string[] = [];
    class Obs implements ModelObserver<ObsUser> {
      deleting() {
        log.push("deleting");
      }
    }
    ObsUser.observe(Obs);

    const user = await ObsUser.create({ name: "Frank" } as never);
    await user.delete();
    expect(log).toContain("deleting");
  });

  it("calls deleted() after DELETE", async () => {
    const log: string[] = [];
    class Obs implements ModelObserver<ObsUser> {
      deleted() {
        log.push("deleted");
      }
    }
    ObsUser.observe(Obs);

    const user = await ObsUser.create({ name: "Grace" } as never);
    await user.delete();
    expect(log).toContain("deleted");
  });

  it("observer receives the model instance", async () => {
    const seen: string[] = [];
    class Obs implements ModelObserver<ObsUser> {
      created(u: ObsUser) {
        seen.push(u.name);
      }
    }
    ObsUser.observe(Obs);

    await ObsUser.create({ name: "Heidi" } as never);
    expect(seen).toContain("Heidi");
  });

  it("multiple observers on the same model all fire", async () => {
    const log: string[] = [];
    class ObsA implements ModelObserver<ObsUser> {
      creating() {
        log.push("A");
      }
    }
    class ObsB implements ModelObserver<ObsUser> {
      creating() {
        log.push("B");
      }
    }

    ObsUser.observe(ObsA);
    ObsUser.observe(ObsB);

    await ObsUser.create({ name: "Ivan" } as never);
    expect(log).toContain("A");
    expect(log).toContain("B");
  });

  it("observer with no methods does not throw", async () => {
    class EmptyObs implements ModelObserver<ObsUser> {}
    ObsUser.observe(EmptyObs);
    await expect(ObsUser.create({ name: "Judy" } as never)).resolves.toBeDefined();
  });
});
