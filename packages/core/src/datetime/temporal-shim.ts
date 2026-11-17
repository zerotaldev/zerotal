import { Temporal } from "@js-temporal/polyfill";

export { Temporal };

/**
 * The Temporal types Carbon and CarbonInterval accept, each with the polyfill's
 * parser for its ISO string.
 */
const ADOPTERS = {
  Instant: (text: string) => Temporal.Instant.from(text),
  ZonedDateTime: (text: string) => Temporal.ZonedDateTime.from(text),
  PlainDateTime: (text: string) => Temporal.PlainDateTime.from(text),
  PlainDate: (text: string) => Temporal.PlainDate.from(text),
  Duration: (text: string) => Temporal.Duration.from(text),
} as const;

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
 * Turn a Temporal value from another implementation into the polyfill's own
 * object. Carbon is built on the polyfill, whose `instanceof` checks and
 * methods do not recognise a native `Temporal` value, such as
 * `globalThis.Temporal.Now.instant()` or a date `Bun.TOML.parse` returns.
 *
 * The value goes across as its ISO string, which keeps every field down to the
 * nanosecond, the time zone and the calendar. A polyfill value and anything
 * that is not one of the five supported Temporal types come back unchanged.
 */
export function adoptTemporal<T>(value: T): T {
  const brand = temporalBrand(value);
  if (brand === null || !Object.hasOwn(ADOPTERS, brand)) return value;
  const kind = brand as keyof typeof ADOPTERS;
  if (value instanceof Temporal[kind]) return value;
  return ADOPTERS[kind](String(value)) as T;
}
