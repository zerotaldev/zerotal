/**
 * The `make:policy` command and the authorization-policy source stub it writes.
 */
import { Command } from "../Command.ts";

/**
 * `bun zt make:policy <name>` — scaffolds a new authorization policy class
 * under `app/policies/` (pass `--model`/`-m` to bind it to a model).
 *
 * @category Scaffolding (make:*)
 */
export class MakePolicyCommand extends Command {
  static commandName = "make:policy";
  static description = "Create a new authorization policy class";
  static needsApp = false;
  static args = [{ name: "name", required: true, description: "Policy name (e.g. PostPolicy)" }];
  static flags = [
    {
      name: "model",
      short: "m",
      type: "string" as const,
      description: "The model this policy is for (e.g. Post)",
      default: "",
    },
  ];

  async run(): Promise<void> {
    const name = this.args["name"]!;
    const model = (this.flags["model"] as string) || name.replace(/Policy$/, "");
    const path = `app/policies/${name}.ts`;

    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }

    await Bun.write(path, policyStub(name, model));
    this.info(`Created: ${path}`);
  }
}

/** Source for a new authorization policy class extending `Policy`. */
export function policyStub(name: string, model: string): string {
  return `import { Policy } from '@zerotal/auth';
// import type { ${model} } from '../models/${model}.ts';
// import type { User } from '../models/User.ts';

export class ${name} extends Policy<unknown> {
  view(_user: unknown | null, _resource: unknown): boolean {
    return true;
  }

  create(_user: unknown): boolean {
    return true;
  }

  update(_user: unknown, _resource: unknown): boolean {
    return true;
  }

  delete(_user: unknown, _resource: unknown): boolean {
    return true;
  }
}
`;
}
