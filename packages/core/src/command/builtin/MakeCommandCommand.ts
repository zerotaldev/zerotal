/**
 * The `make:command` command and the CLI-command source stub it writes.
 */
import { Command } from "../Command.ts";

/** Convert a name to kebab-case (e.g. `SendDailyReport` → `send-daily-report`). */
export function toKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

/** Source for a new CLI command class extending `Command`. */
export function commandStub(name: string): string {
  return `import { Command } from 'zerotal';
import type { ArgDef, FlagDef } from 'zerotal';

export class ${name} extends Command {
  static commandName = '${toKebab(name)}';
  static description = 'Describe what this command does';
  static needsApp    = true;

  static args: ArgDef[] = [
    // { name: 'target', description: 'The target', required: true },
  ];

  static flags: FlagDef[] = [
    // { name: 'dry-run', short: 'd', type: 'boolean' as const,
    //   description: 'Preview without making changes', default: false },
  ];

  async run(): Promise<void> {
    this.section('${name}');
    // your implementation here
    this.info('Done.');
  }
}
`;
}

function commandPath(name: string): string {
  return `app/commands/${name}.ts`;
}

/**
 * `bun zt make:command <name>` — scaffolds a new CLI command class (extending
 * {@link Command}) under `app/commands/`.
 *
 * @category Scaffolding (make:*)
 */
export class MakeCommandCommand extends Command {
  static commandName = "make:command";
  static description = "Create a new CLI command class";
  static needsApp = false;

  static get args() {
    return [
      { name: "name", required: true, description: "Command class name (e.g. SendDailyReport)" },
    ];
  }

  static get flags() {
    return [];
  }

  run(): Promise<void> {
    const name = this.args["name"]!;
    const path = commandPath(name);

    return Bun.file(path)
      .exists()
      .then((exists) => {
        if (exists) {
          this.error(`File already exists: ${path}`);
          return;
        }
        // Bun.write() creates any missing parent directories, so no mkdir is needed.
        return Bun.write(path, commandStub(name)).then(() => {
          this.info(`Created: ${path}`);
          // app/commands/ is auto-discovered, so the command is immediately runnable.
          this.info(`Run it with: bun zt.ts ${toKebab(name)}`);
        });
      });
  }
}
