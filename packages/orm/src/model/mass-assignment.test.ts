/**
 * Mass-assignment protection: models guard every attribute by default.
 *
 * The global test preload calls `BaseModel.unguard()` so trusted fixtures can
 * create() freely; these tests call `reguard()` in setup to exercise the real
 * production default, then restore the unguarded test state afterwards.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { BaseModel, _setBaseModelConnection } from "./BaseModel.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";
import { MassAssignmentError } from "../errors/index.ts";
import type { SQLInstance } from "../db/sql-types.ts";

@table("accounts")
class GuardedAccount extends BaseModel {
  @column() name!: string;
  @column() role!: string;
}

@table("accounts")
class FillableAccount extends BaseModel {
  static override fillable = ["name"];
  @column() name!: string;
  @column() role!: string;
}

@table("accounts")
class GuardedListAccount extends BaseModel {
  static override guarded = ["role"];
  @column() name!: string;
  @column() role!: string;
}

@table("accounts")
class UnguardedAccount extends BaseModel {
  static override unguarded = true;
  @column() name!: string;
  @column() role!: string;
}

let db: SQLInstance;

beforeAll(async () => {
  db = new SQL(":memory:") as unknown as SQLInstance;
  _setBaseModelConnection(db);
  await db`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      role TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `;
});

afterAll(async () => {
  _setBaseModelConnection(null);
  await (db as unknown as { end(): Promise<void> }).end();
});

beforeEach(async () => {
  // Exercise the real production default (the preload globally unguards).
  BaseModel.reguard();
  await db`DELETE FROM accounts`;
});

afterAll(() => {
  BaseModel.unguard(); // restore the test-suite default for later files
});

describe("mass-assignment guarding", () => {
  it("guards every attribute by default (neither fillable nor guarded)", () => {
    const acct = new GuardedAccount();
    expect(() => acct.fill({ name: "Al" } as never)).toThrow(MassAssignmentError);
  });

  it("create() surfaces the guard as a thrown error", async () => {
    await expect(GuardedAccount.create({ name: "Al" } as never)).rejects.toBeInstanceOf(
      MassAssignmentError,
    );
  });

  it("respects an explicit fillable allowlist", () => {
    const acct = new FillableAccount();
    acct.fill({ name: "Al" } as never);
    expect(acct.name).toBe("Al");
    expect(() => acct.fill({ role: "admin" } as never)).toThrow(MassAssignmentError);
  });

  it("respects an explicit guarded denylist", () => {
    const acct = new GuardedListAccount();
    acct.fill({ name: "Al" } as never);
    expect(acct.name).toBe("Al");
    expect(() => acct.fill({ role: "admin" } as never)).toThrow(MassAssignmentError);
  });

  it("allows everything when the model is unguarded", () => {
    const acct = new UnguardedAccount();
    acct.fill({ name: "Al", role: "admin" } as never);
    expect(acct.role).toBe("admin");
  });

  it("forceFill bypasses the guard for trusted data", () => {
    const acct = new GuardedAccount();
    acct.forceFill({ name: "Al", role: "admin" });
    expect(acct.role).toBe("admin");
  });

  it("forceCreate persists trusted data past the guard", async () => {
    const acct = await GuardedAccount.forceCreate({ name: "Al", role: "admin" });
    expect(acct.id).toBeGreaterThan(0);
    expect(acct.role).toBe("admin");
  });

  it("global unguard()/reguard() flips the default for undeclared models", () => {
    const acct = new GuardedAccount();
    BaseModel.unguard();
    expect(() => acct.fill({ name: "Al", role: "admin" } as never)).not.toThrow();
    BaseModel.reguard();
    expect(() => acct.fill({ name: "Al" } as never)).toThrow(MassAssignmentError);
  });

  it("withoutGuard runs a trusted block unguarded then restores", async () => {
    const created = await BaseModel.withoutGuard(() =>
      GuardedAccount.create({ name: "Al", role: "admin" } as never),
    );
    expect(created.role).toBe("admin");
    // Guarding restored afterwards.
    expect(() => new GuardedAccount().fill({ name: "Al" } as never)).toThrow(MassAssignmentError);
  });

  it("an explicit fillable list is honoured even under global unguard", () => {
    BaseModel.unguard();
    try {
      const acct = new FillableAccount();
      expect(() => acct.fill({ role: "admin" } as never)).toThrow(MassAssignmentError);
    } finally {
      BaseModel.reguard();
    }
  });
});
