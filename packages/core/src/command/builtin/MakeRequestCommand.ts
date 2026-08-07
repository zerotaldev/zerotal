/**
 * The `make:request` command, which scaffolds a FormRequest validation class.
 */
import { Command } from "../Command.ts";

/**
 * `bun zt make:request <name>` — scaffolds a new FormRequest validation class
 * under `app/requests/`.
 *
 * @category Scaffolding (make:*)
 */
export class MakeRequestCommand extends Command {
  static commandName = "make:request";
  static description = "Create a new FormRequest class";
  static needsApp = false;
  static override args = [{ name: "name", required: true, default: "" }];

  async run(): Promise<void> {
    const name = this.args["name"];
    if (!name) {
      this.error("Name is required.");
      return;
    }
    const path = `app/requests/${name}.ts`;
    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }
    await Bun.write(path, stub(name));
    this.info(`Created: ${path}`);
  }
}

function stub(name: string): string {
  return `import { FormRequest } from '@zerotal/validator';
import type { RuleBuilder }  from '@zerotal/validator';
import type { FieldRule }    from '@zerotal/validator';

export class ${name} extends FormRequest {
  rules(r: RuleBuilder): Record<string, FieldRule> {
    return {
      // example: title: r.string().min(3).max(255),
    };
  }
}
`;
}
