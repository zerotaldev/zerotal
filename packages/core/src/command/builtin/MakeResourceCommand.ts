/**
 * The `make:resource` command, which scaffolds an API resource transformer.
 */
import { Command } from "../Command.ts";
import { pluralize, singularize, snakeCase } from "../../support/str.ts";

/**
 * `bun zt make:resource <name>` — scaffolds a new API resource transformer
 * class under `app/resources/`.
 *
 * @category Scaffolding (make:*)
 */
export class MakeResourceCommand extends Command {
  static commandName = "make:resource";
  static description = "Create a new API resource transformer class";
  static needsApp = false;

  static args = [
    { name: "name", required: true, description: "Resource name (e.g. UserResource)" },
  ];

  async run(): Promise<void> {
    const name = this.args["name"]!;
    const path = `app/resources/${name}.ts`;

    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }

    await Bun.write(path, _stub(name));
    this.info(`Created: ${path}`);

    const model = name.replace(/Resource$/, "");
    if (!(await Bun.file(`app/models/${model}.ts`).exists())) {
      this.warn(
        `  It is typed against app/models/${model}.ts, which does not exist yet: ` +
          `run \`bun zt make:model ${model} --migration\`, or change the import.`,
      );
    }
  }
}

/** @internal Exported for tests. */
export function _stub(name: string): string {
  const model = name.replace(/Resource$/, "");
  // From the singular, so `Post` and `Posts` are both `/api/posts`, and `BlogPost` is
  // `/api/blog-posts`. The old conversion read a capture group as an index and produced `/api/-post`.
  const route = pluralize(singularize(snakeCase(model))).replace(/_/g, "-");
  return `import { Resource } from 'zerotal/http';
import type { ${model} } from '../models/${model}';

export class ${name} extends Resource<${model}> {
  toArray(): Record<string, unknown> {
    return {
      id:         this.resource.id,
      // Add fields here — omit sensitive ones like 'password'
      created_at: this.resource.createdAt,
    };
  }
}

// ── Usage in controllers ────────────────────────────────────────────────────

// Single model:
//   ctx.json(new ${name}(model).toJson());            // { data: { ... } }
//   ctx.response = new ${name}(model).toResponse(201);

// Paginated list (ResourceCollection adds { data, meta, links } automatically):
//   import { ResourceCollection } from 'zerotal/http';
//   const paginated = await ${model}.query().paginate(15, page);
//   ctx.json(ResourceCollection.of(${name}, paginated, '/api/${route}'));
`;
}
