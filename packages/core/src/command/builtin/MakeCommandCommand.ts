/**
 * The `make:command` command and the CLI-command source stub it writes.
 */
import { GeneratorCommand } from "../GeneratorCommand.ts";
import { _frameworkImport } from "../appSource.ts";

/** Convert a name to kebab-case (e.g. `SendDailyReport` → `send-daily-report`). */
export function toKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

/** Source for a new CLI command class extending `Command`, importing it from `core`. */
export function commandStub(name: string, core = "zerotal"): string {
  return `import { Command } from "${core}";
import type { ArgDef, FlagDef } from "${core}";

export class ${name} extends Command {
  static commandName = "${toKebab(name)}";
  static description = "Describe what this command does";
  static needsApp = true;

  static args: ArgDef[] = [
    // { name: "target", description: "The target", required: true },
  ];

  static flags: FlagDef[] = [
    // { name: "dry-run", short: "d", type: "boolean" as const,
    //   description: "Preview without making changes", default: false },
  ];

  async run(): Promise<void> {
    this.section("${name}");
    // your implementation here
    this.info("Done.");
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
export class MakeCommandCommand extends GeneratorCommand {
  static override commandName = "make:command";
  static override description = "Create a new CLI command class";

  static override args = [
    { name: "name", required: true, description: "Command class name (e.g. SendDailyReport)" },
  ];

  protected override async generate(): Promise<void> {
    const name = this.args["name"]!;
    const path = commandPath(name);
    if (!(await this.writeFile(path, commandStub(name, _frameworkImport("@zerotal/core"))))) return;
    // app/commands/ is auto-discovered, so the command is immediately runnable. Every
    // starter's package.json has a `zt` script, so `bun zt` is how an app runs one.
    this.next(`Run it with: bun zt ${toKebab(name)}`);
  }
}
