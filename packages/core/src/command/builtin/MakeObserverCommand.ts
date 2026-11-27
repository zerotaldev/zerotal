/**
 * The `make:observer` command, which scaffolds a model observer class.
 */
import { GeneratorCommand } from "../GeneratorCommand.ts";
import { _frameworkImport } from "../appSource.ts";

/**
 * `bun zt make:observer <name>` — scaffolds a new model observer class under
 * `app/observers/` (pass `--model`/`-m` to target a specific model).
 *
 * @category Scaffolding (make:*)
 */
export class MakeObserverCommand extends GeneratorCommand {
  static override commandName = "make:observer";
  static override description = "Create a new model observer class";

  static override args = [
    { name: "name", required: true, description: "Observer name (e.g. UserObserver)" },
  ];

  static override flags = [
    {
      name: "model",
      short: "m",
      type: "string" as const,
      description: "Model the observer is for (e.g. User)",
      default: "",
    },
  ];

  protected override async generate(): Promise<void> {
    const name = this.args["name"]!;
    const model = (this.flags["model"] as string) || name.replace(/Observer$/, "");
    const path = `app/observers/${name}.ts`;
    if (!(await this.writeFile(path, _observerStub(name, model, _frameworkImport("@zerotal/orm")))))
      return;

    // `XObserver` in app/observers/ is attached to model X at boot. Any other name is not.
    this.next(
      name === `${model}Observer`
        ? `Nothing to register: app/observers/ attaches ${name} to ${model} at boot.`
        : `Attach it to the model, e.g. in a provider's onBooted(): ${model}.observe(${name});`,
    );
  }
}

/** `Task` → `task`; a model called `Record` or `Object` gets a name that shadows nothing. */
function parameterFor(model: string): string {
  const name = model.charAt(0).toLowerCase() + model.slice(1);
  return name === "record" || name === "object" ? "model" : name;
}

/**
 * The generated file.
 *
 * @internal
 */
export function _observerStub(name: string, model: string, orm = "zerotal/orm"): string {
  const record = parameterFor(model);
  const hook = (event: string) =>
    `  ${event}(${record}: Record<string, unknown>): void {\n    void ${record};\n  }`;
  return `import type { ModelObserver } from "${orm}";

export class ${name} implements ModelObserver {
${["creating", "created", "updating", "updated", "deleting", "deleted"].map(hook).join("\n\n")}
}
`;
}
