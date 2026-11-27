/**
 * The `make:middleware` command and the middleware source stub it writes.
 */
import { GeneratorCommand } from "../GeneratorCommand.ts";
import { _frameworkImport } from "../appSource.ts";

/** Source for a pass-through middleware class implementing `Pipe<HttpContext>`. */
export function middlewareStub(name: string, core = "zerotal"): string {
  return `import type { HttpContext, NextFn, Pipe } from "${core}";

export class ${name} implements Pipe<HttpContext> {
  async handle(ctx: HttpContext, next: NextFn): Promise<Response | void> {
    // Continue down the pipeline:
    return next();
    // ...or short-circuit by returning a Response instead of calling next():
    // return Response.json({ message: "Forbidden" }, { status: 403 });
  }
}
`;
}

function middlewarePath(name: string): string {
  return `app/middleware/${name}.ts`;
}

/**
 * `bun zt make:middleware <name>` — scaffolds a new middleware class
 * (implementing `Pipe<HttpContext>`) under `app/middleware/`.
 *
 * @category Scaffolding (make:*)
 */
export class MakeMiddlewareCommand extends GeneratorCommand {
  static override commandName = "make:middleware";
  static override description = "Create a new middleware class";

  static override args = [
    { name: "name", required: true, description: "Middleware class name (e.g. AuthMiddleware)" },
  ];

  protected override async generate(): Promise<void> {
    const name = this.args["name"]!;
    const path = middlewarePath(name);
    if (!(await this.writeFile(path, middlewareStub(name, _frameworkImport("@zerotal/core")))))
      return;
    // app/middleware/ is discovered at boot, each class as a named group under its own name.
    this.next(
      `Use it on routes by name: Router.group({ middleware: ["${name}"] }, () => { … });`,
      `Or on every request: set \`static global = true\` on the class.`,
    );
  }
}
