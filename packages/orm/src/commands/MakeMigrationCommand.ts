import { Command, Str } from "@zerotal/core";

export type MigrationFileResult = {
  path: string;
  created: boolean;
};

/**
 * Converts a migration name (e.g. `create_posts_table`) into a PascalCase
 * class name (e.g. `CreatePostsTable`) for use in the generated stub.
 */
export function toMigrationClassName(name: string): string {
  return Str.pascalCase(name);
}

/** What a generated migration is told about the table it creates. */
export type MigrationStubOptions = {
  /** The table `up()` creates and `down()` drops. Left as a placeholder to fill in when absent. */
  table?: string | undefined;
  /** Column lines for `up()`, between the id and the timestamps. */
  columns?: readonly string[] | undefined;
};

/**
 * The table a migration named `create_<table>_table` creates, or `undefined` for any other name
 * (`add_email_to_users` changes a table rather than creating one, so it has nothing to infer).
 */
export function tableFromMigrationName(name: string): string | undefined {
  return /^create_(.+)_table$/.exec(name)?.[1];
}

/**
 * Returns the source text of a migration file whose default-exported class is named
 * `className`. Without a `table` it creates a placeholder, `table_name`, for the author to
 * replace.
 */
export function migrationStub(className: string, options: MigrationStubOptions = {}): string {
  const table = options.table ?? "table_name";
  const columns = (options.columns ?? []).map((line) => `      ${line}\n`).join("");
  return `import { Migration, Schema } from '@zerotal/orm';

export default class ${className} extends Migration {
  override async up(): Promise<void> {
    await Schema.create('${table}', (table) => {
      table.increments('id');
${columns}      table.timestamps();
    });
  }

  override async down(): Promise<void> {
    await Schema.drop('${table}');
  }
}
`;
}

/**
 * Lists the existing `database/migrations/*.ts` file paths, used to derive the
 * next zero-padded numeric prefix.
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
 * Writes a new numbered migration file for `name` under `database/migrations/`,
 * returning its path and whether it was created (`false` if one already exists).
 *
 * The table is `options.table`, else the one a `create_<table>_table` name spells out.
 */
export async function createMigrationFile(
  name: string,
  options: MigrationStubOptions = {},
): Promise<MigrationFileResult> {
  const files = await listMigrationFiles();
  const nextNumber = files.length + 1;
  const prefix = String(nextNumber).padStart(3, "0");
  const fileName = `${prefix}_${name}.ts`;
  const path = `database/migrations/${fileName}`;

  if (await Bun.file(path).exists()) {
    return { path, created: false };
  }

  // Bun.write() creates any missing parent directories, so no mkdir is needed.
  const table = options.table ?? tableFromMigrationName(name);
  await Bun.write(
    path,
    migrationStub(toMigrationClassName(name), {
      ...(table ? { table } : {}),
      ...(options.columns ? { columns: options.columns } : {}),
    }),
  );
  return { path, created: true };
}

/**
 * Scaffolds a new migration file (`bun zt make:migration`).
 *
 * Writes a migration with `up()`/`down()` stubs to `database/migrations/`, prefixed with the
 * next zero-padded sequence number. A name of the form `create_<table>_table` also names the
 * table it creates.
 *
 * @example
 * ```bash
 * bun zt make:migration create_posts_table
 * ```
 *
 * @category Scaffolding (make:*)
 */
export class MakeMigrationCommand extends Command {
  static commandName = "make:migration";
  static description = "Create a new migration file";
  static needsApp = false;
  static args = [
    {
      name: "name",
      required: true,
      description: "Migration name (e.g. create_posts_table)",
    },
  ];

  async run(): Promise<void> {
    const name = this.args["name"]!;
    const result = await createMigrationFile(name);

    if (!result.created) {
      this.error(`File already exists: ${result.path}`);
      return;
    }

    this.info(`Created: ${result.path}`);
  }
}
