/**
 * The `make:controller` command and the controller source stubs it writes.
 */
import { GeneratorCommand } from "../GeneratorCommand.ts";
import { _frameworkImport } from "../appSource.ts";
import { pluralize, singularize, snakeCase } from "../../support/str.ts";

/** Source for a minimal controller with a single `index` action. */
export function basicStub(name: string, core = "zerotal"): string {
  return `import type { HttpContext } from "${core}";

export class ${name} {
  async index(ctx: HttpContext): Promise<void> {
    ctx.response = Response.json({ message: "ok" });
  }
}
`;
}

/** Source for a resourceful controller with full CRUD action stubs. */
export function resourceStub(name: string, core = "zerotal"): string {
  return `import type { HttpContext } from "${core}";

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

/** `PostController` → `posts`, the path segment its routes are served under. */
function routeSegment(name: string): string {
  return pluralize(singularize(snakeCase(name.replace(/Controller$/, "") || name))).replace(
    /_/g,
    "-",
  );
}

/**
 * `bun zt make:controller <name>` — scaffolds a new controller class under
 * `app/controllers/` (pass `--resource` for a full CRUD controller).
 *
 * @category Scaffolding (make:*)
 */
export class MakeControllerCommand extends GeneratorCommand {
  static override commandName = "make:controller";
  static override description = "Create a new controller class";

  static override args = [
    { name: "name", required: true, description: "Controller class name (e.g. UserController)" },
  ];

  static override flags = [
    {
      name: "resource",
      type: "boolean" as const,
      description: "Include CRUD action stubs",
      default: false,
    },
  ];

  protected override async generate(): Promise<void> {
    const name = this.args["name"]!;
    const resource = this.flags["resource"] === true;
    const path = `app/controllers/${name}.ts`;
    const core = _frameworkImport("@zerotal/core");

    if (!(await this.writeFile(path, resource ? resourceStub(name, core) : basicStub(name, core))))
      return;

    const segment = routeSegment(name);
    this.next(
      resource
        ? `Route to it in routes/web.ts: Router.resource("${segment}", ${name});`
        : `Route to it in routes/web.ts: Router.get("/${segment}", ${name}, "index");`,
      `Then cover it with a test: bun zt make:test ${segment}`,
    );
  }
}
