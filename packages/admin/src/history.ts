/**
 * Record history — who changed what, and putting it back.
 *
 * `@zerotal/audit` already records every create, update and delete on a model
 * that composes `Auditable`. This turns that into something a person can read on
 * the record's own page, and — where the change was an update — undo:
 *
 *   export class OrderResource extends Resource {
 *     static override history = true;
 *   }
 *
 * The audit package is resolved lazily, so it stays an optional peer: a resource
 * that asks for history without it installed simply shows nothing.
 */
import { frameworkLog } from "@zerotal/core/logger";

/** One entry in a record's history, already shaped for display. */
export interface HistoryEntry {
  id: string;
  /** `created`, `updated`, `deleted`, `restored`. */
  event: string;
  /** Who did it, resolved to a name where possible. */
  actor: string | null;
  /** When, as an ISO string. */
  at: string;
  /** Field-by-field before/after, for an update. */
  changes: HistoryChange[];
  /** True when this entry can be put back — an update with recorded old values. */
  revertible: boolean;
}

export interface HistoryChange {
  field: string;
  from: unknown;
  to: unknown;
}

/** The stored audit row, as `@zerotal/audit` writes it. */
interface AuditRow {
  id: unknown;
  event: string;
  actorId: number | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  createdAt: unknown;
}

export interface HistoryOptions {
  /** Model name the audit rows are filed under — defaults to the resource's model. */
  type: string;
  id: unknown;
  /** How many entries to show. Defaults to 25 — a record page is not an archive. */
  limit?: number;
  /** Turn an actor id into a name. Defaults to `#<id>`. */
  resolveActor?: (id: number) => Promise<string | null> | string | null;
}

/** Fields that change on every write and say nothing about intent. */
const NOISE = new Set(["updated_at", "updatedAt", "created_at", "createdAt"]);

/**
 * Read a record's history, newest first.
 *
 * Returns an empty list rather than throwing when the audit package isn't
 * installed or its table doesn't exist yet — a missing history is a missing
 * section, not a broken page.
 */
export async function recordHistory(options: HistoryOptions): Promise<HistoryEntry[]> {
  const limit = options.limit ?? 25;
  try {
    const mod = (await import(/* @vite-ignore */ "@zerotal/audit" as string)) as {
      AuditLog?: {
        forModel?: (
          type: string,
          id: unknown,
        ) => {
          orderBy: (
            c: string,
            d: string,
          ) => { limit: (n: number) => { get: () => Promise<AuditRow[]> } };
        };
      };
    };
    const model = mod.AuditLog;
    if (!model?.forModel) return [];

    const rows = await model
      .forModel(options.type, options.id)
      .orderBy("created_at", "desc")
      .limit(limit)
      .get();

    return Promise.all(rows.map((row) => toEntry(row, options.resolveActor)));
  } catch (error) {
    frameworkLog("admin").warn("Record history unavailable", undefined, error);
    return [];
  }
}

async function toEntry(
  row: AuditRow,
  resolveActor?: HistoryOptions["resolveActor"],
): Promise<HistoryEntry> {
  const changes = diff(row.oldValues, row.newValues);
  let actor: string | null = null;
  if (row.actorId != null) {
    actor = (await resolveActor?.(row.actorId)) ?? `#${row.actorId}`;
  }

  return {
    id: String(row.id),
    event: row.event,
    actor,
    at: stringifyDate(row.createdAt),
    changes,
    // Only an update can be put back: a create has nothing to restore to, and a
    // delete is the restore action's job rather than history's.
    revertible: row.event === "updated" && changes.length > 0,
  };
}

/** Field-by-field difference, ignoring the columns that always move. */
function diff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): HistoryChange[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes: HistoryChange[] = [];
  for (const field of keys) {
    if (NOISE.has(field)) continue;
    const from = before?.[field];
    const to = after?.[field];
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes.push({ field, from, to });
  }
  return changes;
}

/** The values that would put a record back to how it was before an entry.
 *
 * @internal
 */
export function revertPayload(entry: HistoryEntry): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const change of entry.changes) payload[change.field] = change.from;
  return payload;
}

function stringifyDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const withIso = value as { toISOString?: () => string } | null | undefined;
  if (typeof withIso?.toISOString === "function") return withIso.toISOString();
  return String(value ?? "");
}
