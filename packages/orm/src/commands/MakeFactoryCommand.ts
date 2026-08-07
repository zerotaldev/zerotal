import { Command, Str } from "@zerotal/core";

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
    const model = this.args["model"]!;
    const path = `database/factories/${model}Factory.ts`;

    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }

    await Bun.write(path, factoryStub(model));
    this.info(`Created: ${path}`);
    this.dim(
      `Import in tests: import { ${model}Factory } from '../database/factories/${model}Factory.ts';`,
    );
  }
}

/**
 * Returns the source text of a factory file for the given model name.
 */
export function factoryStub(model: string): string {
  const modelVar = Str.lcfirst(model);
  return `import { Factory } from '@zerotal/testing';
import { ${model} } from '../../app/models/${model}.ts';

export const ${model}Factory = Factory.define(${model}, (fake) => ({
  // Define default attributes here. Use fake for generated values:
  // name:  fake.string(10),
  // email: fake.email(),
}));

// Usage in tests:
//   const ${modelVar}  = await ${model}Factory.create();
//   const ${modelVar}s = await ${model}Factory.createMany(5);
//   const draft = ${model}Factory.make({ published: false });
//   const post  = await PostFactory.for(${modelVar}).create();
`;
}
