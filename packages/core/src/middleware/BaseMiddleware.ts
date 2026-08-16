/**
 * The base class every Zerotal middleware extends, providing the `Pipe`
 * contract plus the static `with()` helper that bakes options into a
 * zero-argument middleware class usable directly in `app.use([...])`.
 */
import type { Pipe, NextFn } from "../pipeline/types.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";
// Canonical implementation now lives in support/deepMerge.ts; re-exported here so existing
// `import { deepMerge } from "./BaseMiddleware.ts"` call sites keep working.
import { deepMerge } from "../support/deepMerge.ts";
import type { DeepPartial } from "../support/deepMerge.ts";

export { deepMerge };

/**
 * Base class for all Zerotal middlewares.
 *
 * Subclasses must declare `protected options` with their default values.
 * Use `MyMiddleware.with({ ... })` to produce a zero-arg constructor with
 * options deep-merged on top of the subclass defaults.
 *
 * @example
 * class MyMiddleware extends BaseMiddleware<MyOptions> {
 *   protected options: MyOptions = { timeout: 5000 };
 *
 *   async handle(ctx: HttpContext, next: NextFn): Promise<Response | void> {
 *     // ...read/write ctx.* ...
 *     return next();
 *   }
 * }
 *
 * app.use([MyMiddleware.with({ timeout: 1000 })]);
 */
export abstract class BaseMiddleware<O extends object = object> implements Pipe<HttpContext> {
  // Explicit constructor so JSC's function-coverage counter attributes
  // the super() call from concrete subclasses to this entry.
  constructor() {}

  /**
   * Subclasses must declare this with their default option values.
   * TypeScript enforces this at compile time — forgetting it is a type error.
   */
  protected abstract options: O;

  /**
   * Returns a zero-arg subclass with the given options deep-merged on top of
   * the subclass defaults, usable directly in app.use([...]).
   *
   * `NoInfer` on the parameter is what makes this type-check at all. `Opts` has
   * a default computed from the middleware class, but a type parameter that
   * appears in an argument position is inferred from the *argument* first and
   * only falls back to its default when inference finds nothing — so
   * `Middleware.with({ resolve: (claims) => … })` used to infer `Opts` from the
   * object literal it was handed, which meant the literal type-checked against
   * itself. Every callback parameter arrived implicitly `any`, and a misspelled
   * option was accepted in silence. Blocking inference makes the middleware's
   * own option type the one that governs.
   */
  static with<
    // 1. Constrain T to be a concrete class (not abstract) that extends BaseMiddleware
    T extends new (...args: any[]) => BaseMiddleware<any>,
    // 2. Dynamically infer the specific options type (U) from that concrete class
    Opts = T extends new (...args: any[]) => BaseMiddleware<infer U> ? U : object,
  >(this: T, options: DeepPartial<NoInfer<Opts>>): new () => InstanceType<T> {
    const configured = class extends (this as any) {
      constructor() {
        super();
        (this as any).options = deepMerge((this as any).options ?? {}, options);
      }
    };
    // A class expression is anonymous, so a configured middleware used to appear
    // as `""` everywhere a name is read — the pipeline listing, `route:list`,
    // error messages. Carrying the base name across keeps a middleware
    // identifiable after it has been configured.
    Object.defineProperty(configured, "name", { value: this.name, configurable: true });
    return configured as any;
  }

  abstract handle(ctx: HttpContext, next: NextFn): Promise<Response | void>;

  afterResponse?(ctx: HttpContext): Promise<void>;
  onError?(ctx: HttpContext, error: Error): Promise<void>;
}
