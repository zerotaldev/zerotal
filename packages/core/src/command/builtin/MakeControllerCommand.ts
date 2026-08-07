/**
 * The `make:controller` command and the controller source stubs it writes.
 */
import { Command } from "../Command.ts";

/** Source for a minimal controller with a single `index` action. */
export function basicStub(name: string): string {
  return `import type { HttpContext } from '@zerotal/core';

export class ${name} {
  async index(ctx: HttpContext): Promise<void> {
    ctx.response = Response.json({ message: 'ok' });
  }
}
`;
}

/** Source for a resourceful controller with full CRUD action stubs. */
export function resourceStub(name: string): string {
  return `import type { HttpContext } from '@zerotal/core';

export class ${name} {
  async index(ctx: HttpContext): Promise<void> {
    ctx.response = Response.json([]);
  }

  async show(ctx: HttpContext): Promise<void> {
    const { id } = ctx.params;
    ctx.response = Response.json({ id });
  }

  async store(ctx: HttpContext): Promise<void> {
    const body = await ctx.request.json();
    ctx.response = Response.json(body, { status: 201 });
  }

  async update(ctx: HttpContext): Promise<void> {
    const body = await ctx.request.json();
    ctx.response = Response.json(body);
  }

  async destroy(ctx: HttpContext): Promise<void> {
    ctx.response = new Response(null, { status: 204 });
  }
}
`;
}

/**
 * `bun zt make:controller <name>` — scaffolds a new controller class under
 * `app/controllers/` (pass `--resource` for a full CRUD controller).
 *
 * @category Scaffolding (make:*)
 */
export class MakeControllerCommand extends Command {
  static commandName = "make:controller";
  static description = "Create a new controller class";
  static needsApp = false;

  static get args() {
    return [
      { name: "name", required: true, description: "Controller class name (e.g. UserController)" },
    ];
  }

  static get flags() {
    return [
      {
        name: "resource",
        type: "boolean" as const,
        description: "Include CRUD action stubs",
        default: false,
      },
    ];
  }

  run(): Promise<void> {
    const name = this.args["name"]!;
    const resource = this.flags["resource"] as boolean;
    const path = `app/controllers/${name}.ts`;

    return Bun.file(path)
      .exists()
      .then((exists) => {
        if (exists) {
          this.error(`File already exists: ${path}`);
          return;
        }
        // Bun.write() creates any missing parent directories, so no mkdir is needed.
        return Bun.write(path, resource ? resourceStub(name) : basicStub(name)).then(() => {
          this.info(`Created: ${path}`);
        });
      });
  }
}
