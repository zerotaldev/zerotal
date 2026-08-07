import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SQL } from "bun";
import { _setDbConnection } from "../db/DB.ts";
import { Migration } from "./Migration.ts";
import { MigrationRunner } from "./MigrationRunner.ts";
import { Schema } from "./Schema.ts";
import { MigrationError } from "../errors/MigrationError.ts";

// Each test gets a fresh in-memory DB for perfect isolation.
let db: SQLInstance;
let runner: MigrationRunner;

beforeEach(async () => {
  db = new SQL(":memory:");
  _setDbConnection(db);
  runner = new MigrationRunner({ connection: db });
});

afterEach(async () => {
  await db.end();
});

// ── Concrete migrations used across tests ─────────────────────────────────────

class CreateAlpha extends Migration {
  async up() {
    await Schema.create("alpha", (table) => {
      table.increments("id");
    });
  }
  async down() {
    await Schema.dropIfExists("alpha");
  }
}

class CreateBeta extends Migration {
  async up() {
    await Schema.create("beta", (table) => {
      table.increments("id");
      table.string("label");
    });
  }
  async down() {
    await Schema.dropIfExists("beta");
  }
}

class CreateGamma extends Migration {
  async up() {
    await Schema.create("gamma", (table) => {
      table.increments("id");
    });
  }
  async down() {
    await Schema.dropIfExists("gamma");
  }
}

// ── run() ─────────────────────────────────────────────────────────────────────

describe("MigrationRunner.run()", () => {
  it("executes all entries and returns their names", async () => {
    const ran = await runner.run([
      { name: "001_alpha", migration: new CreateAlpha() },
      { name: "002_beta", migration: new CreateBeta() },
    ]);

    expect(ran).toEqual(["001_alpha", "002_beta"]);
    expect(await Schema.hasTable("alpha")).toBe(true);
    expect(await Schema.hasTable("beta")).toBe(true);
  });

  it("creates the migrations tracking table automatically", async () => {
    await runner.run([{ name: "001_alpha", migration: new CreateAlpha() }]);
    expect(await Schema.hasTable("migrations")).toBe(true);
  });

  it("skips already-ran migrations on a subsequent call", async () => {
    let callCount = 0;
    class Counted extends Migration {
      async up() {
        callCount++;
        await Schema.create("counted", (table) => {
          table.increments("id");
        });
      }
      async down() {
        await Schema.dropIfExists("counted");
      }
    }

    const entries = [{ name: "001_counted", migration: new Counted() }];
    await runner.run(entries);
    await runner.run(entries); // should be a no-op

    expect(callCount).toBe(1);
  });

  it("assigns a batch number that increments per run() call", async () => {
    await runner.run([{ name: "001_alpha", migration: new CreateAlpha() }]);
    await runner.run([{ name: "002_beta", migration: new CreateBeta() }]);

    const status = await runner.status([
      { name: "001_alpha", migration: new CreateAlpha() },
      { name: "002_beta", migration: new CreateBeta() },
    ]);

    const a = status.find((s) => s.name === "001_alpha")!;
    const b = status.find((s) => s.name === "002_beta")!;
    expect(a.batch).toBe(1);
    expect(b.batch).toBe(2);
  });

  it("returns an empty array when all migrations are already run", async () => {
    const entries = [{ name: "001_alpha", migration: new CreateAlpha() }];
    await runner.run(entries);
    const second = await runner.run(entries);
    expect(second).toHaveLength(0);
  });

  it("uses a custom table name when configured", async () => {
    const customRunner = new MigrationRunner({ connection: db, table: "custom_migrations" });
    await customRunner.run([{ name: "001_alpha", migration: new CreateAlpha() }]);
    expect(await Schema.hasTable("custom_migrations")).toBe(true);
    expect(await Schema.hasTable("migrations")).toBe(false);
  });
});

// ── rollback() ────────────────────────────────────────────────────────────────

describe("MigrationRunner.rollback()", () => {
  it("rolls back only the last batch", async () => {
    const batch1 = [{ name: "001_alpha", migration: new CreateAlpha() }];
    const batch2 = [{ name: "002_beta", migration: new CreateBeta() }];
    const all = [...batch1, ...batch2];

    await runner.run(batch1);
    await runner.run(batch2);

    const rolledBack = await runner.rollback(all);
    expect(rolledBack).toEqual(["002_beta"]);
    expect(await Schema.hasTable("beta")).toBe(false);
    expect(await Schema.hasTable("alpha")).toBe(true); // batch 1 untouched
  });

  it("rolls back multiple migrations in reverse order within a batch", async () => {
    const order: string[] = [];

    class M1 extends Migration {
      async up() {
        await Schema.create("m1", (table) => {
          table.increments("id");
        });
      }
      async down() {
        order.push("m1");
        await Schema.dropIfExists("m1");
      }
    }
    class M2 extends Migration {
      async up() {
        await Schema.create("m2", (table) => {
          table.increments("id");
        });
      }
      async down() {
        order.push("m2");
        await Schema.dropIfExists("m2");
      }
    }

    const entries = [
      { name: "001_m1", migration: new M1() },
      { name: "002_m2", migration: new M2() },
    ];
    await runner.run(entries);
    await runner.rollback(entries);

    expect(order).toEqual(["m2", "m1"]); // reversed
  });

  it("returns an empty array when nothing has run", async () => {
    const result = await runner.rollback([{ name: "001_alpha", migration: new CreateAlpha() }]);
    expect(result).toHaveLength(0);
  });
});

// ── reset() ───────────────────────────────────────────────────────────────────

describe("MigrationRunner.reset()", () => {
  it("rolls back all batches", async () => {
    const entries = [
      { name: "001_alpha", migration: new CreateAlpha() },
      { name: "002_beta", migration: new CreateBeta() },
      { name: "003_gamma", migration: new CreateGamma() },
    ];

    await runner.run([entries[0]!]);
    await runner.run([entries[1]!]);
    await runner.run([entries[2]!]);

    await runner.reset(entries);

    expect(await Schema.hasTable("alpha")).toBe(false);
    expect(await Schema.hasTable("beta")).toBe(false);
    expect(await Schema.hasTable("gamma")).toBe(false);
  });
});

// ── status() ──────────────────────────────────────────────────────────────────

describe("MigrationRunner.status()", () => {
  it("reports ran=true for executed and ran=false for pending", async () => {
    const entries = [
      { name: "001_alpha", migration: new CreateAlpha() },
      { name: "002_beta", migration: new CreateBeta() },
    ];

    await runner.run([entries[0]!]);

    const status = await runner.status(entries);
    const a = status.find((s) => s.name === "001_alpha")!;
    const b = status.find((s) => s.name === "002_beta")!;

    expect(a.ran).toBe(true);
    expect(a.batch).toBe(1);
    expect(a.ranAt).toBeInstanceOf(Date);
    expect(b.ran).toBe(false);
    expect(b.batch).toBeUndefined();
  });

  it("reports all as pending when nothing has run", async () => {
    const entries = [{ name: "001_alpha", migration: new CreateAlpha() }];
    const status = await runner.status(entries);
    expect(status[0]!.ran).toBe(false);
  });
});

// ── pending() ─────────────────────────────────────────────────────────────────

describe("MigrationRunner.pending()", () => {
  it("returns all entries when nothing has run", async () => {
    const entries = [
      { name: "001_alpha", migration: new CreateAlpha() },
      { name: "002_beta", migration: new CreateBeta() },
    ];
    const result = await runner.pending(entries);
    expect(result).toEqual(["001_alpha", "002_beta"]);
  });

  it("returns only unrun entries after a partial run", async () => {
    const entries = [
      { name: "001_alpha", migration: new CreateAlpha() },
      { name: "002_beta", migration: new CreateBeta() },
    ];
    await runner.run([entries[0]!]);
    const result = await runner.pending(entries);
    expect(result).toEqual(["002_beta"]);
  });

  it("returns an empty array when all migrations have run", async () => {
    const entries = [{ name: "001_alpha", migration: new CreateAlpha() }];
    await runner.run(entries);
    const result = await runner.pending(entries);
    expect(result).toHaveLength(0);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("MigrationRunner — error handling", () => {
  class BrokenMigration extends Migration {
    async up() {
      throw new Error("intentional failure");
    }
    async down() {}
  }

  it("throws MigrationError when up() fails", async () => {
    const entries = [{ name: "003_broken", migration: new BrokenMigration() }];
    await expect(runner.run(entries)).rejects.toBeInstanceOf(MigrationError);
  });

  it("MigrationError message includes the migration name", async () => {
    const entries = [{ name: "003_broken", migration: new BrokenMigration() }];
    try {
      await runner.run(entries);
    } catch (err) {
      expect((err as MigrationError).message).toContain("003_broken");
      expect((err as MigrationError).message).toContain("intentional failure");
    }
  });

  it("does not record a row in the tracking table when up() fails", async () => {
    const entries = [{ name: "003_broken", migration: new BrokenMigration() }];
    try {
      await runner.run(entries);
    } catch {
      /* expected */
    }

    const status = await runner.status(entries);
    expect(status[0]!.ran).toBe(false);
  });

  it("previously successful migrations are unaffected by a later failure", async () => {
    const entries = [
      { name: "001_alpha", migration: new CreateAlpha() },
      { name: "002_broken", migration: new BrokenMigration() },
    ];
    try {
      await runner.run(entries);
    } catch {
      /* expected */
    }

    expect(await Schema.hasTable("alpha")).toBe(true);
    const status = await runner.status(entries);
    expect(status.find((s) => s.name === "001_alpha")!.ran).toBe(true);
    expect(status.find((s) => s.name === "002_broken")!.ran).toBe(false);
  });
});

// ── ensureTable() idempotency ─────────────────────────────────────────────────

describe("MigrationRunner.ensureTable() idempotency", () => {
  it("run() can be called multiple times without re-creating the tracking table", async () => {
    // Each run() call internally calls _ensureTable(). Calling it twice should
    // not throw (IF NOT EXISTS in the DDL prevents the error).
    const entries = [{ name: "001_alpha", migration: new CreateAlpha() }];
    await runner.run(entries);
    await expect(runner.run([])).resolves.toEqual([]);
    expect(await Schema.hasTable("migrations")).toBe(true);
  });
});

describe("rollback with a missing migration file", () => {
  it("refuses the batch instead of half-undoing it", async () => {
    const entries = [
      { name: "001_alpha", migration: new CreateAlpha() },
      { name: "002_beta", migration: new CreateBeta() },
    ];
    await runner.run(entries);

    // The 002 file is gone — deleted, renamed, or on a branch that was reverted.
    const partial = [entries[0]!];

    // Silently skipping it ran alpha's down() while both records stayed, leaving the
    // schema and the tracking table disagreeing.
    await expect(runner.rollback(partial)).rejects.toThrow(/no migration file found for/);
    expect(await Schema.hasTable("alpha")).toBe(true);
    expect((await runner.status(entries)).every((s) => s.ran)).toBe(true);
  });

  it("names the missing migration so the operator can act on it", async () => {
    await runner.run([{ name: "001_alpha", migration: new CreateAlpha() }]);
    await expect(runner.rollback([])).rejects.toThrow(/"001_alpha"/);
  });

  it("does not let reset() spin forever on it", async () => {
    await runner.run([{ name: "001_alpha", migration: new CreateAlpha() }]);
    // reset() loops until the last batch is 0; a batch that can never empty never ends.
    await expect(runner.reset([])).rejects.toThrow(/no migration file found for/);
  });
});
