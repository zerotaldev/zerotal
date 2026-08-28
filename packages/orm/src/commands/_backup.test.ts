import { describe, expect, it, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BackupError,
  backupStamp,
  isSqliteUrl,
  pruneSnapshots,
  rehearseRestore,
  snapshotName,
  sqlLiteral,
  sqlitePathFromUrl,
  takeBackup,
  verifySnapshot,
} from "./_backup.ts";

const temporaries: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "zt-backup-"));
  temporaries.push(dir);
  return dir;
}

/** A real SQLite database on disk with a couple of rows in it. */
function liveDatabase(root: string, rows = 3): string {
  const path = join(root, "app.sqlite");
  const database = new Database(path);
  database.run(`CREATE TABLE bookings (id INTEGER PRIMARY KEY, total INTEGER)`);
  database.run(`CREATE TABLE audits (id INTEGER PRIMARY KEY)`);
  for (let i = 1; i <= rows; i++) database.run(`INSERT INTO bookings (total) VALUES (${i * 100})`);
  database.close();
  return path;
}

/** Runs a statement against a database the way the ORM connection would. */
function runner(path: string): (sql: string) => Promise<unknown> {
  return async (sql: string) => {
    const database = new Database(path);
    try {
      database.run(sql);
    } finally {
      database.close();
    }
  };
}

afterEach(() => {
  for (const dir of temporaries.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("naming", () => {
  it("stamps UTC so filenames sort chronologically", () => {
    expect(backupStamp(new Date(Date.UTC(2026, 7, 28, 3, 5, 9)))).toBe("20260828-030509");
  });

  it("keeps the database's own name and drops its extension", () => {
    const at = new Date(Date.UTC(2026, 7, 28, 3, 5, 9));
    expect(snapshotName("/srv/app/database/db.sqlite", at)).toBe("db-20260828-030509.sqlite");
    expect(snapshotName("/srv/app/trekly.db", at)).toBe("trekly-20260828-030509.sqlite");
  });

  it("sorts lexically in the order it sorts chronologically", () => {
    const early = snapshotName("db.sqlite", new Date(Date.UTC(2026, 7, 9, 1, 0, 0)));
    const late = snapshotName("db.sqlite", new Date(Date.UTC(2026, 7, 28, 1, 0, 0)));
    expect([late, early].sort()).toEqual([early, late]);
  });
});

describe("sqlLiteral", () => {
  it("doubles an apostrophe rather than writing a broken statement", () => {
    expect(sqlLiteral("/srv/o'brien/db.sqlite")).toBe("'/srv/o''brien/db.sqlite'");
  });

  it("leaves a Windows path alone", () => {
    expect(sqlLiteral("C:\\app\\db.sqlite")).toBe("'C:\\app\\db.sqlite'");
  });
});

describe("url parsing", () => {
  it("recognises the database servers this command is not for", () => {
    expect(isSqliteUrl("postgres://localhost/app")).toBe(false);
    expect(isSqliteUrl("mysql://localhost/app")).toBe(false);
    expect(isSqliteUrl("./database/db.sqlite")).toBe(true);
    expect(isSqliteUrl("sqlite:./database/db.sqlite")).toBe(true);
  });

  it("strips whichever scheme prefix the config used", () => {
    expect(sqlitePathFromUrl("sqlite://./db.sqlite")).toBe("./db.sqlite");
    expect(sqlitePathFromUrl("sqlite:./db.sqlite")).toBe("./db.sqlite");
    expect(sqlitePathFromUrl("file:./db.sqlite")).toBe("./db.sqlite");
    expect(sqlitePathFromUrl("./db.sqlite")).toBe("./db.sqlite");
  });
});

describe("verifySnapshot", () => {
  it("accepts a sound database and reports its tables", () => {
    const root = workspace();
    const path = liveDatabase(root);
    const { tables } = verifySnapshot(path);
    expect(tables).toEqual(["audits", "bookings"]);
  });

  it("counts the rows it was told to require", () => {
    const root = workspace();
    const path = liveDatabase(root, 5);
    expect(verifySnapshot(path, ["bookings"]).rows).toEqual({ bookings: 5 });
  });

  it("throws when a required table is empty", () => {
    const root = workspace();
    const path = liveDatabase(root);
    expect(() => verifySnapshot(path, ["audits"])).toThrow(/empty `audits` table/);
  });

  it("throws when a required table is not in the snapshot at all", () => {
    const root = workspace();
    const path = liveDatabase(root);
    expect(() => verifySnapshot(path, ["invoices"])).toThrow(/no `invoices` table/);
  });

  it("throws on a file that is not a database", () => {
    const root = workspace();
    const path = join(root, "not-a-database.sqlite");
    writeFileSync(path, "this is not a SQLite file, it is a text file");
    expect(() => verifySnapshot(path)).toThrow(BackupError);
  });
});

describe("rehearseRestore", () => {
  it("copies, opens the copy, and leaves nothing behind", () => {
    const root = workspace();
    const path = liveDatabase(root);
    rehearseRestore(path, ["bookings"]);
    expect(readdirSync(root).filter((f) => f.endsWith(".rehearsal"))).toEqual([]);
  });

  it("throws — and still cleans up — when the restored copy does not check out", () => {
    const root = workspace();
    const path = liveDatabase(root);
    expect(() => rehearseRestore(path, ["audits"])).toThrow(/Restore rehearsal failed/);
    expect(readdirSync(root).filter((f) => f.endsWith(".rehearsal"))).toEqual([]);
  });
});

describe("pruneSnapshots", () => {
  it("keeps the newest N and deletes the rest", () => {
    const root = workspace();
    for (const stamp of ["20260801-000000", "20260802-000000", "20260803-000000"]) {
      writeFileSync(join(root, `db-${stamp}.sqlite`), "x");
    }
    const pruned = pruneSnapshots(root, 2);
    expect(pruned).toEqual(["db-20260801-000000.sqlite"]);
    expect(readdirSync(root).sort()).toEqual([
      "db-20260802-000000.sqlite",
      "db-20260803-000000.sqlite",
    ]);
  });

  it("keeps everything when keep is 0", () => {
    const root = workspace();
    writeFileSync(join(root, "db-20260801-000000.sqlite"), "x");
    expect(pruneSnapshots(root, 0)).toEqual([]);
    expect(readdirSync(root).length).toBe(1);
  });

  it("never touches a file it did not write", () => {
    const root = workspace();
    writeFileSync(join(root, "db-20260801-000000.sqlite"), "x");
    writeFileSync(join(root, "db-20260802-000000.sqlite"), "x");
    writeFileSync(join(root, "keep-me-forever.sqlite"), "x");
    writeFileSync(join(root, "notes.txt"), "x");
    pruneSnapshots(root, 1);
    expect(readdirSync(root).sort()).toEqual([
      "db-20260802-000000.sqlite",
      "keep-me-forever.sqlite",
      "notes.txt",
    ]);
  });
});

describe("takeBackup", () => {
  const at = new Date(Date.UTC(2026, 7, 28, 3, 5, 9));

  it("writes a verified snapshot of a live database", async () => {
    const root = workspace();
    const source = liveDatabase(root, 4);
    const dir = join(root, "backups");

    const result = await takeBackup(runner(source), {
      source,
      dir,
      keep: 14,
      requireRows: ["bookings"],
      now: at,
    });

    expect(result.path).toBe(join(dir, "app-20260828-030509.sqlite"));
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.tables).toEqual(["audits", "bookings"]);
    expect(result.rows).toEqual({ bookings: 4 });
    expect(result.rehearsed).toBe(false);
    expect(statSync(result.path).isFile()).toBe(true);
  });

  it("takes a snapshot that is readable while the source is still being written to", async () => {
    const root = workspace();
    const source = liveDatabase(root, 2);
    const dir = join(root, "backups");
    const open = new Database(source);
    try {
      open.run(`INSERT INTO bookings (total) VALUES (999)`);
      const result = await takeBackup(runner(source), { source, dir, keep: 0, now: at });
      const snapshot = new Database(result.path, { readonly: true });
      const count = snapshot.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM bookings`).get();
      snapshot.close();
      expect(count?.n).toBe(3);
    } finally {
      open.close();
    }
  });

  it("performs the restore when asked", async () => {
    const root = workspace();
    const source = liveDatabase(root);
    const result = await takeBackup(runner(source), {
      source,
      dir: join(root, "backups"),
      keep: 0,
      requireRows: ["bookings"],
      rehearse: true,
      now: at,
    });
    expect(result.rehearsed).toBe(true);
  });

  it("prunes only after the new snapshot has checked out", async () => {
    const root = workspace();
    const source = liveDatabase(root);
    const dir = join(root, "backups");
    await takeBackup(runner(source), {
      source,
      dir,
      keep: 1,
      now: new Date(Date.UTC(2026, 7, 27, 0, 0, 0)),
    });
    const result = await takeBackup(runner(source), { source, dir, keep: 1, now: at });
    expect(result.pruned).toEqual(["app-20260827-000000.sqlite"]);
    expect(readdirSync(dir)).toEqual(["app-20260828-030509.sqlite"]);
  });

  it("refuses an in-memory database rather than reporting a backup of nothing", async () => {
    await expect(
      takeBackup(runner(":memory:"), { source: ":memory:", dir: workspace(), keep: 1 }),
    ).rejects.toThrow(/nothing on disk to back up/);
  });

  it("refuses a database server, and names the tool that does the job", async () => {
    await expect(
      takeBackup(async () => {}, {
        source: "postgres://localhost/app",
        dir: workspace(),
        keep: 1,
      }),
    ).rejects.toThrow(/pg_dump or mysqldump/);
  });

  it("refuses when there is no database at the configured path", async () => {
    const root = workspace();
    await expect(
      takeBackup(async () => {}, { source: join(root, "absent.sqlite"), dir: root, keep: 1 }),
    ).rejects.toThrow(/no database at/);
  });

  it("throws when VACUUM INTO reports success but writes nothing", async () => {
    const root = workspace();
    const source = liveDatabase(root);
    await expect(
      takeBackup(async () => {}, { source, dir: join(root, "backups"), keep: 1, now: at }),
    ).rejects.toThrow(/wrote no file/);
  });

  it("throws when VACUUM INTO itself fails", async () => {
    const root = workspace();
    const source = liveDatabase(root);
    await expect(
      takeBackup(
        async () => {
          throw new Error("disk full");
        },
        { source, dir: join(root, "backups"), keep: 1, now: at },
      ),
    ).rejects.toThrow(/no snapshot was written: disk full/);
  });

  it("never overwrites an existing snapshot", async () => {
    const root = workspace();
    const source = liveDatabase(root);
    const dir = join(root, "backups");
    await takeBackup(runner(source), { source, dir, keep: 0, now: at });
    await expect(takeBackup(runner(source), { source, dir, keep: 0, now: at })).rejects.toThrow(
      /already exists/,
    );
  });

  it("fails the whole backup when a required table is empty in the snapshot", async () => {
    const root = workspace();
    const source = liveDatabase(root);
    await expect(
      takeBackup(runner(source), {
        source,
        dir: join(root, "backups"),
        keep: 0,
        requireRows: ["audits"],
        now: at,
      }),
    ).rejects.toThrow(/empty `audits` table/);
  });
});

/**
 * A file that failed its checks must not survive in the retention directory. Left
 * there it is indistinguishable from a good snapshot, and it is the newest — so the
 * next run's retention prunes a verified older one to make room for it.
 */
describe("takeBackup — a failed snapshot leaves nothing behind", () => {
  const at = new Date(Date.UTC(2026, 7, 28, 3, 5, 9));

  it("removes the snapshot when a required table is empty", async () => {
    const root = workspace();
    const source = liveDatabase(root);
    const dir = join(root, "backups");
    await expect(
      takeBackup(runner(source), { source, dir, keep: 0, requireRows: ["audits"], now: at }),
    ).rejects.toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("removes the snapshot when the restore rehearsal fails", async () => {
    const root = workspace();
    const source = liveDatabase(root);
    const dir = join(root, "backups");
    await expect(
      takeBackup(runner(source), {
        source,
        dir,
        keep: 0,
        requireRows: ["audits"],
        rehearse: true,
        now: at,
      }),
    ).rejects.toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("does not let a failed run push a good snapshot out of retention", async () => {
    const root = workspace();
    const source = liveDatabase(root);
    const dir = join(root, "backups");

    // One good snapshot, then a failing run, then retention of 1.
    await takeBackup(runner(source), {
      source,
      dir,
      keep: 1,
      now: new Date(Date.UTC(2026, 7, 27, 0, 0, 0)),
    });
    await expect(
      takeBackup(runner(source), { source, dir, keep: 1, requireRows: ["audits"], now: at }),
    ).rejects.toThrow();

    // The good one is still the only thing there.
    expect(readdirSync(dir)).toEqual(["app-20260827-000000.sqlite"]);
  });
});
