import { Command } from "@zerotal/core";

/**
 * Scaffolds a new database seeder class (`bun zt make:seeder`).
 *
 * Writes `database/seeders/<Name>.ts` containing a `Seeder` subclass with an
 * empty `run()` method to be filled in with seeding logic.
 *
 * @example
 * ```bash
 * bun zt make:seeder UserSeeder
 * ```
 *
 * @category Scaffolding (make:*)
 */
export class MakeSeederCommand extends Command {
  static commandName = "make:seeder";
  static description = "Create a new database seeder class";
  static needsApp = false;
  static args = [
    { name: "name", required: true, description: "Seeder class name (e.g. UserSeeder)" },
  ];

  async run(): Promise<void> {
    const name = this.args["name"]!;
    const path = `database/seeders/${name}.ts`;

    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }

    await Bun.write(path, seederStub(name));
    this.info(`Created: ${path}`);
  }
}

/**
 * Returns the source text of a seeder class file named `name`.
 */
export function seederStub(name: string): string {
  return `import { Seeder } from '@zerotal/orm';

export class ${name} extends Seeder {
  async run(): Promise<void> {
    // Seed your database here
  }
}
`;
}
