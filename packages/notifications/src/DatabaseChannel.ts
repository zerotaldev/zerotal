import type { SQLInstance } from "@zerotal/orm";
import type { Notifiable } from "./types.ts";
import { NotificationError } from "./errors.ts";
import { notifiableType } from "./serialization.ts";
import type { Notification } from "./Notification.ts";

/** Build a TemplateStringsArray from a plain string array (mirrors ORM helper). */
function tpl(strings: string[]): TemplateStringsArray {
  return Object.freeze(
    Object.assign([...strings], { raw: [...strings] }),
  ) as unknown as TemplateStringsArray;
}

/** Execute sql with a dynamically-constructed template (table name in static parts). */
async function run<T = Record<string, unknown>>(
  conn: SQLInstance,
  parts: string[],
  ...values: unknown[]
): Promise<T[]> {
  return conn<T>(tpl(parts), ...values);
}

/** Allow only simple identifier characters — guards against injection in table names. */
function safeIdentifier(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new NotificationError(
      `Invalid table name: '${name}'`,
      "E_NOTIFICATION_INVALID_TABLE",
      500,
    );
  }
  return name;
}

/** How many rows `all()` and `unread()` return when no limit is given. */
const DEFAULT_LIMIT = 100;

/** Paging and ordering options for an inbox query. */
export interface InboxQuery {
  /** Maximum rows to return. Default: 100. Pass 0 for no limit. */
  limit?: number;
  /** Rows to skip, for paging. Default: 0. */
  offset?: number;
}

/**
 * Stores notifications in the database.
 * The table and its indexes are created automatically on first use.
 *
 * Schema:
 *   id              TEXT PRIMARY KEY       — UUID
 *   notifiable_type TEXT NOT NULL          — recipient's model class name
 *   notifiable_id   TEXT NOT NULL          — stringified notifiable id
 *   type            TEXT NOT NULL          — notification class name
 *   data            TEXT NOT NULL          — JSON-encoded toDatabase() result
 *   read_at         TEXT                   — ISO timestamp when read; NULL = unread
 *   created_at      TEXT NOT NULL          — ISO timestamp
 *
 * Every read is scoped by `(notifiable_type, notifiable_id)`, not by id alone:
 * ids are only unique within a model, so a `User#1` and a `Team#1` would
 * otherwise share one inbox.
 */
export class DatabaseChannel {
  private readonly _t: string;
  private _ready: Promise<void>;

  constructor(
    table: string,
    private readonly _sql: SQLInstance,
  ) {
    this._t = safeIdentifier(table);
    this._ready = this._ensureTable();
    // The constructor cannot await, so a failure here would otherwise surface as
    // an unhandled rejection before the first query re-awaits it.
    this._ready.catch(() => undefined);
  }

  private async _ensureTable(): Promise<void> {
    await run(this._sql, [
      `CREATE TABLE IF NOT EXISTS ${this._t} (
        id              TEXT PRIMARY KEY,
        notifiable_type TEXT NOT NULL,
        notifiable_id   TEXT NOT NULL,
        type            TEXT NOT NULL,
        data            TEXT NOT NULL,
        read_at         TEXT,
        created_at      TEXT NOT NULL
      )`,
    ]);

    // The inbox is read far more often than it is written, and always by
    // recipient — usually filtered to unread and ordered by recency.
    await run(this._sql, [
      `CREATE INDEX IF NOT EXISTS ${this._t}_notifiable_idx
         ON ${this._t} (notifiable_type, notifiable_id, created_at)`,
    ]);
    await run(this._sql, [
      `CREATE INDEX IF NOT EXISTS ${this._t}_unread_idx
         ON ${this._t} (notifiable_type, notifiable_id, read_at)`,
    ]);
  }

  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    await this._ready;
    const id = crypto.randomUUID();
    const type = notification.constructor.name;
    const data = JSON.stringify(await notification.toDatabase(notifiable));
    const createdAt = new Date().toISOString();

    // N values → N+1 string parts (tagged-template invariant).
    await run(
      this._sql,
      [
        `INSERT INTO ${this._t} (id, notifiable_type, notifiable_id, type, data, read_at, created_at) VALUES (`,
        ", ", // between id and notifiable_type
        ", ", // between notifiable_type and notifiable_id
        ", ", // between notifiable_id and type
        ", ", // between type and data
        ", ", // between data and read_at
        ", ", // between read_at and created_at
        ")", // after created_at
      ],
      id,
      notifiableType(notifiable),
      String(notifiable.id),
      type,
      data,
      null,
      createdAt,
    );
  }

  /** Mark a notification as read by its id. */
  async markAsRead(id: string): Promise<void> {
    await this._ready;
    const readAt = new Date().toISOString();
    await run(this._sql, [`UPDATE ${this._t} SET read_at = `, ` WHERE id = `, ""], readAt, id);
  }

  /** Mark a notification as unread by its id. */
  async markAsUnread(id: string): Promise<void> {
    await this._ready;
    await run(this._sql, [`UPDATE ${this._t} SET read_at = NULL WHERE id = `, ""], id);
  }

  /** Return unread notifications for a notifiable, newest first. */
  async unread(notifiable: Notifiable, query: InboxQuery = {}): Promise<NotificationRecord[]> {
    await this._ready;
    return run<NotificationRecord>(
      this._sql,
      [
        `SELECT * FROM ${this._t} WHERE notifiable_type = `,
        ` AND notifiable_id = `,
        ` AND read_at IS NULL ORDER BY created_at DESC${this._paging(query)}`,
      ],
      notifiableType(notifiable),
      String(notifiable.id),
    );
  }

  /** Return notifications for a notifiable, newest first. */
  async all(notifiable: Notifiable, query: InboxQuery = {}): Promise<NotificationRecord[]> {
    await this._ready;
    return run<NotificationRecord>(
      this._sql,
      [
        `SELECT * FROM ${this._t} WHERE notifiable_type = `,
        ` AND notifiable_id = `,
        ` ORDER BY created_at DESC${this._paging(query)}`,
      ],
      notifiableType(notifiable),
      String(notifiable.id),
    );
  }

  /** How many unread notifications a notifiable has — for a badge, without loading rows. */
  async unreadCount(notifiable: Notifiable): Promise<number> {
    await this._ready;
    const rows = await run<{ count: number }>(
      this._sql,
      [
        `SELECT COUNT(*) AS count FROM ${this._t} WHERE notifiable_type = `,
        ` AND notifiable_id = `,
        ` AND read_at IS NULL`,
      ],
      notifiableType(notifiable),
      String(notifiable.id),
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** Mark every unread notification for a notifiable as read. */
  async markAllAsRead(notifiable: Notifiable): Promise<void> {
    await this._ready;
    const readAt = new Date().toISOString();
    await run(
      this._sql,
      [
        `UPDATE ${this._t} SET read_at = `,
        ` WHERE notifiable_type = `,
        ` AND notifiable_id = `,
        ` AND read_at IS NULL`,
      ],
      readAt,
      notifiableType(notifiable),
      String(notifiable.id),
    );
  }

  /**
   * The most recent stored notifications across every notifiable, newest first.
   * Backs the admin console; use `all()` for one recipient's inbox.
   */
  async recent(limit = 100): Promise<NotificationRecord[]> {
    await this._ready;
    const capped = Math.max(1, Math.floor(limit));
    return run<NotificationRecord>(this._sql, [
      `SELECT * FROM ${this._t} ORDER BY created_at DESC LIMIT ${capped}`,
    ]);
  }

  /** Delete one stored notification by id. */
  async delete(id: string): Promise<void> {
    await this._ready;
    await run(this._sql, [`DELETE FROM ${this._t} WHERE id = `, ""], id);
  }

  /** Delete every stored notification for a notifiable. */
  async clear(notifiable: Notifiable): Promise<void> {
    await this._ready;
    await run(
      this._sql,
      [`DELETE FROM ${this._t} WHERE notifiable_type = `, ` AND notifiable_id = `, ""],
      notifiableType(notifiable),
      String(notifiable.id),
    );
  }

  /**
   * Delete read notifications older than `days`, across every notifiable.
   * Backs `notifications:prune` — an inbox table grows without bound otherwise.
   *
   * @param days - Age threshold in days.
   * @param includeUnread - Also prune notifications never read. Default: false.
   * @returns How many rows were deleted.
   */
  async prune(days: number, includeUnread = false): Promise<number> {
    await this._ready;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

    const before = await this._count();
    if (includeUnread) {
      await run(this._sql, [`DELETE FROM ${this._t} WHERE created_at < `, ""], cutoff);
    } else {
      await run(
        this._sql,
        [`DELETE FROM ${this._t} WHERE created_at < `, ` AND read_at IS NOT NULL`],
        cutoff,
      );
    }
    return before - (await this._count());
  }

  /** Total stored notifications, across every notifiable. */
  async _count(): Promise<number> {
    const rows = await run<{ count: number }>(this._sql, [
      `SELECT COUNT(*) AS count FROM ${this._t}`,
    ]);
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Render LIMIT/OFFSET into the static part of the template.
   *
   * Both are coerced to non-negative integers before interpolation — they are
   * numbers by type, but this is a string concatenated into SQL, so the
   * narrowing is enforced rather than assumed.
   */
  private _paging(query: InboxQuery): string {
    const limit = query.limit === undefined ? DEFAULT_LIMIT : Math.max(0, Math.floor(query.limit));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    if (limit === 0) return offset > 0 ? ` LIMIT -1 OFFSET ${offset}` : "";
    return ` LIMIT ${limit}${offset > 0 ? ` OFFSET ${offset}` : ""}`;
  }
}

export interface NotificationRecord {
  id: string;
  notifiable_type: string;
  notifiable_id: string;
  type: string;
  data: string;
  read_at: string | null;
  created_at: string;
}
