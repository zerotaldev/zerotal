import { Database } from "bun:sqlite";
import type { LockDriver } from "./LockDriver.ts";

/**
 * SQLite-backed lock driver.
 *
 * Suitable for single-server deployments that need locks to survive process
 * restarts. Backed by `bun:sqlite` — fully synchronous under the hood so
 * every acquire/release is a single atomic statement.
 *
 * Use `:memory:` as the path for in-process persistence across tests
 * without touching the filesystem.
 *
 * @category Configuration
 */
export class SqliteLockDriver implements LockDriver {
  private readonly _db: Database;

  constructor(path = ":memory:") {
    this._db = new Database(path);
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS zerotal_locks (
        key        TEXT    PRIMARY KEY,
        owner      TEXT    NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
  }

  async acquire(key: string, owner: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const expiresAt = now + ttlSeconds * 1000;

    // Purge any expired record for this key so INSERT can succeed
    this._db.prepare("DELETE FROM zerotal_locks WHERE key = ? AND expires_at <= ?").run(key, now);

    // If the lock is already held by this owner, refresh the TTL
    const existing = this._db
      .prepare<{ owner: string }, string>("SELECT owner FROM zerotal_locks WHERE key = ?")
      .get(key);

    if (existing) {
      if (existing.owner === owner) {
        this._db
          .prepare("UPDATE zerotal_locks SET expires_at = ? WHERE key = ?")
          .run(expiresAt, key);
        return true;
      }
      return false; // held by another owner
    }

    try {
      this._db
        .prepare("INSERT INTO zerotal_locks (key, owner, expires_at) VALUES (?, ?, ?)")
        .run(key, owner, expiresAt);
      return true;
    } catch {
      return false;
    }
  }

  async extend(key: string, owner: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    // One statement, so the owner check and the write cannot be separated by
    // another process's acquire. `expires_at > ?` refuses to revive a lapsed
    // record, which someone else may already have taken over.
    const result = this._db
      .prepare(
        "UPDATE zerotal_locks SET expires_at = ? WHERE key = ? AND owner = ? AND expires_at > ?",
      )
      .run(now + ttlSeconds * 1000, key, owner, now);
    return result.changes > 0;
  }

  async release(key: string, owner: string): Promise<boolean> {
    const result = this._db
      .prepare("DELETE FROM zerotal_locks WHERE key = ? AND owner = ?")
      .run(key, owner);
    return result.changes > 0;
  }

  async forceRelease(key: string): Promise<void> {
    this._db.prepare("DELETE FROM zerotal_locks WHERE key = ?").run(key);
  }

  async exists(key: string): Promise<boolean> {
    const row = this._db
      .prepare<{ 1: number }, [string, number]>(
        "SELECT 1 FROM zerotal_locks WHERE key = ? AND expires_at > ?",
      )
      .get(key, Date.now());
    return row !== null;
  }

  dispose(): void {
    this._db.close();
  }
}
