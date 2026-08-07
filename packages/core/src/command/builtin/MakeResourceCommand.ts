/**
 * The `make:resource` command, which scaffolds an API resource transformer.
 */
import { Command } from "../Command.ts";

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
  }
}

function _stub(name: string): string {
  const model = name.replace(/Resource$/, "");
  const snake = model.replace(/([A-Z])/g, (char, index) => (index ? "-" : "") + char.toLowerCase());
  return `import { Resource, ResourceCollection } from '@zerotal/core';
import type { PaginatedData } from '@zerotal/core';

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
//   const paginated = await ${model}.query().paginate(15, page);
//   ctx.json(ResourceCollection.of(${name}, paginated, '/api/${snake}'));
`;
}
