/**
 * TC39 standard ES decorators for dependency injection.
 * No reflect-metadata. No external packages.
 *
 * Pass the dependency tokens straight to the decorator — they are auto-wired
 * into the constructor in order:
 *
 *   @inject(Db, Cache)
 *   class UserService {
 *     constructor(private db: SQL, private cache: CacheManager) {}
 *   }
 *
 * Tokens may be classes, abstract classes, or registry keys. Because standard
 * decorators expose no runtime parameter types, the tokens must be listed
 * explicitly (there is no reflect-metadata inference).
 */

import type { BindingToken } from "./types.ts";

/**
 * Module-level registry: constructor → ordered dependency tokens.
 *
 * @internal Populated by {@link inject} and read by the container during
 * auto-wiring; not part of the public API.
 */
export const injectRegistry = new Map<Function, BindingToken[]>();

/**
 * Mark a class for auto-wiring by the container, declaring its constructor
 * dependencies in order. `@inject()` with no tokens marks a class with a
 * no-argument constructor for auto-wiring.
 *
 * @example
 * ```ts
 * @inject(Db, Cache)
 * class UserService {
 *   constructor(private db: SQL, private cache: CacheManager) {}
 * }
 *
 * // The container builds the dependencies and injects them in order:
 * const users = await container.make(UserService);
 * ```
 */
export function inject(...tokens: BindingToken[]) {
  // `args: any[]` (the codebase's standard Constructor shape) keeps the target
  // assignable from classes with typed constructors — `unknown[]` would fail the
  // constructor-parameter contravariance check at the decoration site.
  return function (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any — decorator target must accept any class shape
    target: new (...args: any[]) => unknown,
    _context: ClassDecoratorContext,
  ): void {
    injectRegistry.set(target, tokens);
  };
}
