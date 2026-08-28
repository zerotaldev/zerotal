import type { DiffResult, NewColumn } from "./SchemaDiffer.ts";
import { columnDbName, type ModelColumn, type ModelSchema } from "./ModelInspector.ts";

// ── Type mapping ──────────────────────────────────────────────────────────────

// Maps @column({ type }) to the Blueprint method that generates the right SQL.
const BLUEPRINT_METHOD: Record<string, string> = {
  string: "string",
  text: "text",
  number: "integer",
  boolean: "boolean",
  datetime: "dateTime",
  json: "json",
};

/**
 * A column named `*_id` (or `*Id` before snake-casing) is a foreign key by convention,
 * and an unindexed foreign key is a table scan on every join and every cascade check.
 * The reference itself can't always be inferred — the target table is a guess — but the
 * index can, and it is the half that matters for performance.
 */
function _looksLikeForeignKey(dbName: string): boolean {
  return dbName.endsWith("_id") && dbName !== "_id";
}

// ── Code generation helpers ───────────────────────────────────────────────────

function blueprintCall(col: ModelColumn, indent: string): string {
  const method = BLUEPRINT_METHOD[col.type ?? "string"] ?? "string";
  let line = `${indent}table.${method}('${columnDbName(col.name)}')`;
  if (col.nullable) line += ".nullable()";
  if (col.default !== undefined) line += `.default(${JSON.stringify(col.default)})`;
  line += ";";
  return line;
}

/**
 * The index lines for a table: everything declared via `@column({ unique | index })`,
 * plus an inferred index on each foreign-key-shaped column that doesn't already have one.
 */
function indexLines(columns: ModelColumn[], indent: string): string[] {
  const lines: string[] = [];
  for (const col of columns) {
    if (col.primary) continue; // the PK is already indexed by increments()
    const dbName = columnDbName(col.name);
    if (col.unique) {
      lines.push(`${indent}table.unique('${dbName}');`);
    } else if (col.index) {
      lines.push(`${indent}table.index('${dbName}');`);
    } else if (_looksLikeForeignKey(dbName)) {
      lines.push(`${indent}table.index('${dbName}');`);
    }
  }
  return lines;
}

function createTableBlock(schema: ModelSchema): string {
  const lines: string[] = [];
  lines.push(`    await Schema.create('${schema.table}', (table) => {`);
  lines.push(`      table.increments('${columnDbName(schema.primaryKey)}');`);

  for (const col of schema.columns) {
    if (col.primary) continue; // increments() already covers the PK
    lines.push(blueprintCall(col, "      "));
  }

  if (schema.timestamps) lines.push("      table.timestamps();");
  if (schema.softDeletes) lines.push("      table.softDeletes();");

  lines.push(...indexLines(schema.columns, "      "));

  lines.push("    });");
  return lines.join("\n");
}

function alterTableBlocks(newColumns: NewColumn[]): string {
  // Group new columns by table so we emit one ALTER TABLE per table.
  const byTable = new Map<string, NewColumn[]>();
  for (const nc of newColumns) {
    let bucket = byTable.get(nc.table);
    if (!bucket) {
      bucket = [];
      byTable.set(nc.table, bucket);
    }
    bucket.push(nc);
  }

  const blocks: string[] = [];
  for (const [table, cols] of byTable.entries()) {
    const lines: string[] = [];
    lines.push(`    await Schema.table('${table}', (table) => {`);
    for (const nc of cols) lines.push(blueprintCall(nc.column, "      "));
    lines.push(
      ...indexLines(
        cols.map((nc) => nc.column),
        "      ",
      ),
    );
    lines.push("    });");
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate the complete `.ts` source for a migration file from a `DiffResult`.
 *
 * The generated file:
 *   - Creates new tables with `Schema.create()`
 *   - Adds new columns with `Schema.table()` (ALTER TABLE ADD COLUMN)
 *   - Drops created tables in `down()` (column additions are left for manual rollback)
 *
 * @internal
 */
export function generateMigrationContent(className: string, diff: DiffResult): string {
  const upParts: string[] = [];

  for (const { schema } of diff.newTables) {
    upParts.push(createTableBlock(schema));
  }

  if (diff.newColumns.length > 0) {
    upParts.push(alterTableBlocks(diff.newColumns));
  }

  const downParts: string[] = [];
  // Reverse order so dependent tables are dropped before parent tables.
  for (const { schema } of [...diff.newTables].reverse()) {
    downParts.push(`    await Schema.dropIfExists('${schema.table}');`);
  }

  const upBody = upParts.length ? upParts.join("\n") : "    // no-op";
  const downBody = downParts.length ? downParts.join("\n") : "    // no-op";

  return `import { Migration, Schema } from '@zerotal/orm';

export default class ${className} extends Migration {
  override async up(): Promise<void> {
${upBody}
  }

  override async down(): Promise<void> {
${downBody}
  }
}
`;
}
