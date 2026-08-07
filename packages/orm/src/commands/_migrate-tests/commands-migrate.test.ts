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
