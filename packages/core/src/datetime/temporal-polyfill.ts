/**
 * `@js-temporal/polyfill`, for a runtime with no `Temporal` of its own (Bun 1.3).
 *
 * Only {@link temporal} reaches this module, and only when it needs the polyfill.
 * It is an ES module so that its `import` loads the polyfill's ES build, the
 * same file an app's own `import { Temporal } from "@js-temporal/polyfill"`
 * loads. A `require()` of the package would load its CommonJS build instead: a
 * second copy, whose values are not `instanceof` the app's classes.
 *
 * @module
 */
export { Temporal } from "@js-temporal/polyfill";
