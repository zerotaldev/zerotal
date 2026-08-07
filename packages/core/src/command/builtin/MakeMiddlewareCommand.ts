/**
 * The `make:middleware` command and the middleware source stub it writes.
 */
import { Command } from "../Command.ts";

/** Source for a pass-through middleware class implementing `Pipe<HttpContext>`. */
export function middlewareStub(name: string): string {
  return `import type { HttpContext, Pipe, NextFn } from '@zerotal/core';

export class ${name} implements Pipe<HttpContext> {
  async handle(ctx: HttpContext, next: NextFn): Promise<Response | void> {
    // Continue down the pipeline:
    return next();
    // ...or short-circuit by returning a Response instead of calling next():
    // return Response.json({ message: 'Forbidden' }, { status: 403 });
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
export class MakeMiddlewareCommand extends Command {
  static commandName = "make:middleware";
  static description = "Create a new middleware class";
  static needsApp = false;

  static get args() {
    return [
      { name: "name", required: true, description: "Middleware class name (e.g. AuthMiddleware)" },
    ];
  }

  static get flags() {
    return [];
  }

  run(): Promise<void> {
    const name = this.args["name"]!;
    const path = middlewarePath(name);

    return Bun.file(path)
      .exists()
      .then((exists) => {
        if (exists) {
          this.error(`File already exists: ${path}`);
          return;
        }
        // Bun.write() creates any missing parent directories, so no mkdir is needed.
        return Bun.write(path, middlewareStub(name)).then(() => {
          this.info(`Created: ${path}`);
        });
      });
  }
}
