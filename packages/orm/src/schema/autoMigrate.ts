import type { ConcernDescriptor } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { ModelInspector, columnDbName } from "./ModelInspector.ts";
import { SchemaDiffer, type DiffResult } from "./SchemaDiffer.ts";
import { Schema } from "./Schema.ts";
import type { ModelColumn } from "./ModelInspector.ts";

// Mirrors MigrationCodegen's mapping so synchronize() produces the same schema as
// `migrate:generate` would - but applies it directly instead of writing a migration file.
const BLUEPRINT_METHOD: Record<string, string> = {
  string: "string",
  number: "integer",
  boolean: "boolean",
  datetime: "dateTime",
  json: "json",
};

type ColumnBuilder = { nullable(): ColumnBuilder; default(v: unknown): ColumnBuilder };
type TableBuilder = Record<string, (name: string) => ColumnBuilder> & {
  increments(name: string): unknown;
  timestamps(): void;
  softDeletes(): void;
  dropColumn(...names: string[]): unknown;
};

function applyColumn(table: TableBuilder, col: ModelColumn): void {
  const method = BLUEPRINT_METHOD[col.type ?? "string"] ?? "string";
  // Models declare columns in camelCase; the ORM reads/writes snake_case — emit snake_case
  // so synchronize produces columns the runtime can actually read (e.g. two_factor_secret).
  const builder = table[method]!(columnDbName(col.name));
  if (col.nullable) builder.nullable();
  if (col.default !== undefined) builder.default(col.default);
}

/** Options for {@link synchronizeSchema}. */
export interface SynchronizeOptions {
  /**
   * When true, also DROP columns that exist in the database but are no longer
   * declared by any model. Off by default - additive changes are always safe,
   * drops can lose data.
   */
  disruptive?: boolean;
}

/**
 * Schema sync (TypeORM-style `synchronize`): create missing tables and add missing columns
 * to match the registered models. By default it is additive only and never drops or alters
 * existing columns.
 *
 * Pass `{ disruptive: true }` to also drop columns that no model declares anymore - an
 * explicit opt-in, since dropping a column destroys its data.
 *
 * Returns the diff that was applied (additive deltas are empty when already in sync;
 * `droppedColumns` is populated but only acted on when `disruptive` is set).
 */
export async function synchronizeSchema(options: SynchronizeOptions = {}): Promise<DiffResult> {
  const diff = await SchemaDiffer.diff(ModelInspector.all());

  for (const { schema } of diff.newTables) {
    await Schema.createIfNotExists(schema.table, (blueprint) => {
      const table = blueprint as unknown as TableBuilder;
      table.increments(columnDbName(schema.primaryKey));
      for (const col of schema.columns) {
        if (col.primary) continue; // increments() covers the PK
        applyColumn(table, col);
      }
      if (schema.timestamps) table.timestamps();
      if (schema.softDeletes) table.softDeletes();
    });
  }

  const byTable = new Map<string, ModelColumn[]>();
  for (const nc of diff.newColumns) {
    const bucket = byTable.get(nc.table) ?? [];
    bucket.push(nc.column);
    byTable.set(nc.table, bucket);
  }
  for (const [table, cols] of byTable) {
    await Schema.table(table, (blueprint) => {
      const tb = blueprint as unknown as TableBuilder;
      for (const col of cols) applyColumn(tb, col);
    });
  }

  // Disruptive phase: drop columns the models no longer declare. Opt-in only.
  if (options.disruptive && diff.droppedColumns.length > 0) {
    const dropsByTable = new Map<string, string[]>();
    for (const dc of diff.droppedColumns) {
      const bucket = dropsByTable.get(dc.table) ?? [];
      bucket.push(dc.column);
      dropsByTable.set(dc.table, bucket);
    }
    for (const [table, names] of dropsByTable) {
      console.warn(
        `[Zerotal] synchronize (disruptive): dropping ${table}.{${names.join(", ")}} - data will be lost.`,
      );
      await Schema.table(table, (blueprint) => {
        (blueprint as unknown as TableBuilder).dropColumn(...names);
      });
    }
  }

  return diff;
}

/** Resolved, normalised form of the `database.synchronize` config value. */
export interface ResolvedSyncOptions {
  enabled: boolean;
  disruptive: boolean;
}

/**
 * Normalise the polymorphic `database.synchronize` config into `{ enabled, disruptive }`.
 *
 *   false / undefined        -> { enabled: false, disruptive: false }
 *   true                     -> { enabled: true,  disruptive: false }  (additive)
 *   { enabled, disruptive? } -> as given (enabled defaults true when the object is present)
 */
export function resolveSyncOptions(raw: unknown): ResolvedSyncOptions {
  if (raw === true) return { enabled: true, disruptive: false };
  if (raw && typeof raw === "object") {
    const o = raw as { enabled?: boolean; disruptive?: boolean };
    const enabled = o.enabled !== false;
    // Disruptive only matters when enabled — force it off otherwise.
    return { enabled, disruptive: enabled && o.disruptive === true };
  }
  return { enabled: false, disruptive: false };
}

/**
 * One-shot convention (runs after `models`, order 100). Applies `synchronizeSchema()` only when
 * `database.synchronize` is enabled - strictly opt-in (like TypeORM), and HARD-OFF in
 * `production` regardless (use `migrate` with generated files there).
 *
 * `synchronize` accepts `true` (additive) or `{ enabled, disruptive }` to also drop columns
 * no model declares anymore.
 */
export const autoMigrateConcern: ConcernDescriptor = {
  name: "auto-migrate",
  order: 100,
  async run(ctx) {
    // Hard-off in production. `ctx.env` is the runtime mode (web/console/…), so the
    // deployment name is read from APP_ENV directly.
    if (Bun.env.APP_ENV === "production") return;
    const config = ctx.resolve<ConfigManager>("config");
    const { enabled, disruptive } = resolveSyncOptions(config?.get("database.synchronize"));
    if (!enabled) return;
    try {
      await synchronizeSchema({ disruptive });
    } catch (err) {
      console.error("[Zerotal] auto-migrate (synchronize) failed:", err);
    }
  },
};
