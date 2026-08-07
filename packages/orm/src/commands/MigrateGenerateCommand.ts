import path from "node:path";
import { Command } from "@zerotal/core";
import { ModelInspector } from "../schema/ModelInspector.ts";
import { SchemaDiffer } from "../schema/SchemaDiffer.ts";
import { generateMigrationContent } from "../schema/MigrationCodegen.ts";
import { toMigrationClassName } from "./MakeMigrationCommand.ts";

/**
 * Lists the existing `database/migrations/*.ts` file paths, used to derive the
 * next zero-padded numeric prefix for the generated migration.
 *
 * @internal
 */
async function listMigrationFiles(): Promise<string[]> {
  const glob = new Bun.Glob("database/migrations/*.ts");
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: process.cwd() })) {
    files.push(file);
  }
  return files;
}

/**
 * Auto-generates a migration from model schema changes (`bun zt migrate:generate`).
 *
 * Loads the model files matching the `--models` glob, diffs their `@column()`
 * schemas against the live database, and writes a numbered migration under
 * `database/migrations/` describing the new tables and columns. Reports "No
 * schema changes detected" when the models and database already agree.
 *
 * @example
 * ```bash
 * bun zt migrate:generate create_posts_table
 * bun zt migrate:generate add_slug_to_posts --models "app/models/**\/*.ts"
 * ```
 *
 * @category Migrations
 */
export class MigrateGenerateCommand extends Command {
  static override commandName = "migrate:generate";
  static override description = "Auto-generate a migration from model schema changes";
  static override needsApp = false;

  static override args = [
    {
      name: "name",
      required: true,
      description: "Migration name (e.g. create_posts_table)",
    },
  ];

  static override flags = [
    {
      name: "models",
      type: "string" as const,
      description: "Glob pattern for model files to inspect",
      default: "app/models/**/*.ts",
    },
  ];

  async run(): Promise<void> {
    const name = this.args["name"]!;
    const modelsPattern = (this.flags["models"] as string | undefined) ?? "app/models/**/*.ts";

    // ── 1. Import model files ────────────────────────────────────────────────
    this.dim(`Scanning models: ${modelsPattern}`);
    await ModelInspector.load(modelsPattern);

    const schemas = ModelInspector.all();
    if (schemas.length === 0) {
      this.warn(`No models found matching: ${modelsPattern}`);
      this.dim("Ensure models use @column() decorators and set static table.");
      return;
    }
    this.dim(`Found ${schemas.length} model(s)`);

    // ── 2. Diff against live DB ──────────────────────────────────────────────
    const diff = await SchemaDiffer.diff(schemas);

    if (SchemaDiffer.isEmpty(diff)) {
      this.info("No schema changes detected — nothing to generate.");
      return;
    }

    // ── 3. Generate migration content ────────────────────────────────────────
    const className = toMigrationClassName(name);
    const content = generateMigrationContent(className, diff);

    // ── 4. Write the migration file ──────────────────────────────────────────
    const existing = await listMigrationFiles();
    const nextNumber = existing.length + 1;
    const prefix = String(nextNumber).padStart(3, "0");
    const filePath = path.join("database", "migrations", `${prefix}_${name}.ts`);
    const absPath = path.resolve(process.cwd(), filePath);

    // Bun.write() creates any missing parent directories, so no mkdir is needed.
    await Bun.write(absPath, content);

    // ── 5. Report ────────────────────────────────────────────────────────────
    this.info(`Generated: ${filePath}`);

    if (diff.newTables.length > 0) {
      this.line(`  + New tables:  ${diff.newTables.map((t) => t.schema.table).join(", ")}`);
    }
    if (diff.newColumns.length > 0) {
      const cols = diff.newColumns.map((c) => `${c.table}.${c.column.name}`);
      this.line(`  + New columns: ${cols.join(", ")}`);
    }
  }
}
