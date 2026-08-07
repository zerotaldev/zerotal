/**
 * The `make:observer` command, which scaffolds a model observer class.
 */
import { Command } from "../Command.ts";

/**
 * `bun zt make:observer <name>` — scaffolds a new model observer class under
 * `app/observers/` (pass `--model`/`-m` to target a specific model).
 *
 * @category Scaffolding (make:*)
 */
export class MakeObserverCommand extends Command {
  static commandName = "make:observer";
  static description = "Create a new model observer class";
  static needsApp = false;

  static args = [
    { name: "name", required: true, description: "Observer name (e.g. UserObserver)" },
  ];

  static flags = [
    {
      name: "model",
      short: "m",
      type: "string" as const,
      description: "Model the observer is for (e.g. User)",
      default: "",
    },
  ];

  async run(): Promise<void> {
    const name = this.args["name"]!;
    const model = (this.flags["model"] as string) || name.replace(/Observer$/, "");
    const path = `app/observers/${name}.ts`;

    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }

    await Bun.write(path, _stub(name, model));
    this.info(`Created: ${path}`);
    this.line("");
    this.line(`Register it in a ServiceProvider:`);
    this.dim(`  ${model}.observe(${name});`);
  }
}

function _stub(name: string, model: string): string {
  return `import type { ModelObserver } from '@zerotal/orm';

export class ${name} implements ModelObserver {
  creating(${model.toLowerCase()}: Record<string, unknown>): void {
    //
  }

  created(${model.toLowerCase()}: Record<string, unknown>): void {
    //
  }

  updating(${model.toLowerCase()}: Record<string, unknown>): void {
    //
  }

  updated(${model.toLowerCase()}: Record<string, unknown>): void {
    //
  }

  deleting(${model.toLowerCase()}: Record<string, unknown>): void {
    //
  }

  deleted(${model.toLowerCase()}: Record<string, unknown>): void {
    //
  }
}
`;
}
