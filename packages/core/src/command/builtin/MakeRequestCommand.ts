/**
 * The `make:request` command, which scaffolds a FormRequest validation class.
 */
import { GeneratorCommand } from "../GeneratorCommand.ts";
import { _frameworkImport } from "../appSource.ts";

/**
 * `bun zt make:request <name>` — scaffolds a new FormRequest validation class
 * under `app/requests/`.
 *
 * @category Scaffolding (make:*)
 */
export class MakeRequestCommand extends GeneratorCommand {
  static override commandName = "make:request";
  static override description = "Create a new FormRequest class";
  static override args = [
    { name: "name", required: true, description: "Request class name (e.g. StorePostRequest)" },
  ];

  protected override async generate(): Promise<void> {
    const name = this.args["name"]!;
    const path = `app/requests/${name}.ts`;
    if (!(await this.writeFile(path, _requestStub(name, _frameworkImport("@zerotal/validator")))))
      return;
    this.next(
      `Validate with it in a controller or route: const data = await ${name}.validate();`,
      `Fill in rules(); each field arrives typed by the rule that checks it.`,
    );
  }
}

/**
 * The generated file.
 *
 * Two things this stub deliberately does not do.
 *
 * It imports through the app's own specifier (`zerotal/validator` in a starter), not
 * `@zerotal/validator`: a scaffolded app depends on the umbrella, so the scoped name resolves to
 * nothing and the file it just generated does not compile.
 *
 * And it leaves `rules()` unannotated. `validate()` reads the narrow return type through
 * `ReturnType<T['rules']>`, so writing `Record<string, FieldRule>` there widens it back and every
 * validated field arrives as `unknown` — silently, with the first sign a cast somewhere
 * downstream. `FormRequest`'s own docblock says so; the generator used to emit exactly what it
 * warns against.
 *
 * @internal
 */
export function _requestStub(name: string, validator = "zerotal/validator"): string {
  return `import { FormRequest } from "${validator}";
import type { RuleBuilder } from "${validator}";

export class ${name} extends FormRequest {
  rules(r: RuleBuilder) {
    return {
      // example: title: r.string().min(3).max(255),
    };
  }
}
`;
}
