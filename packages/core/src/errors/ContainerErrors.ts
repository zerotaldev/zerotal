/**
 * Errors raised by the IoC container — unknown bindings, scope-lifetime misuse,
 * synchronous resolution of async bindings, circular dependencies, and facades
 * touched before the container is ready.
 */
import { ZerotalError } from "./ZerotalError.ts";

/** Raised when resolving a token that no provider has registered. */
export class BindingNotFoundError extends ZerotalError {
  constructor(token: string) {
    super(
      `No binding registered for token: "${token}". Register it in a ServiceProvider's onRegister() method.`,
      "E_BINDING_NOT_FOUND",
      500,
      { token },
    );
  }
}

/** Raised when a request-scoped binding is resolved with no request in scope. */
export class ScopedOutsideRequestError extends ZerotalError {
  constructor(message: string) {
    super(message, "E_SCOPED_OUTSIDE_REQUEST", 500);
  }
}

/** Raised when a request-scoped binding is resolved after the scope was flushed. */
export class ScopedAfterFlushError extends ZerotalError {
  constructor(message: string) {
    super(message, "E_SCOPED_AFTER_FLUSH", 500);
  }
}

/** Raised when an async-only binding is resolved through the synchronous API. */
export class SyncResolutionError extends ZerotalError {
  constructor(message: string) {
    super(message, "E_SYNC_RESOLUTION", 500);
  }
}

/**
 * Raised when application code tries to register a binding through the `App`
 * facade after `Application.boot()` has completed.
 *
 * The container is process-global and shared across every concurrent request,
 * so mutating it at request time would leak state between requests. Register
 * bindings at boot — in the bootstrap `App.bind()` callback, a `ServiceProvider`,
 * the `app/services` convention, or top-of-module code — and use a `scoped`
 * binding for anything that must be per-request.
 */
export class ContainerLockedError extends ZerotalError {
  constructor(method: string) {
    super(
      [
        `App.${method}() was called after the application finished booting.`,
        ``,
        `The container is locked once boot() completes: it is shared across every`,
        `concurrent request, so registering a binding now would leak state between`,
        `requests. Register bindings during boot instead:`,
        ``,
        `  • the bootstrap App.bind((c) => { ... }) callback`,
        `  • a ServiceProvider's onRegister()`,
        `  • the app/services convention (static lifetime = "singleton")`,
        ``,
        `Need per-request state? Register a scoped binding at boot — it resolves a`,
        `fresh instance for each request without mutating the global container.`,
      ].join("\n"),
      "E_CONTAINER_LOCKED",
      500,
      { method },
    );
  }
}

/**
 * Raised when bindings depend on each other in a cycle.
 *
 * @param chain - The resolution path that closed the loop, in order.
 */
export class CircularDependencyError extends ZerotalError {
  constructor(chain: string[]) {
    super(`Circular dependency detected: ${chain.join(" → ")}`, "E_CIRCULAR_DEPENDENCY", 500, {
      chain,
    });
  }
}

/**
 * Raised when a facade is used before `Application.boot()` has wired the
 * container — typically from module-level code that runs on import.
 */
export class FacadeAccessedBeforeBootError extends ZerotalError {
  constructor(facadeKey: string) {
    super(
      [
        `You attempted to use the "${facadeKey}" facade before the container was ready.`,
        ``,
        `Facades are resolved from the IoC container, which is only available after`,
        `Application.boot() completes. Using a facade at module scope (top-level code`,
        `that runs on import) is not safe because the app may not have booted yet.`,
        ``,
        `Common causes:`,
        `  • A top-level variable initialised with a Facade call:`,
        `      const name = Config.get('app.name')  // ← runs before boot`,
        `  • Module-level code outside of any function or class`,
        ``,
        `Fix: move Facade usage inside a function, controller method, or service`,
        `provider hook (onRegister / onBooting / onBooted) where the container is`,
        `guaranteed to be ready.`,
      ].join("\n"),
      "E_FACADE_BEFORE_BOOT",
      500,
      { facade: facadeKey },
    );
  }
}

/**
 * Thrown when a facade is used after the app has booted but nothing provides its
 * binding — almost always a missing ServiceProvider in `bootstrap/providers.ts`.
 */
export class FacadeBindingMissingError extends ZerotalError {
  constructor(facadeKey: string) {
    super(
      [
        `Could not resolve the "${facadeKey}" facade.`,
        ``,
        `The application has booted, but nothing provides the "${facadeKey}" binding —`,
        `usually because the ServiceProvider that registers it isn't in your providers`,
        `list (and occasionally because the binding hasn't been pre-resolved yet).`,
        ``,
        `Fix: register the provider in bootstrap/providers.ts. For example, the "log"`,
        `facade is provided by LogProvider:`,
        ``,
        `      import { LogProvider } from "@zerotal/core/logger";`,
        `      export default [/* …your providers… */, LogProvider];`,
      ].join("\n"),
      "E_FACADE_BINDING_MISSING",
      500,
      { facade: facadeKey },
    );
  }
}
