import { SchemaInspector } from "./SchemaInspector.ts";
import { columnDbName, type ModelSchema, type ModelColumn } from "./ModelInspector.ts";

// -- Diff result types ---------------------------------------------------------

export interface NewTable {
  schema: ModelSchema;
}

export interface NewColumn {
  table: string;
  column: ModelColumn;
}

export interface DroppedColumn {
  table: string;
  column: string;
}

export interface DiffResult {
  newTables: NewTable[];
  newColumns: NewColumn[];
  /**
   * Columns that exist in the live table but are no longer declared by the model.
   * Only ever acted on by a *disruptive* `synchronize` - additive sync and
   * `migrate:generate` ignore these to avoid accidental data loss.
   */
  droppedColumns: DroppedColumn[];
}

// -- SchemaDiffer --------------------------------------------------------------

/**
 * Compares a set of model schemas against the live database and returns
 * the deltas: tables that need to be created and columns that need to be added.
 *
 * Additive deltas (newTables, newColumns) are always safe to apply. Dropped
 * columns are reported separately and only applied by a disruptive synchronize.
 */
export const SchemaDiffer = {
  async diff(schemas: ModelSchema[]): Promise<DiffResult> {
    const newTables: NewTable[] = [];
    const newColumns: NewColumn[] = [];
    const droppedColumns: DroppedColumn[] = [];

    for (const schema of schemas) {
      const live = await SchemaInspector.describe(schema.table);

      if (live === null) {
        // Entire table is new - generate a CREATE TABLE migration.
        newTables.push({ schema });
        continue;
      }

      // Table exists - find columns that the model declares but the DB doesn't have.
      const liveNames = new Set(live.columns.map((c) => c.name));

      // The full set of columns the model expects to exist: declared columns plus
      // the framework-managed ones (primary key, timestamps, soft-deletes). Any live
      // column outside this set is a candidate drop (disruptive sync only). Compare in
      // snake_case (the DB convention) so camelCase model props match their real columns.
      const expected = new Set<string>(schema.columns.map((c) => columnDbName(c.name)));
      if (schema.primaryKey) expected.add(columnDbName(schema.primaryKey));
      if (schema.timestamps) {
        expected.add("created_at");
        expected.add("updated_at");
      }
      if (schema.softDeletes) expected.add("deleted_at");

      for (const col of live.columns) {
        // Never drop the primary key, and never drop a still-declared column.
        if (col.primary || expected.has(col.name)) continue;
        droppedColumns.push({ table: schema.table, column: col.name });
      }

      for (const col of schema.columns) {
        // The model column carries its raw (camelCase) name; the DB has it snake_cased.
        if (!liveNames.has(columnDbName(col.name))) {
          newColumns.push({ table: schema.table, column: col });
        }
      }

      // Check timestamp columns that Blueprint.timestamps() would add.
      if (schema.timestamps) {
        if (!liveNames.has("created_at")) {
          newColumns.push({
            table: schema.table,
            column: {
              name: "created_at",
              type: "datetime",
              nullable: true,
              primary: false,
              default: undefined,
            },
          });
        }
        if (!liveNames.has("updated_at")) {
          newColumns.push({
            table: schema.table,
            column: {
              name: "updated_at",
              type: "datetime",
              nullable: true,
              primary: false,
              default: undefined,
            },
          });
        }
      }

      // Check soft-delete column that Blueprint.softDeletes() would add.
      if (schema.softDeletes && !liveNames.has("deleted_at")) {
        newColumns.push({
          table: schema.table,
          column: {
            name: "deleted_at",
            type: "datetime",
            nullable: true,
            primary: false,
            default: undefined,
          },
        });
      }
    }

    return { newTables, newColumns, droppedColumns };
  },

  /**
   * True when there is nothing *additive* to generate. Dropped columns are
   * deliberately excluded: `migrate:generate` never emits drops, so a table with
   * only dropped columns is still "in sync" from the generator's perspective.
   */
  isEmpty(diff: DiffResult): boolean {
    return diff.newTables.length === 0 && diff.newColumns.length === 0;
  },
};
