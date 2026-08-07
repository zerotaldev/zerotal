/**
 * Source codemods — the `@zerotal/core/build` subpath.
 *
 * These are the transforms `make:provider` uses to register a provider in
 * `bootstrap/providers.ts`. They live behind a subpath rather than the kernel
 * barrel because a generator is build-time tooling: an application never calls
 * them at runtime, and the barrel is deliberately frozen to the lean kernel set.
 *
 * @packageDocumentation
 */
export { addImport, addToDefaultArrayExport, registerProvider } from "./codemod.ts";
export type { RegisterProviderOptions, RegisterResult } from "./codemod.ts";
