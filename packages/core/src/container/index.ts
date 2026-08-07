/**
 * The IoC container and its supporting types: the {@link Container} that
 * registers and resolves bindings (transient, singleton, scoped, value) with
 * auto-wiring and cycle detection, the per-request {@link ScopedResolver}, the
 * `@inject`/`deps` helpers for declaring constructor dependencies, and the
 * {@link ContextualBindingBuilder} for consumer-specific overrides.
 *
 * @example
 * ```ts
 * import { Container, inject } from "@zerotal/core";
 *
 * class Logger {}
 *
 * @inject(Logger)
 * class UserService {
 *   constructor(private log: Logger) {}
 * }
 *
 * const container = Container.createEmpty();
 * container.singleton(Logger, () => new Logger());
 *
 * // UserService is auto-wired from its @inject() dependencies.
 * const users = await container.make(UserService);
 * ```
 *
 * @packageDocumentation
 */
export { Container } from "./Container.ts";
export { ScopedResolver } from "./ScopedResolver.ts";
export { inject, injectRegistry } from "./inject.ts";
export { ContextualBindingBuilder } from "./ContextualBindingBuilder.ts";
export type { ContainerBindings, BindingToken, Binding, Factory, BindingKind } from "./types.ts";
