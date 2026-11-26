import { Command, Str } from "@zerotal/core";
import {
  _frameworkImport,
  _readModel,
  _relativeImport,
  _writeAppSource,
  type _ModelShape,
} from "@zerotal/core/commands";

/**
 * Scaffolds a new model factory (`bun zt make:factory`).
 *
 * Writes `database/factories/<Model>Factory.ts` defining a `Factory` for the
 * named model, ready to be imported in tests to build and persist records.
 *
 * @example
 * ```bash
 * bun zt make:factory User
 * ```
 *
 * @category Scaffolding (make:*)
 */
export class MakeFactoryCommand extends Command {
  static commandName = "make:factory";
  static description = "Create a new model factory";
  static needsApp = false;
  static args = [{ name: "model", required: true, description: "Model name (e.g. User)" }];

  async run(): Promise<void> {
    // `make:factory TaskFactory` is read as the factory's name, not a model called
    // `TaskFactory`: it wrote `TaskFactoryFactory`, importing a model that does not exist.
    const model = this.args["model"]!.replace(/(?<=.)Factory$/, "");
    const path = `database/factories/${model}Factory.ts`;

    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }

    const shape = _readModel(model);
    const modelImport = _relativeImport(path, shape?.file ?? `app/models/${model}`);
    await _writeAppSource(
      path,
      factoryStub(model, {
        testing: _frameworkImport("@zerotal/testing"),
        modelImport: `${modelImport}.ts`,
        ...(shape ? { columns: _factoryColumns(shape) } : {}),
      }),
    );
    this.info(`Created: ${path}`);
    if (!shape) {
      this.warn(
        `  No model exports ${model} in app/models/. Run \`bun zt make:model ${model}\`, ` +
          `or change the import.`,
      );
    }
    this.dim(
      `Import in tests: import { ${model}Factory } from "../database/factories/${model}Factory.ts";`,
    );
  }
}

/** What {@link factoryStub} is told about the app and the model. */
export interface FactoryStubOptions {
  /** The specifier `Factory` is imported by. `zerotal/testing` unless given. */
  testing?: string | undefined;
  /** The import of the model, relative to the factory. `../../app/models/<Model>.ts` unless given. */
  modelImport?: string | undefined;
  /** One `property: fake…` line per column the factory fills, from the model's columns. */
  columns?: readonly string[] | undefined;
}

/**
 * `name: fake.title()` and so on: a made-up value for each mass-assignable column of the model
 * that is a string, number, boolean or date. A column of another type (a union of literals, a
 * JSON shape) is left out, for the author to fill.
 *
 * @internal
 */
export function _factoryColumns(shape: _ModelShape): string[] {
  const lines: string[] = [];
  for (const property of shape.fillable) {
    const column = shape.columns.find((c) => c.property === property);
    if (!column || column === shape.owner) continue;
    const value = fakeFor(column.property, column.type);
    if (value) lines.push(`${column.property}: ${value},`);
  }
  return lines;
}

function fakeFor(property: string, type: string): string | undefined {
  const name = property.toLowerCase();
  if (type === "string") {
    if (name.includes("email")) return "fake.email()";
    if (name === "name" || name.endsWith("name"))
      return name === "name" ? "fake.title()" : "fake.name()";
    if (name === "title") return "fake.title()";
    if (name.includes("url")) return "fake.url()";
    if (name.includes("slug")) return "fake.slug()";
    if (/description|body|content|text|note|summary/.test(name)) return "fake.sentence()";
    return "fake.word()";
  }
  if (type === "number") return "fake.number(1, 100)";
  if (type === "boolean") return "fake.boolean()";
  if (type === "Date") return "fake.date()";
  return undefined;
}

/**
 * Returns the source text of a factory file for the given model name.
 */
export function factoryStub(model: string, options: FactoryStubOptions = {}): string {
  const modelVar = Str.lcfirst(model);
  const testing = options.testing ?? "zerotal/testing";
  const modelImport = options.modelImport ?? `../../app/models/${model}.ts`;
  const body = options.columns?.length
    ? options.columns.map((line) => `  ${line}`).join("\n")
    : `  // Define default attributes here. Use fake for generated values:
  // name: fake.title(),
  // email: fake.email(),`;
  return `import { Factory } from "${testing}";
import { ${model} } from "${modelImport}";

/**
 * A ${modelVar} with made-up values.
 *
 *   const ${modelVar} = await ${model}Factory.create();
 *   const ${modelVar}s = await ${model}Factory.count(5).create();
 *   const draft = ${model}Factory.make({ name: "Draft" });
 */
export const ${model}Factory = Factory.define(${model}, (${options.columns?.length ? "fake" : "_fake"}) => ({
${body}
}));
`;
}
