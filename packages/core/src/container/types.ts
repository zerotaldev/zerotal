/**
 * The IoC container's type vocabulary: binding tokens, factory functions, the
 * discriminated union of binding descriptors, and the typed binding registry
 * that other packages extend through declaration merging.
 */
import type { Container } from "./Container.ts";

// ── Binding token types ───────────────────────────────────────────────────

// `args: any[]` (the codebase's standard Constructor shape) lets classes with
// typed constructors be used as tokens — `unknown[]` fails constructor-parameter
// contravariance at the call site (e.g. `App.make(ServiceWithCtorDeps)`).
/* eslint-disable @typescript-eslint/no-explicit-any -- token types must accept any class shape */
/** A concrete class usable as a container token. */
export type ClassToken<T> = new (...args: any[]) => T;
/** An abstract class usable as a container token. */
export type AbstractToken<T> = abstract new (...args: any[]) => T;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Any value that can identify a binding: a class, an abstract class, or a registry key. */
export type BindingToken<T = unknown> = ClassToken<T> | AbstractToken<T> | keyof ContainerBindings;

/** Builds an instance for a binding; may resolve asynchronously. */
export type Factory<T> = (container: Container) => T | Promise<T>;

/** The four binding lifetimes the container supports. */
export type BindingKind = "transient" | "singleton" | "scoped" | "value";

/** A binding that runs its factory on every resolution. */
export interface TransientBinding<T> {
  kind: "transient";
  factory: Factory<T>;
}

/** A binding resolved once and cached for the process lifetime. */
export interface SingletonBinding<T> {
  kind: "singleton";
  factory: Factory<T>;
  instance: T | undefined;
  resolved: boolean;
}

/** A binding resolved once per request scope. */
export interface ScopedBinding<T> {
  kind: "scoped";
  factory: Factory<T>;
}

/** A binding backed by an already-constructed value. */
export interface ValueBinding<T> {
  kind: "value";
  instance: T;
}

/** The discriminated union of all binding descriptors, keyed by `kind`. */
export type Binding<T> =
  TransientBinding<T> | SingletonBinding<T> | ScopedBinding<T> | ValueBinding<T>;

/**
 * The typed registry of well-known container bindings.
 *
 * Third-party packages extend this via declaration merging:
 *   declare module '@zerotal/core' { interface ContainerBindings { 'db': SQL } }
 */
export interface ContainerBindings {
  config: import("../config/ConfigManager.ts").ConfigManager;
  events: import("../events/Emitter.ts").Emitter;
  commands: import("../command/CommandRunner.ts").CommandRunner;
  lock: import("../lock/LockManager.ts").LockManager;
  log: import("../logger/LogManager.ts").LogManager;
}
