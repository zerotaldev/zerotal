/**
 * The clock every `Carbon` reads "now" from.
 *
 * Routing it through one place is what makes time testable: code that expires a
 * token in seven days, or only sends a reminder after 24 hours, otherwise has no
 * way to be tested except by waiting. Tests move this clock with
 * `Carbon.setTestNow()` / `Carbon.travel()`; nothing else touches it.
 *
 * @module
 */
import { Temporal } from "./temporal-shim.ts";

let _testInstant: Temporal.Instant | null = null;

/** The current zoned date-time in `tz` — the frozen instant when one is set. */
export function _nowIn(tz: string): Temporal.ZonedDateTime {
  return _testInstant ? _testInstant.toZonedDateTimeISO(tz) : Temporal.Now.zonedDateTimeISO(tz);
}

/** Freeze the clock at `instant`, or release it with `null`. @internal */
export function _setTestInstant(instant: Temporal.Instant | null): void {
  _testInstant = instant;
}

/** The frozen instant, or `null` when the clock is running normally. @internal */
export function _getTestInstant(): Temporal.Instant | null {
  return _testInstant;
}
