import { ZerotalError } from "@zerotal/core";

/** Base class for all @zerotal/arch errors. */
export class ArchError extends ZerotalError {
  constructor(message: string, code = "E_ARCH", status = 500, context?: Record<string, unknown>) {
    super(message, code, status, context);
  }
}

/**
 * `arch:install` was run somewhere that is not a project.
 *
 * Thrown rather than warned: writing agent instructions into whatever directory
 * happened to be current is not a recoverable mistake for whoever has to find
 * the stray files later.
 */
export class NoProjectRootError extends ArchError {
  constructor(dir: string) {
    super(
      `[Zerotal Arch] No package.json at or above ${dir}, so there is no project to install ` +
        `into. Run this from the root of a Zerotal app.`,
      "E_ARCH_NO_PROJECT_ROOT",
      500,
      { dir },
    );
  }
}
