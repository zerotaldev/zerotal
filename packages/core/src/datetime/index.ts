/**
 * Date/time primitives for Zerotal — a fluent, ergonomic date-time API built on
 * `Temporal`. Exposes the immutable {@link Carbon} date-time value object and
 * the {@link CarbonInterval} duration object. Isolated from the kernel barrel
 * (the `@zerotal/core/carbon` subpath) so consumers that don't need dates
 * avoid pulling in the Temporal polyfill.
 *
 * @example
 * ```ts
 * import { Carbon, CarbonInterval } from "@zerotal/core/carbon";
 *
 * const start = Carbon.now();
 * const later = start.add(CarbonInterval.days(3).andHours(6));
 * later.diffForHumans(start); // "in 3 days"
 * later.format("YYYY-MM-DD HH:mm");
 * ```
 *
 * @packageDocumentation
 */
export { Carbon } from "./Carbon.ts";
export { CarbonInterval } from "./CarbonInterval.ts";
export type { DurationLike } from "./CarbonInterval.ts";
export type { CarbonInput } from "./Carbon.ts";
