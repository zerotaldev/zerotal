/**
 * Tests for migrate command run() methods using a mocked loadMigrations.
 * mock.module must be at the top of the file (Bun hoists it before imports).
 */
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

// ── Mock _loadMigrations before any command imports ───────────────────────────

const fakeMigration = {
  async up(_ctx: unknown) {},
  async down(_ctx: unknown) {},
};

const _mockLoadMigrations = mock(async () => [
  { name: "001_create_posts_table", instance: fakeMigration },
]);

mock.module("../_loadMigrations.ts", () => ({
  loadMigrations: _mockLoadMigrations,
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { SQL } from "bun";
import { MigrateCommand } from "../MigrateCommand.ts";
import { MigrateFreshCommand } from "../MigrateFreshCommand.ts";
import { MigrateRefreshCommand } from "../MigrateRefreshCommand.ts";
import { MigrateRollbackCommand } from "../MigrateRollbackCommand.ts";
import { MigrateStatusCommand } from "../MigrateStatusCommand.ts";
import { _setDbConnection } from "../../db/DB.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const noop = { write: () => {}, writeLine: () => {}, writeError: () => {} };

function makeLines() {
  const lines: string[] = [];
  const writer = {
    write: () => {},
    writeLine: (l: string) => lines.push(l),
    writeError: () => {},
  };
  return { lines, writer };
}

let db: InstanceType<typeof SQL>;

beforeEach(() => {
  db = new SQL(":memory:");
  _setDbConnection(db);
  _mockLoadMigrations.mockClear();
  _mockLoadMigrations.mockImplementation(async () => [
    { name: "001_create_posts_table", instance: fakeMigration },
  ]);
});

afterEach(async () => {
  _setDbConnection(null);
  await db.end();
});

// ── MigrateCommand.run() — empty migrations ───────────────────────────────────

describe("MigrateCommand.run() — empty", () => {
  it("reports nothing to migrate when no migration files exist", async () => {
    _mockLoadMigrations.mockImplementation(async () => []);
    const lines: string[] = [];
    const cmd = new MigrateCommand();
    cmd.args = {};
    cmd.flags = { fresh: false };
    cmd._writer = {
      write: () => {},
      writeLine: (l: string) => lines.push(l),
      writeError: () => {},
    };
    await cmd.run();
    expect(lines.some((l) => l.includes("Nothing to migrate"))).toBe(true);
  });

  it("fresh:true with no migrations still reports nothing to migrate", async () => {
    _mockLoadMigrations.mockImplementation(async () => []);
    const lines: string[] = [];
    const cmd = new MigrateCommand();
    cmd.args = {};
    cmd.flags = { fresh: true };
    cmd._writer = {
      write: () => {},
      writeLine: (l: string) => lines.push(l),
      writeError: () => {},
    };
    await cmd.run();
    expect(lines.some((l) => l.includes("Nothing to migrate"))).toBe(true);
  });
});

describe("MigrateRollbackCommand.run() — empty", () => {
  it("reports nothing to roll back when no migrations have run", async () => {
    _mockLoadMigrations.mockImplementation(async () => []);
    const lines: string[] = [];
    const cmd = new MigrateRollbackCommand();
    cmd.args = {};
    cmd.flags = {};
    cmd._writer = {
      write: () => {},
      writeLine: (l: string) => lines.push(l),
      writeError: () => {},
    };
    await cmd.run();
    expect(lines.some((l) => l.includes("Nothing to roll back"))).toBe(true);
  });
});

describe("MigrateStatusCommand.run() — empty", () => {
  it("prints table header even when no migrations exist", async () => {
    _mockLoadMigrations.mockImplementation(async () => []);
    const lines: string[] = [];
    const cmd = new MigrateStatusCommand();
    cmd.args = {};
    cmd.flags = {};
    cmd._writer = {
      write: () => {},
      writeLine: (l: string) => lines.push(l),
      writeError: () => {},
    };
    await cmd.run();
    expect(lines.some((l) => l.includes("name"))).toBe(true);
  });
});

// ── MigrateCommand.run() ──────────────────────────────────────────────────────

describe("MigrateCommand.run() — with migration records", () => {
  it("runs pending migrations and reports them", async () => {
    const { lines, writer } = makeLines();
    const cmd = new MigrateCommand();
    cmd.args = {};
    cmd.flags = { fresh: false };
    cmd._writer = writer;
    await cmd.run();
    // Should say it migrated 1 migration
    expect(lines.some((l) => l.includes("001_create_posts_table") || l.includes("Migrated"))).toBe(
      true,
    );
  });

  it("reports nothing to migrate when already run", async () => {
    // Run once
    const cmd1 = new MigrateCommand();
    cmd1.args = {};
    cmd1.flags = { fresh: false };
    cmd1._writer = noop;
    await cmd1.run();

    // Run again
    const { lines, writer } = makeLines();
    const cmd2 = new MigrateCommand();
    cmd2.args = {};
    cmd2.flags = { fresh: false };
    cmd2._writer = writer;
    await cmd2.run();
    expect(lines.some((l) => l.includes("Nothing to migrate"))).toBe(true);
  });

  it("fresh:true resets then re-runs all migrations", async () => {
    // First run to get some state
    const cmd1 = new MigrateCommand();
    cmd1.args = {};
    cmd1.flags = { fresh: false };
    cmd1._writer = noop;
    await cmd1.run();

    const { lines, writer } = makeLines();
    const cmd2 = new MigrateCommand();
    cmd2.args = {};
    cmd2.flags = { fresh: true };
    cmd2._writer = writer;
    await cmd2.run();
    expect(lines.some((l) => l.includes("001_create_posts_table") || l.includes("Migrated"))).toBe(
      true,
    );
  });
});

// ── MigrateRollbackCommand.run() ──────────────────────────────────────────────

describe("MigrateRollbackCommand.run() — with migration records", () => {
  it("rolls back the most recent batch after a migration was run", async () => {
    // First run the migration
    const runCmd = new MigrateCommand();
    runCmd.args = {};
    runCmd.flags = { fresh: false };
    runCmd._writer = noop;
    await runCmd.run();

    // Then rollback
    const { lines, writer } = makeLines();
    const cmd = new MigrateRollbackCommand();
    cmd.args = {};
    cmd.flags = {};
    cmd._writer = writer;
    await cmd.run();
    // Should mention either the migration name or "rolled back"
    expect(
      lines.some(
        (l) =>
          l.includes("001_create_posts_table") || l.includes("rolled back") || l.includes("Rolled"),
      ),
    ).toBe(true);
  });
});

// ── MigrateStatusCommand.run() ────────────────────────────────────────────────

describe("MigrateStatusCommand.run() — with migration records", () => {
  it("shows pending status before running", async () => {
    const { lines, writer } = makeLines();
    const cmd = new MigrateStatusCommand();
    cmd.args = {};
    cmd.flags = {};
    cmd._writer = writer;
    await cmd.run();
    // Table should include the header row
    expect(lines.some((l) => l.includes("name"))).toBe(true);
    // Should show the migration as not-ran
    expect(lines.some((l) => l.includes("001_create_posts_table") || l.includes("no"))).toBe(true);
  });

  it("shows ran status after migration runs", async () => {
    // Run migration first
    const runCmd = new MigrateCommand();
    runCmd.args = {};
    runCmd.flags = { fresh: false };
    runCmd._writer = noop;
    await runCmd.run();

    // Check status
    const { lines, writer } = makeLines();
    const cmd = new MigrateStatusCommand();
    cmd.args = {};
    cmd.flags = {};
    cmd._writer = writer;
    await cmd.run();
    // Should show the migration as having run (yes)
    expect(lines.some((l) => l.includes("yes") || l.includes("001"))).toBe(true);
  });
});

// ── Duplicate numbers, --pretend, backup before migrate ───────────────────────

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Migration } from "../../schema/Migration.ts";
import { Schema } from "../../schema/Schema.ts";

class CreateWidgets extends Migration {
  override async up(): Promise<void> {
    await Schema.create("widgets", (table) => {
      table.increments("id");
      table.string("name");
    });
  }
  override async down(): Promise<void> {
    await Schema.drop("widgets");
  }
}

function migrateWith(
  flags: Record<string, unknown>,
  config: Record<string, unknown> = {},
): { cmd: MigrateCommand; lines: string[] } {
  const { lines, writer } = makeLines();
  const cmd = new MigrateCommand();
  cmd.args = {};
  cmd.flags = { fresh: false, ...flags };
  cmd._writer = { ...writer, writeError: (l: string) => lines.push(l) };
  const get = (key: string, fallback?: unknown) => (key in config ? config[key] : fallback);
  (cmd as unknown as { app: unknown }).app = {
    container: { makeSync: (k: string) => (k === "config" ? { get } : undefined) },
  };
  return { cmd, lines };
}

async function tableExists(name: string): Promise<boolean> {
  const rows = await db`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${name}`;
  return rows.length > 0;
}

describe("MigrateCommand.run() — two migrations under one number", () => {
  it("refuses a database that ran one side of the clash, before running anything", async () => {
    // The merge case: main applied 0042_add_invoices here; a branch brings 0042_add_refunds.
    _mockLoadMigrations.mockImplementation(async () => [
      { name: "0042_add_invoices", file: "0042_add_invoices", instance: fakeMigration },
    ]);
    await migrateWith({}).cmd.run();

    _mockLoadMigrations.mockImplementation(async () => [
      { name: "0042_add_invoices", file: "0042_add_invoices", instance: fakeMigration },
      { name: "0042_add_refunds", file: "0042_add_refunds", instance: fakeMigration },
      { name: "0043_create_widgets", file: "0043_create_widgets", instance: new CreateWidgets() },
    ]);
    const { cmd } = migrateWith({});
    const error = await cmd.run().catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe("E_MIGRATION_NUMBER_CLASH");
    expect((error as Error).message).toContain("0042_add_invoices.ts, 0042_add_refunds.ts");
    expect((error as Error).message).toContain("0044_add_refunds.ts");
    expect((error as Error).message).toContain("0042b_add_refunds.ts");
    expect(await tableExists("widgets")).toBe(false);
  });

  it("warns and runs on a database that has run neither side, in name order", async () => {
    // A new environment of an app whose clash shipped long ago. Every new database
    // runs these in the same order, so stopping it would block it for nothing.
    _mockLoadMigrations.mockImplementation(async () => [
      { name: "0041_create_widgets", file: "0041_create_widgets", instance: new CreateWidgets() },
      { name: "0042_add_invoices", file: "0042_add_invoices", instance: fakeMigration },
      { name: "0042_add_refunds", file: "0042_add_refunds", instance: fakeMigration },
    ]);
    const { cmd, lines } = migrateWith({});
    await cmd.run();
    expect(await tableExists("widgets")).toBe(true);
    expect(lines.join("\n")).toContain("0042_add_invoices.ts, 0042_add_refunds.ts");
  });

  it("runs when every clashing migration has already been applied", async () => {
    const clashing = [
      { name: "0042_add_invoices", file: "0042_add_invoices", instance: fakeMigration },
      { name: "0042_add_refunds", file: "0042_add_refunds", instance: fakeMigration },
    ];
    // Applied before the check existed: recorded, so history rather than a decision.
    _mockLoadMigrations.mockImplementation(async () => [
      { name: "0042_add_invoices", instance: fakeMigration },
    ]);
    await migrateWith({}).cmd.run();
    _mockLoadMigrations.mockImplementation(async () => [
      { name: "0042_add_refunds", instance: fakeMigration },
    ]);
    await migrateWith({}).cmd.run();

    _mockLoadMigrations.mockImplementation(async () => [
      ...clashing,
      { name: "0043_create_widgets", file: "0043_create_widgets", instance: new CreateWidgets() },
    ]);
    await migrateWith({}).cmd.run();
    expect(await tableExists("widgets")).toBe(true);
  });

  it("still refuses a renumbered copy of an applied migration, with its own message", async () => {
    _mockLoadMigrations.mockImplementation(async () => [
      { name: "001_create_posts_table", instance: fakeMigration },
    ]);
    await migrateWith({}).cmd.run();
    _mockLoadMigrations.mockImplementation(async () => [
      { name: "0001_create_posts_table", instance: fakeMigration },
    ]);
    const error = await migrateWith({})
      .cmd.run()
      .catch((e: unknown) => e);
    expect((error as Error).message).toContain("renumbered");
  });
});

describe("MigrateCommand.run() — --pretend", () => {
  it("prints the SQL and leaves the schema and the tracking table untouched", async () => {
    _mockLoadMigrations.mockImplementation(async () => [
      { name: "001_create_widgets", file: "001_create_widgets", instance: new CreateWidgets() },
    ]);
    const { cmd, lines } = migrateWith({ pretend: true });
    await cmd.run();
    const out = lines.join("\n");
    expect(out).toContain("001_create_widgets");
    expect(out).toMatch(/CREATE TABLE[^;]*widgets/i);
    expect(await tableExists("widgets")).toBe(false);
    const recorded = await db`SELECT migration FROM migrations`;
    expect(recorded).toHaveLength(0);
  });

  it("says nothing is pending when nothing is", async () => {
    _mockLoadMigrations.mockImplementation(async () => []);
    const { cmd, lines } = migrateWith({ pretend: true });
    await cmd.run();
    expect(lines.some((l) => l.includes("Nothing to migrate"))).toBe(true);
  });
});

describe("MigrateCommand.run() — database.backupBeforeMigrate", () => {
  let dir: string;
  let cwd: string;
  let appEnv: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "zt-premigrate-"));
    cwd = process.cwd();
    appEnv = Bun.env["APP_ENV"];
    process.chdir(dir);
    _mockLoadMigrations.mockImplementation(async () => [
      { name: "001_create_widgets", file: "001_create_widgets", instance: new CreateWidgets() },
    ]);
  });

  afterEach(async () => {
    process.chdir(cwd);
    if (appEnv === undefined) delete Bun.env["APP_ENV"];
    else Bun.env["APP_ENV"] = appEnv;
    // Close the file before removing its directory: Windows will not delete a SQLite
    // file that is still open, and this runs before the suite's own afterEach closes
    // the connection. The suite gets an in-memory one to close in its place.
    await db.end();
    db = new SQL(":memory:");
    _setDbConnection(db);
    rmSync(dir, { recursive: true, force: true });
  });

  async function onFile(): Promise<string> {
    const path = join(dir, "db.sqlite");
    await db.end();
    db = new SQL(`sqlite://${path}`);
    _setDbConnection(db);
    await db`CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY)`;
    return path;
  }

  const snapshots = (): string[] => {
    try {
      return readdirSync(join(dir, MigrateCommand.BACKUP_DIR));
    } catch {
      return [];
    }
  };

  it("snapshots a SQLite database in production before migrating", async () => {
    const path = await onFile();
    Bun.env["APP_ENV"] = "production";
    const { cmd } = migrateWith({}, { "database.backupBeforeMigrate": true, "database.url": path });
    await cmd.run();
    expect(snapshots()).toHaveLength(1);
    expect(await tableExists("widgets")).toBe(true);
  });

  it("snapshots before migrate:fresh and migrate:refresh too, which drop every table", async () => {
    const path = await onFile();
    Bun.env["APP_ENV"] = "production";
    const config = { "database.backupBeforeMigrate": true, "database.url": path };
    for (const Fresh of [MigrateFreshCommand, MigrateRefreshCommand]) {
      const { cmd } = migrateWith({}, config);
      const fresh = new Fresh();
      fresh.args = {};
      fresh.flags = { seed: false };
      fresh._writer = cmd._writer;
      (fresh as unknown as { app: unknown }).app = (cmd as unknown as { app: unknown }).app;
      await fresh.run();
      expect(snapshots()).toHaveLength(1);
      // Snapshots are stamped to the second and never overwritten, so clear this
      // one before the next command runs in the same second.
      rmSync(join(dir, MigrateCommand.BACKUP_DIR), { recursive: true, force: true });
    }
    expect(await tableExists("widgets")).toBe(true);
  });

  it("takes nothing outside production, with the flag off, or with --skip-backup", async () => {
    const path = await onFile();
    Bun.env["APP_ENV"] = "local";
    await migrateWith({}, { "database.backupBeforeMigrate": true, "database.url": path }).cmd.run();
    expect(snapshots()).toHaveLength(0);

    Bun.env["APP_ENV"] = "production";
    await migrateWith(
      { "skip-backup": true },
      {
        "database.backupBeforeMigrate": true,
        "database.url": path,
      },
    ).cmd.run();
    expect(snapshots()).toHaveLength(0);
  });

  it("does not migrate when the backup fails", async () => {
    await onFile();
    Bun.env["APP_ENV"] = "production";
    const { cmd } = migrateWith(
      {},
      { "database.backupBeforeMigrate": true, "database.url": join(dir, "missing.sqlite") },
    );
    const error = await cmd.run().catch((e: unknown) => e);
    expect((error as Error).message).toContain("Not migrating");
    expect(await tableExists("widgets")).toBe(false);
  });

  it("says plainly that no backup was taken on a server database, then migrates", async () => {
    Bun.env["APP_ENV"] = "production";
    const { cmd, lines } = migrateWith(
      {},
      { "database.backupBeforeMigrate": true, "database.url": "postgres://db.internal/app" },
    );
    await cmd.run();
    expect(lines.join("\n")).toContain("No backup was taken");
    expect(snapshots()).toHaveLength(0);
    expect(await tableExists("widgets")).toBe(true);
  });
});
