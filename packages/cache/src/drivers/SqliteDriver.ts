import type { CacheDriver } from "./CacheDriver.ts";

/**
 * Minimal SQL connection shape this driver needs — a callable tagged-template that
 * runs a query. Declared locally so `@zerotal/cache` stays decoupled from the ORM;
 * any Bun `SQL` instance (or the ORM's `SQLInstance`) satisfies it structurally.
 */
interface SqlConnection {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
}

export class SqliteDriver implements CacheDriver {
  private _sql: SqlConnection;
  private _ready: Promise<void>;

  constructor(sqlInstance: SqlConnection) {
    this._sql = sqlInstance;
    this._ready = this._ensureTable();
  }

  private async _ensureTable(): Promise<void> {
    await this._sql`
      CREATE TABLE IF NOT EXISTS zerotal_cache (
        key        TEXT    PRIMARY KEY,
        value      TEXT    NOT NULL,
        expires_at INTEGER
      )
    `;
  }

  async get(key: string): Promise<string | null> {
    await this._ready;
    const now = Math.floor(Date.now() / 1000);
    const rows = await this._sql<{ value: string }>`
      SELECT value
      FROM zerotal_cache
      WHERE key = ${key}
        AND (expires_at IS NULL OR expires_at > ${now})
    `;

    if (rows.length === 0) {
      await this._sql`
        DELETE FROM zerotal_cache
        WHERE key = ${key}
          AND expires_at IS NOT NULL
          AND expires_at <= ${now}
      `;
      return null;
    }

    return rows[0]?.value ?? null;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    await this._ready;
    const expiresAt = ttl === undefined ? null : Math.floor(Date.now() / 1000) + ttl;

    await this._sql`
      INSERT OR REPLACE INTO zerotal_cache (key, value, expires_at)
      VALUES (${key}, ${value}, ${expiresAt})
    `;
  }

  async forget(key: string): Promise<void> {
    await this._ready;
    await this._sql`
      DELETE FROM zerotal_cache
      WHERE key = ${key}
    `;
  }

  async has(key: string): Promise<boolean> {
    await this._ready;
    const now = Math.floor(Date.now() / 1000);
    const rows = await this._sql`
      SELECT 1 AS found
      FROM zerotal_cache
      WHERE key = ${key}
        AND (expires_at IS NULL OR expires_at > ${now})
      LIMIT 1
    `;

    return rows.length > 0;
  }

  async flush(prefix?: string): Promise<void> {
    await this._ready;
    if (prefix === undefined) {
      await this._sql`DELETE FROM zerotal_cache`;
      return;
    }

    const pattern = `${prefix}%`;
    await this._sql`
      DELETE FROM zerotal_cache
      WHERE key LIKE ${pattern}
    `;
  }
}
