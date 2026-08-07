import type { DiffResult, NewColumn } from "./SchemaDiffer.ts";
import { columnDbName, type ModelColumn, type ModelSchema } from "./ModelInspector.ts";

// ── Type mapping ──────────────────────────────────────────────────────────────

// Maps @column({ type }) to the Blueprint method that generates the right SQL.
const BLUEPRINT_METHOD: Record<string, string> = {
  string: "string",
  number: "integer",
  boolean: "boolean",
  datetime: "dateTime",
  json: "json",
};

// ── Code generation helpers ───────────────────────────────────────────────────

function blueprintCall(col: ModelColumn, indent: string): string {
  const method = BLUEPRINT_METHOD[col.type ?? "string"] ?? "string";
  let line = `${indent}table.${method}('${columnDbName(col.name)}')`;
  if (col.nullable) line += ".nullable()";
  if (col.default !== undefined) line += `.default(${JSON.stringify(col.default)})`;
  line += ";";
  return line;
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
