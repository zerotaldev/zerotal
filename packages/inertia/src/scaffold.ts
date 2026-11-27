/**
 * The generators `@zerotal/inertia` lends to the CLI, published as `@zerotal/inertia/scaffold`.
 *
 * `bun zt make:resource <Name> --model <Model>` is a core command, and it runs without booting
 * the app, so it cannot reach a command this package registers at boot. It looks for this module
 * in the app instead, as `zt compile` looks for Flow's, and hands the work to it.
 *
 * @packageDocumentation
 */
export { _makeResource } from "./scaffold/resource.ts";
export type { _MakeResourceOptions, _ScaffoldOutput } from "./scaffold/resource.ts";
