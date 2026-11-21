import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _isServerDatabaseUrl, _workerDatabaseUrl } from "./workerDatabase.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zt-worker-db-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("_workerDatabaseUrl", () => {
  it("leaves the URL alone outside --parallel", () => {
    expect(_workerDatabaseUrl(join(dir, "test.sqlite"), undefined)).toBe(join(dir, "test.sqlite"));
    expect(_workerDatabaseUrl(undefined, "2")).toBeUndefined();
  });

  it("leaves in-memory SQLite and database servers alone", () => {
    expect(_workerDatabaseUrl(":memory:", "2")).toBe(":memory:");
    expect(_workerDatabaseUrl("sqlite://:memory:", "2")).toBe("sqlite://:memory:");
    const pg = "postgres://app:secret@localhost:5432/app_test";
    expect(_workerDatabaseUrl(pg, "2")).toBe(pg);
  });

  it("gives each worker a copy of a SQLite file, holding what the file held", () => {
    const file = join(dir, "test.sqlite");
    writeFileSync(file, "migrated schema");

    const one = _workerDatabaseUrl(file, "1");
    const two = _workerDatabaseUrl(file, "2");
    expect(one).toBe(join(dir, "test.worker-1.sqlite"));
    expect(two).toBe(join(dir, "test.worker-2.sqlite"));
    expect(readFileSync(one!, "utf8")).toBe("migrated schema");
    expect(readFileSync(two!, "utf8")).toBe("migrated schema");
  });

  it("starts a worker's copy fresh rather than from a previous run", () => {
    const file = join(dir, "test.sqlite");
    writeFileSync(file, "migrated schema");
    writeFileSync(join(dir, "test.worker-1.sqlite"), "rows a previous run left");
    writeFileSync(join(dir, "test.worker-1.sqlite-wal"), "stale wal");

    _workerDatabaseUrl(file, "1");
    expect(readFileSync(join(dir, "test.worker-1.sqlite"), "utf8")).toBe("migrated schema");
    expect(existsSync(join(dir, "test.worker-1.sqlite-wal"))).toBe(false);
  });

  it("keeps a sqlite: prefix", () => {
    expect(_workerDatabaseUrl(`sqlite:${join(dir, "a.db")}`, "2")).toBe(
      `sqlite:${join(dir, "a.worker-2.db")}`,
    );
  });

  it("keeps the sqlite:// prefix, and starts empty when there is no file yet", () => {
    const url = _workerDatabaseUrl(`sqlite://${join(dir, "fresh.db")}`, "3");
    expect(url).toBe(`sqlite://${join(dir, "fresh.worker-3.db")}`);
    expect(existsSync(join(dir, "fresh.worker-3.db"))).toBe(false);
  });
});

describe("_isServerDatabaseUrl", () => {
  it("tells a server from a SQLite file", () => {
    for (const url of ["postgres://h/db", "postgresql://h/db", "mysql://h/db", "mariadb://h/db"]) {
      expect(_isServerDatabaseUrl(url)).toBe(true);
    }
    for (const url of ["./database/test.sqlite", "sqlite://x.db", ":memory:"]) {
      expect(_isServerDatabaseUrl(url)).toBe(false);
    }
  });
});
