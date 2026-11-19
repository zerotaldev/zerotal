/**
 * The one place Carbon gets `Temporal` from.
 *
 * A runtime that ships `Temporal` itself (Bun 1.4 and later) is used as it is,
 * and `@js-temporal/polyfill` is never loaded there. On Bun 1.3, which has no
 * global `Temporal`, the polyfill is loaded the first time Carbon needs a
 * Temporal value, not when Carbon is imported.
 *
 * The types stay the polyfill's: they describe the same API as the native
 * implementation, and they are what Carbon's public signatures are written in.
 * The import below is type-only, so it costs nothing at runtime.
 *
 * @module
 */
import type { Temporal } from "@js-temporal/polyfill";

export type { Temporal };

/** The `Temporal` namespace object, whichever implementation provides it. */
export type TemporalNamespace = typeof Temporal;

let resolved: TemporalNamespace | undefined;

/**
 * The `Temporal` Carbon runs on: the runtime's own when there is one, the
 * polyfill otherwise. Resolved on the first call and kept.
 *
 * Synchronous, because Carbon's API is. The polyfill is reached with a literal
 * `require()` of `./temporal-polyfill.ts`, which Bun allows in an ES module and
 * which `bun build --compile` sees and embeds. That module imports the
 * polyfill's ES build, so an app that imports the polyfill itself shares
 * Carbon's copy.
 */
export function temporal(): TemporalNamespace {
  if (resolved !== undefined) return resolved;
  const native = (globalThis as { Temporal?: TemporalNamespace }).Temporal;
  if (native !== undefined) {
    resolved = native;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const polyfill = require("./temporal-polyfill.ts") as { Temporal: TemporalNamespace };
    resolved = polyfill.Temporal;
  }
  return resolved;
}

/** The Temporal types Carbon and CarbonInterval accept. */
const ADOPTABLE = ["Instant", "ZonedDateTime", "PlainDateTime", "PlainDate", "Duration"] as const;

type Adoptable = (typeof ADOPTABLE)[number];

/**
 * The Temporal type a value is branded as (`"Instant"`, `"PlainTime"`, …), or
 * `null` for anything that is not a Temporal value.
 *
 * Reads the `Symbol.toStringTag` brand, which the polyfill and a native
 * `Temporal` (Bun 1.4 and later) both set, so it recognises either.
 */
export function temporalBrand(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  const tag = Object.prototype.toString.call(value);
  return tag.startsWith("[object Temporal.") ? tag.slice("[object Temporal.".length, -1) : null;
}

/**
 * Turn a Temporal value from another implementation into one of the
 * {@link temporal} Carbon runs on. The two do not recognise each other's
 * objects in `instanceof` checks or methods: on Bun 1.4 an app may still hand
 * Carbon a value from its own copy of the polyfill, and on Bun 1.3 a value can
 * come from a second copy of it.
 *
 * The value goes across as its ISO string, which keeps every field down to the
 * nanosecond, the time zone and the calendar. A value that is already Carbon's
 * own, and anything that is not one of the five supported Temporal types, come
 * back unchanged.
 */
export function adoptTemporal<T>(value: T): T {
  const brand = temporalBrand(value);
  if (brand === null || !(ADOPTABLE as readonly string[]).includes(brand)) return value;
  const kind = brand as Adoptable;
  const own = temporal()[kind];
  if (value instanceof own) return value;
  return own.from(String(value)) as T;
}
