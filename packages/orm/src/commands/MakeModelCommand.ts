import { Command, tableNameFor } from "@zerotal/core";
import { createMigrationFile } from "./MakeMigrationCommand.ts";

/**
 * Returns the source text of a model class named `name` bound to `tableName`.
 */
export function modelStub(name: string, tableName: string): string {
  return `import { BaseModel, column, table } from '@zerotal/orm';

@table('${tableName}')
export class ${name} extends BaseModel {
  // Models guard every attribute by default. List the columns that may be
  // mass-assigned from user input via create() / fill().
  //
  // \`as const\` is what lets create() narrow its payload to exactly these columns,
  // so a column kept out of this list is neither required by the type nor accepted
  // at runtime — instead of being demanded by one and refused by the other.
  static override fillable = ['name'] as const;

  @column() name!: string;

  // A nullable column is declared \`?: T | undefined\`, not \`?: T\`. The scaffold
  // enables exactOptionalPropertyTypes, under which \`?: T\` means "may be absent,
  // but never undefined" — so clearing the field, which is the whole point of a
  // nullable column, would not typecheck.
  // @column({ nullable: true }) note?: string | undefined;
}
`;
}

/**
 * Scaffolds a new model class (`bun zt make:model`).
 *
 * Writes an `app/models/<Name>.ts` file containing a `BaseModel` subclass bound to the
 * conventional table name for the model (`Post` is `posts`), the same name auto-discovery
 * derives. Passing `--migration` (`-m`) also generates a `create_<table>_table` migration that
 * creates that table with the stub's `name` column.
 *
 * @example
 * ```bash
 * bun zt make:model Post
 * bun zt make:model Post --migration
 * ```
 *
 * @category Scaffolding (make:*)
 */
export class MakeModelCommand extends Command {
  static commandName = "make:model";
  static description = "Create a new model class";
  static needsApp = false;
  static args = [
    {
      name: "name",
      required: true,
      description: "Model name (e.g. User)",
    },
  ];
  static flags = [
    {
      name: "migration",
      short: "m",
      type: "boolean" as const,
      description: "Also create a migration file",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const name = this.args["name"]!;
    const path = `app/models/${name}.ts`;

    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }

    // The same function auto-discovery uses, so the table named here is the one the ORM would
    // have picked had `@table` been left off.
    const tableName = tableNameFor(name);

    // Bun.write() creates any missing parent directories, so no mkdir is needed.
    await Bun.write(path, modelStub(name, tableName));
    this.info(`Created: ${path}`);

    const withMigration = this.flags["migration"] as boolean;
    if (withMigration) {
      const migrationName = `create_${tableName}_table`;
      // `name` is the column modelStub() declares and lists as fillable.
      const result = await createMigrationFile(migrationName, {
        table: tableName,
        columns: ["table.string('name');"],
      });
      if (!result.created) {
        this.error(`File already exists: ${result.path}`);
        return;
      }
      this.info(`Created: ${result.path}`);
    }
  }
}
