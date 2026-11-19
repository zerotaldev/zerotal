/**
 * Switch the process time zone for a test file, and put it back after.
 *
 * Put back by assigning the zone it had, never by deleting `TZ`: on Bun 1.3, once
 * `TZ` has been deleted, assigning it again changes nothing for `Date` — the zone
 * stays wherever it was — so one file deleting it left every later file in the run
 * unable to change zone. `bun test` runs in UTC with `TZ` unset, so the zone it had
 * is read from `Intl` rather than from `TZ`.
 */
import { beforeAll, afterAll } from "bun:test";

/** The zone this process resolves dates in right now. */
export function currentZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Run every test in the calling file under `zone`. */
export function useProcessZone(zone: string): void {
  let previous = "UTC";
  beforeAll(() => {
    previous = process.env.TZ ?? currentZone();
    process.env.TZ = zone;
  });
  afterAll(() => {
    process.env.TZ = previous;
  });
}
