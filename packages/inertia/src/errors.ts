import { ZerotalError } from "@zerotal/core";

/** Base class for all @zerotal/inertia errors. */
export class InertiaError extends ZerotalError {
  constructor(
    message: string,
    code = "E_INERTIA",
    status = 500,
    context?: Record<string, unknown>,
  ) {
    super(message, code, status, context);
  }
}

/**
 * Thrown when `inertia()` / `inertiaStream()` runs before the HTML template has been
 * loaded — almost always because `InertiaProvider` is not registered.
 */
export class InertiaTemplateNotLoadedError extends InertiaError {
  constructor() {
    super(
      "[Zerotal Inertia] HTML template not loaded. Did you register InertiaProvider in bootstrap/app.ts?",
      "E_INERTIA_TEMPLATE_NOT_LOADED",
    );
  }
}

/** Thrown when a component name is unsafe (path traversal) or has no resolvable default export. */
export class InvalidComponentError extends InertiaError {
  constructor(component: string, reason = "is not a valid component") {
    super(
      `[Zerotal Inertia] Invalid component name '${component}': ${reason}.`,
      "E_INERTIA_INVALID_COMPONENT",
      500,
      {
        component,
      },
    );
  }
}
