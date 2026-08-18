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

// Two things this stub deliberately does not do.
//
// It imports from `zerotal/validator`, not `@zerotal/validator`: a scaffolded app
// depends on the umbrella, so the scoped name resolves to nothing and the file it
// just generated does not compile.
//
// And it leaves `rules()` unannotated. `validate()` reads the narrow return type
// through `ReturnType<T['rules']>`, so writing `Record<string, FieldRule>` there
// widens it back and every validated field arrives as `unknown` — silently, with
// the first sign a cast somewhere downstream. `FormRequest`'s own docblock says
// so; the generator used to emit exactly what it warns against.
function stub(name: string): string {
  return `import { FormRequest } from 'zerotal/validator';
import type { RuleBuilder } from 'zerotal/validator';

export class ${name} extends FormRequest {
  rules(r: RuleBuilder) {
    return {
      // example: title: r.string().min(3).max(255),
    };
  }
}
`;
}
