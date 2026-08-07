/**
 * `Carbon` — an immutable date-time value object backed by
 * `Temporal.ZonedDateTime`. Every modifier returns a new instance; the original
 * is never mutated. Defaults to the system local timezone unless overridden, and
 * formats via `Intl.DateTimeFormat` with no external dependencies.
 */

import { Temporal } from "./temporal-shim.ts";
import { CarbonInterval } from "./CarbonInterval.ts";
import { _nowIn, _setTestInstant, _getTestInstant } from "./clock.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Any value `Carbon` knows how to parse or wrap into a date-time. */
export type CarbonInput =
  | string
  | number
  | Date
  | Carbon
  | Temporal.ZonedDateTime
  | Temporal.Instant
  | Temporal.PlainDateTime
  | Temporal.PlainDate;

/** How far {@link Carbon.travel} moves the test clock. Negative values go back. */
export interface TravelAmount {
  years?: number;
  months?: number;
  weeks?: number;
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
}

interface DiffForHumansOptions {
  /** Which direction to phrase. Default: auto-detected from sign. */
  syntax?: "ago" | "from";
  /** Maximum number of time-unit parts to include. Default: 1 */
  parts?: number;
  /** Omit the ago/from-now suffix. Default: false */
  absolute?: boolean;
  /** Joiner between parts. Default: ', ' */
  join?: string;
  /** Locale for Intl.RelativeTimeFormat. Default: 'en' */
  locale?: string;
  /** Extra Intl options. Default: { numeric: 'auto' } */
  intl?: Intl.RelativeTimeFormatOptions;
}

// ── Parse helpers ─────────────────────────────────────────────────────────────

function systemTz(): string {
  return Temporal.Now.timeZoneId();
}

function toZdt(input: CarbonInput, tz: string): Temporal.ZonedDateTime {
  if (input instanceof Carbon) return input._zdt;

  if (input instanceof Temporal.ZonedDateTime) return input;

  if (input instanceof Temporal.Instant) {
    return input.toZonedDateTimeISO(tz);
  }

  if (input instanceof Temporal.PlainDateTime) {
    return input.toZonedDateTime(tz);
  }

  if (input instanceof Temporal.PlainDate) {
    return input.toZonedDateTime({ timeZone: tz, plainTime: Temporal.PlainTime.from("00:00:00") });
  }

  if (input instanceof Date) {
    return Temporal.Instant.fromEpochMilliseconds(input.valueOf()).toZonedDateTimeISO(tz);
  }

  if (typeof input === "number") {
    return Temporal.Instant.fromEpochMilliseconds(input).toZonedDateTimeISO(tz);
  }

  // string — try Temporal parsers in order of specificity
  const text = input.trim();
  try {
    // Full ZonedDateTime with bracket timezone e.g. "2024-01-01T12:00:00+01:00[Europe/Paris]"
    return Temporal.ZonedDateTime.from(text);
  } catch {
    /* fall through */
  }
  try {
    // Instant (with Z or numeric offset) e.g. "2024-01-01T12:00:00Z"
    return Temporal.Instant.from(text).toZonedDateTimeISO(tz);
  } catch {
    /* fall through */
  }
  try {
    // PlainDateTime (no offset) e.g. "2024-01-01T12:00:00" or "2024-01-01 12:00:00"
    const normalised = text.replace(" ", "T");
    return Temporal.PlainDateTime.from(normalised).toZonedDateTime(tz);
  } catch {
    /* fall through */
  }
  try {
    // PlainDate e.g. "2024-01-01"
    return Temporal.PlainDate.from(text).toZonedDateTime({
      timeZone: tz,
      plainTime: Temporal.PlainTime.from("00:00:00"),
    });
  } catch {
    /* fall through */
  }

  // Last resort: native Date parse (handles locale strings, RFC 2822, etc.)
  const native = new Date(text);
  if (!isNaN(native.valueOf())) {
    return Temporal.Instant.fromEpochMilliseconds(native.valueOf()).toZonedDateTimeISO(tz);
  }

  throw new RangeError(`[Carbon] Cannot parse date: "${input}"`);
}

// ── Carbon ────────────────────────────────────────────────────────────────────

/**
 * An immutable date-time value backed by `Temporal.ZonedDateTime`. Every
 * modifier returns a new instance — the original is never mutated. Defaults to
 * the system local timezone unless overridden, and formats via
 * `Intl.DateTimeFormat`/token templates with no external dependencies.
 *
 * @example Construction and formatting
 * ```ts
 * import { Carbon } from "@zerotal/core/carbon";
 *
 * Carbon.now();                           // current instant, system tz
 * Carbon.create("2024-01-01T12:00:00Z");  // parse any supported input
 * Carbon.now().format("YYYY-MM-DD HH:mm"); // "2024-06-09 14:30"
 * ```
 *
 * @example Arithmetic, comparison and human diffs
 * ```ts
 * const start = Carbon.now();
 * const later = start.addDays(3).subtractHours(2);
 *
 * later.isAfter(start);              // true
 * later.diffInHours(start);          // 70
 * later.diffForHumans(start);        // "in 2 days"
 * later.inTimezone("Europe/Paris");  // same instant, different zone
 * ```
 */
export class Carbon {
  /** @internal — the backing Temporal.ZonedDateTime (treat as immutable) */
  readonly _zdt: Temporal.ZonedDateTime;

  /**
   * Construct a `Carbon` from any supported input.
   *
   * @param input - Value to parse or wrap; defaults to the current instant.
   * @param timezone - Timezone to interpret the value in; inferred from the
   *   input's own zone or the system zone when omitted.
   * @throws {RangeError} When a string input cannot be parsed.
   * @category Construction
   */
  constructor(input: CarbonInput = new Date(), timezone?: string) {
    const tz =
      timezone ??
      (input instanceof Temporal.ZonedDateTime
        ? input.timeZoneId
        : input instanceof Carbon
          ? input._zdt.timeZoneId
          : systemTz());
    this._zdt = toZdt(input, tz);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _wrap(zdt: Temporal.ZonedDateTime): Carbon {
    // Bypass the constructor's parsing by assigning the ZonedDateTime directly.
    const wrapped = Object.create(Carbon.prototype) as Carbon;
    (wrapped as unknown as { _zdt: Temporal.ZonedDateTime })._zdt = zdt;
    return wrapped;
  }

  // ── Static factories ──────────────────────────────────────────────────────

  /**
   * Current date-time in the system (or given) timezone.
   * @category Construction
   */
  static now(timezone?: string): Carbon {
    const zdt = _nowIn(timezone ?? systemTz());
    return new Carbon(zdt);
  }

  // ── Test clock ────────────────────────────────────────────────────────────

  /**
   * Freeze "now" at a fixed point, so behaviour that depends on the passage of
   * time can be tested instead of waited out. Pass `null` to release it.
   *
   * Everything built on {@link Carbon.now} moves with it — `isPast`, `isToday`,
   * `diffForHumans`, a model's timestamps. A raw `Date.now()` does not: this
   * moves Carbon's clock, not the process's.
   *
   * Always release it, in an `afterEach`. A frozen clock that outlives its test
   * makes the next one fail somewhere unrelated.
   *
   * @param value - The instant to freeze at, in any form Carbon parses.
   * @category Testing
   *
   * @example
   * Carbon.setTestNow('2025-01-01T00:00:00Z');
   * expect(token.isExpired()).toBe(false);
   * Carbon.setTestNow(null);
   */
  static setTestNow(value: CarbonInput | null): void {
    _setTestInstant(value === null ? null : Carbon.create(value)._zdt.toInstant());
  }

  /**
   * Freeze the clock — at `value` when given, otherwise at the current instant.
   * Returns the frozen `Carbon` so the test can assert against it.
   *
   * @category Testing
   *
   * @example
   * const start = Carbon.freeze();
   * await service.run();
   * expect(job.startedAt.equalTo(start)).toBe(true);
   */
  static freeze(value?: CarbonInput): Carbon {
    Carbon.setTestNow(value ?? Carbon.now());
    return Carbon.now();
  }

  /**
   * Jump the clock to an absolute point. Identical to {@link Carbon.setTestNow}
   * with a value, and reads better at a call site that is moving through time.
   *
   * @category Testing
   *
   * @example
   * Carbon.travelTo('2026-01-01');
   */
  static travelTo(value: CarbonInput): Carbon {
    Carbon.setTestNow(value);
    return Carbon.now();
  }

  /**
   * Move the clock relative to where it is now, freezing it if it was running.
   *
   * @param amount - Units to move by; negative values go backwards.
   * @category Testing
   *
   * @example
   * Carbon.freeze();
   * Carbon.travel({ days: 8 });
   * expect(invitation.isExpired()).toBe(true);
   */
  static travel(amount: TravelAmount): Carbon {
    const moved = Carbon.create(Carbon.now()._zdt.add(amount));
    Carbon.setTestNow(moved);
    return moved;
  }

  /** Let the clock run normally again. Call it in `afterEach`. @category Testing */
  static release(): void {
    _setTestInstant(null);
  }

  /** Whether the clock is currently frozen. @category Testing */
  static isFrozen(): boolean {
    return _getTestInstant() !== null;
  }

  /**
   * Freeze the clock for the duration of `fn`, then release it — whether `fn`
   * returns or throws. The scoped form, for when a test must not leak a frozen
   * clock into the next one.
   *
   * @category Testing
   *
   * @example
   * await Carbon.withTestNow('2025-06-01', async () => {
   *   await service.expireStaleCarts();
   * });
   */
  static async withTestNow<T>(value: CarbonInput, fn: () => T | Promise<T>): Promise<T> {
    const previous = _getTestInstant();
    Carbon.setTestNow(value);
    try {
      return await fn();
    } finally {
      _setTestInstant(previous);
    }
  }

  /**
   * Parse / wrap any supported input into a `Carbon`.
   *
   * Accepts ISO 8601 strings (zoned, instant, plain date-time, or plain date),
   * `"YYYY-MM-DD HH:mm:ss"` with a space separator, epoch numbers (ms), native
   * `Date`, another `Carbon`, or a `Temporal` value; falls back to native
   * `Date` parsing as a last resort.
   *
   * @param input - The value to parse or wrap. Defaults to now.
   * @param timezone - Timezone to interpret the value in; defaults to the input's
   *   own zone (for zoned inputs) or the system zone.
   * @returns A new `Carbon` instance.
   * @throws {RangeError} When a string input cannot be parsed by any strategy.
   * @category Construction
   */
  static create(input: CarbonInput = new Date(), timezone?: string): Carbon {
    return new Carbon(input, timezone);
  }

  /**
   * Today at midnight in the system timezone.
   * @category Construction
   */
  static today(timezone?: string): Carbon {
    return Carbon.now(timezone).startOfDay();
  }

  /**
   * Tomorrow at midnight in the system (or given) timezone.
   * @category Construction
   */
  static tomorrow(timezone?: string): Carbon {
    return Carbon.now(timezone).addDays(1).startOfDay();
  }

  /**
   * Yesterday at midnight in the system (or given) timezone.
   * @category Construction
   */
  static yesterday(timezone?: string): Carbon {
    return Carbon.now(timezone).subtractDays(1).startOfDay();
  }

  /**
   * First moment of the current month.
   * @category Construction
   */
  static startOfMonth(timezone?: string): Carbon {
    return Carbon.now(timezone).startOfMonth();
  }

  /**
   * Last moment of the current month.
   * @category Construction
   */
  static endOfMonth(timezone?: string): Carbon {
    return Carbon.now(timezone).endOfMonth();
  }

  /**
   * First moment of the current ISO week (Monday 00:00).
   * @category Construction
   */
  static startOfWeek(timezone?: string): Carbon {
    return Carbon.now(timezone).startOfWeek();
  }

  /**
   * Last moment of the current ISO week (Sunday 23:59:59.999).
   * @category Construction
   */
  static endOfWeek(timezone?: string): Carbon {
    return Carbon.now(timezone).endOfWeek();
  }

  /**
   * First moment of the current year.
   * @category Construction
   */
  static startOfYear(timezone?: string): Carbon {
    return Carbon.now(timezone).startOfYear();
  }

  /**
   * Last moment of the current year.
   * @category Construction
   */
  static endOfYear(timezone?: string): Carbon {
    return Carbon.now(timezone).endOfYear();
  }

  /**
   * Create a Carbon from a Unix timestamp (seconds).
   * @category Construction
   */
  static fromTimestamp(ts: number, timezone?: string): Carbon {
    return new Carbon(Temporal.Instant.fromEpochMilliseconds(ts * 1000), timezone);
  }

  /**
   * Create a Carbon from a Unix timestamp in milliseconds.
   * @category Construction
   */
  static fromMilliseconds(ms: number, timezone?: string): Carbon {
    return new Carbon(Temporal.Instant.fromEpochMilliseconds(ms), timezone);
  }

  // ── Timezone ──────────────────────────────────────────────────────────────

  /**
   * Return the timezone ID (e.g. 'America/New_York').
   * @category Timezone
   */
  get timezone(): string {
    return this._zdt.timeZoneId;
  }

  /**
   * Return a new Carbon representing the same instant in a different timezone.
   * @category Timezone
   */
  inTimezone(tz: string): Carbon {
    return this._wrap(this._zdt.withTimeZone(tz));
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  /** Full year (e.g. 2024). @category Getters */
  get year(): number {
    return this._zdt.year;
  }
  /** Month of year, 1–12. @category Getters */
  get month(): number {
    return this._zdt.month;
  } // 1–12
  /** Day of month, 1–31. @category Getters */
  get day(): number {
    return this._zdt.day;
  } // 1–31
  /** Hour of day, 0–23. @category Getters */
  get hour(): number {
    return this._zdt.hour;
  }
  /** Minute, 0–59. @category Getters */
  get minute(): number {
    return this._zdt.minute;
  }
  /** Second, 0–59. @category Getters */
  get second(): number {
    return this._zdt.second;
  }
  /** Millisecond, 0–999. @category Getters */
  get millisecond(): number {
    return this._zdt.millisecond;
  }
  /** Microsecond component, 0–999. @category Getters */
  get microsecond(): number {
    return this._zdt.microsecond;
  }
  /** Nanosecond component, 0–999. @category Getters */
  get nanosecond(): number {
    return this._zdt.nanosecond;
  }

  /**
   * Day of week: 1 = Monday … 7 = Sunday (ISO 8601).
   * Note: differs from JS `Date.getDay()` which uses 0 = Sunday.
   * @category Getters
   */
  get dayOfWeek(): number {
    return this._zdt.dayOfWeek;
  }

  /**
   * Day of year (1–366).
   * @category Getters
   */
  get dayOfYear(): number {
    return this._zdt.dayOfYear;
  }

  /**
   * Week of year (ISO 8601).
   * @category Getters
   */
  get weekOfYear(): number {
    return this._zdt.weekOfYear ?? 1;
  }

  /**
   * Full English month name (e.g. "January"), in **this instance's** timezone.
   *
   * `toDate()` yields a bare instant, and `Intl.DateTimeFormat` with no `timeZone` formats
   * it in the *system* zone — so a Tokyo Carbon whose `.month` is 1 reported "December" on
   * a machine running behind it. Every field getter on this class answers in the
   * instance's zone; these have to agree with them.
   *
   * @category Getters
   */
  get monthName(): string {
    return new Intl.DateTimeFormat("en", {
      month: "long",
      timeZone: this.timezone,
    }).format(this.toDate());
  }

  /** Full English weekday name (e.g. "Monday"), in this instance's timezone. @category Getters */
  get dayName(): string {
    return new Intl.DateTimeFormat("en", {
      weekday: "long",
      timeZone: this.timezone,
    }).format(this.toDate());
  }

  // ── Add ───────────────────────────────────────────────────────────────────

  /** Return a copy advanced by `amount` nanoseconds. @category Arithmetic */
  addNanoseconds(amount: number): Carbon {
    return this._wrap(this._zdt.add({ nanoseconds: amount }));
  }
  /** Return a copy advanced by `amount` microseconds. @category Arithmetic */
  addMicroseconds(amount: number): Carbon {
    return this._wrap(this._zdt.add({ microseconds: amount }));
  }
  /** Return a copy advanced by `amount` milliseconds. @category Arithmetic */
  addMilliseconds(amount: number): Carbon {
    return this._wrap(this._zdt.add({ milliseconds: amount }));
  }
  /** Return a copy advanced by `amount` seconds. @category Arithmetic */
  addSeconds(amount: number): Carbon {
    return this._wrap(this._zdt.add({ seconds: amount }));
  }
  /** Return a copy advanced by `amount` minutes. @category Arithmetic */
  addMinutes(amount: number): Carbon {
    return this._wrap(this._zdt.add({ minutes: amount }));
  }
  /** Return a copy advanced by `amount` hours. @category Arithmetic */
  addHours(amount: number): Carbon {
    return this._wrap(this._zdt.add({ hours: amount }));
  }
  /** Return a copy advanced by `amount` days. @category Arithmetic */
  addDays(amount: number): Carbon {
    return this._wrap(this._zdt.add({ days: amount }));
  }
  /** Return a copy advanced by `amount` weeks. @category Arithmetic */
  addWeeks(amount: number): Carbon {
    return this._wrap(this._zdt.add({ weeks: amount }));
  }
  /** Return a copy advanced by `amount` calendar months. @category Arithmetic */
  addMonths(amount: number): Carbon {
    return this._wrap(this._zdt.add({ months: amount }));
  }
  /** Return a copy advanced by `amount` calendar years. @category Arithmetic */
  addYears(amount: number): Carbon {
    return this._wrap(this._zdt.add({ years: amount }));
  }
  /** Return a copy advanced by `amount` decades (10 years). @category Arithmetic */
  addDecades(amount: number): Carbon {
    return this.addYears(amount * 10);
  }
  /** Return a copy advanced by `amount` centuries (100 years). @category Arithmetic */
  addCenturies(amount: number): Carbon {
    return this.addYears(amount * 100);
  }
  /** Return a copy advanced by `amount` millennia (1000 years). @category Arithmetic */
  addMillennia(amount: number): Carbon {
    return this.addYears(amount * 1000);
  }

  // ── Subtract ──────────────────────────────────────────────────────────────

  /** Return a copy moved back by `amount` nanoseconds. @category Arithmetic */
  subtractNanoseconds(amount: number): Carbon {
    return this.addNanoseconds(-amount);
  }
  /** Return a copy moved back by `amount` microseconds. @category Arithmetic */
  subtractMicroseconds(amount: number): Carbon {
    return this.addMicroseconds(-amount);
  }
  /** Return a copy moved back by `amount` milliseconds. @category Arithmetic */
  subtractMilliseconds(amount: number): Carbon {
    return this.addMilliseconds(-amount);
  }
  /** Return a copy moved back by `amount` seconds. @category Arithmetic */
  subtractSeconds(amount: number): Carbon {
    return this.addSeconds(-amount);
  }
  /** Return a copy moved back by `amount` minutes. @category Arithmetic */
  subtractMinutes(amount: number): Carbon {
    return this.addMinutes(-amount);
  }
  /** Return a copy moved back by `amount` hours. @category Arithmetic */
  subtractHours(amount: number): Carbon {
    return this.addHours(-amount);
  }
  /** Return a copy moved back by `amount` days. @category Arithmetic */
  subtractDays(amount: number): Carbon {
    return this.addDays(-amount);
  }
  /** Return a copy moved back by `amount` weeks. @category Arithmetic */
  subtractWeeks(amount: number): Carbon {
    return this.addWeeks(-amount);
  }
  /** Return a copy moved back by `amount` calendar months. @category Arithmetic */
  subtractMonths(amount: number): Carbon {
    return this.addMonths(-amount);
  }
  /** Return a copy moved back by `amount` calendar years. @category Arithmetic */
  subtractYears(amount: number): Carbon {
    return this.addYears(-amount);
  }
  /** Return a copy moved back by `amount` decades. @category Arithmetic */
  subtractDecades(amount: number): Carbon {
    return this.addDecades(-amount);
  }
  /** Return a copy moved back by `amount` centuries. @category Arithmetic */
  subtractCenturies(amount: number): Carbon {
    return this.addCenturies(-amount);
  }
  /** Return a copy moved back by `amount` millennia. @category Arithmetic */
  subtractMillennia(amount: number): Carbon {
    return this.addMillennia(-amount);
  }

  // sub* short aliases
  /** Short alias of {@link subtractNanoseconds}. @category Arithmetic */
  subNanoseconds(amount: number): Carbon {
    return this.addNanoseconds(-amount);
  }
  /** Short alias of {@link subtractMicroseconds}. @category Arithmetic */
  subMicroseconds(amount: number): Carbon {
    return this.addMicroseconds(-amount);
  }
  /** Short alias of {@link subtractMilliseconds}. @category Arithmetic */
  subMilliseconds(amount: number): Carbon {
    return this.addMilliseconds(-amount);
  }
  /** Short alias of {@link subtractSeconds}. @category Arithmetic */
  subSeconds(amount: number): Carbon {
    return this.addSeconds(-amount);
  }
  /** Short alias of {@link subtractMinutes}. @category Arithmetic */
  subMinutes(amount: number): Carbon {
    return this.addMinutes(-amount);
  }
  /** Short alias of {@link subtractHours}. @category Arithmetic */
  subHours(amount: number): Carbon {
    return this.addHours(-amount);
  }
  /** Short alias of {@link subtractDays}. @category Arithmetic */
  subDays(amount: number): Carbon {
    return this.addDays(-amount);
  }
  /** Short alias of {@link subtractWeeks}. @category Arithmetic */
  subWeeks(amount: number): Carbon {
    return this.addWeeks(-amount);
  }
  /** Short alias of {@link subtractMonths}. @category Arithmetic */
  subMonths(amount: number): Carbon {
    return this.addMonths(-amount);
  }
  /** Short alias of {@link subtractYears}. @category Arithmetic */
  subYears(amount: number): Carbon {
    return this.addYears(-amount);
  }
  /** Short alias of {@link subtractDecades}. @category Arithmetic */
  subDecades(amount: number): Carbon {
    return this.addDecades(-amount);
  }

  // ── Apply a CarbonInterval ────────────────────────────────────────────────

  /**
   * Add a {@link CarbonInterval} to this instance.
   *
   * @example
   * ```ts
   * Carbon.now().add(CarbonInterval.days(3).andHours(6));
   * ```
   * @category Arithmetic
   */
  add(interval: { _duration: Temporal.Duration }): Carbon {
    return this._wrap(this._zdt.add(interval._duration));
  }

  /**
   * Subtract a {@link CarbonInterval} from this instance.
   *
   * @example
   * ```ts
   * Carbon.now().subtract(CarbonInterval.weeks(1));
   * ```
   * @category Arithmetic
   */
  subtract(interval: { _duration: Temporal.Duration }): Carbon {
    return this._wrap(this._zdt.subtract(interval._duration));
  }

  // ── Boundary setters (immutable) ──────────────────────────────────────────

  /**
   * Copy set to the first moment of the day (00:00:00.000).
   *
   * `disambiguation: "earlier"` matters on a fall-back day in a zone that repeats midnight
   * (Santiago and Havana do). Temporal's default there is the *second* occurrence, so a
   * `startOfDay()`…`endOfDay()` range silently began an hour late and lost every row in
   * the first hour of the day.
   *
   * @category Boundaries
   */
  startOfDay(): Carbon {
    return this._wrap(
      this._zdt.with(
        {
          hour: 0,
          minute: 0,
          second: 0,
          millisecond: 0,
          microsecond: 0,
          nanosecond: 0,
        },
        { disambiguation: "earlier" },
      ),
    );
  }

  /** Copy set to the last moment of the day (23:59:59.999999999). @category Boundaries */
  endOfDay(): Carbon {
    return this._wrap(
      this._zdt.with({
        hour: 23,
        minute: 59,
        second: 59,
        millisecond: 999,
        microsecond: 999,
        nanosecond: 999,
      }),
    );
  }

  /** Copy set to the first moment of the hour. @category Boundaries */
  startOfHour(): Carbon {
    return this._wrap(
      this._zdt.with({ minute: 0, second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 }),
    );
  }

  /** Copy set to the last moment of the hour. @category Boundaries */
  endOfHour(): Carbon {
    return this._wrap(
      this._zdt.with({
        minute: 59,
        second: 59,
        millisecond: 999,
        microsecond: 999,
        nanosecond: 999,
      }),
    );
  }

  /** Copy set to the first moment of the minute. @category Boundaries */
  startOfMinute(): Carbon {
    return this._wrap(this._zdt.with({ second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 }));
  }

  /** Copy set to the last moment of the minute. @category Boundaries */
  endOfMinute(): Carbon {
    return this._wrap(
      this._zdt.with({ second: 59, millisecond: 999, microsecond: 999, nanosecond: 999 }),
    );
  }

  /** Copy set to the first moment of the first day of the month. @category Boundaries */
  startOfMonth(): Carbon {
    return this._wrap(
      this._zdt.with({
        day: 1,
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0,
        microsecond: 0,
        nanosecond: 0,
      }),
    );
  }

  /** Copy set to the last moment of the last day of the month. @category Boundaries */
  endOfMonth(): Carbon {
    return this._wrap(
      this._zdt.with({
        day: this._zdt.daysInMonth,
        hour: 23,
        minute: 59,
        second: 59,
        millisecond: 999,
        microsecond: 999,
        nanosecond: 999,
      }),
    );
  }

  /**
   * Start of ISO week (Monday 00:00:00).
   * @category Boundaries
   */
  startOfWeek(): Carbon {
    // dayOfWeek: 1=Mon … 7=Sun
    const back = this._zdt.dayOfWeek - 1; // days back to Monday
    return this.subtractDays(back).startOfDay();
  }

  /**
   * End of ISO week (Sunday 23:59:59.999999999).
   * @category Boundaries
   */
  endOfWeek(): Carbon {
    return this.startOfWeek().addDays(6).endOfDay();
  }

  /** Copy set to the first moment of January 1st. @category Boundaries */
  startOfYear(): Carbon {
    return this._wrap(
      this._zdt.with({
        month: 1,
        day: 1,
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0,
        microsecond: 0,
        nanosecond: 0,
      }),
    );
  }

  /** Copy set to the last moment of December 31st. @category Boundaries */
  endOfYear(): Carbon {
    return this._wrap(
      this._zdt.with({
        month: 12,
        day: 31,
        hour: 23,
        minute: 59,
        second: 59,
        millisecond: 999,
        microsecond: 999,
        nanosecond: 999,
      }),
    );
  }

  /** Copy set to the first moment of the decade (year ending in 0). @category Boundaries */
  startOfDecade(): Carbon {
    return this.withYear(Math.floor(this.year / 10) * 10).startOfYear();
  }

  /** Copy set to the last moment of the decade (year ending in 9). @category Boundaries */
  endOfDecade(): Carbon {
    return this.withYear(Math.floor(this.year / 10) * 10 + 9).endOfYear();
  }

  /** Copy set to the first moment of the century. @category Boundaries */
  startOfCentury(): Carbon {
    return this.withYear(Math.floor(this.year / 100) * 100).startOfYear();
  }

  /** Copy set to the last moment of the century. @category Boundaries */
  endOfCentury(): Carbon {
    return this.withYear(Math.floor(this.year / 100) * 100 + 99).endOfYear();
  }

  // ── Field setters (immutable — "with" prefix signals new instance) ─────────

  /** Copy with the year replaced. @category Setters */
  withYear(amount: number): Carbon {
    return this._wrap(this._zdt.with({ year: amount }));
  }
  /** Copy with the month (1–12) replaced. @category Setters */
  withMonth(amount: number): Carbon {
    return this._wrap(this._zdt.with({ month: amount }));
  }
  /** Copy with the day of month replaced. @category Setters */
  withDay(amount: number): Carbon {
    return this._wrap(this._zdt.with({ day: amount }));
  }
  /** Copy with the hour (0–23) replaced. @category Setters */
  withHour(amount: number): Carbon {
    return this._wrap(this._zdt.with({ hour: amount }));
  }
  /** Copy with the minute replaced. @category Setters */
  withMinute(amount: number): Carbon {
    return this._wrap(this._zdt.with({ minute: amount }));
  }
  /** Copy with the second replaced. @category Setters */
  withSecond(amount: number): Carbon {
    return this._wrap(this._zdt.with({ second: amount }));
  }
  /** Copy with the millisecond replaced. @category Setters */
  withMillisecond(amount: number): Carbon {
    return this._wrap(this._zdt.with({ millisecond: amount }));
  }
  /** Copy with the microsecond replaced. @category Setters */
  withMicrosecond(amount: number): Carbon {
    return this._wrap(this._zdt.with({ microsecond: amount }));
  }
  /** Copy with the nanosecond replaced. @category Setters */
  withNanosecond(amount: number): Carbon {
    return this._wrap(this._zdt.with({ nanosecond: amount }));
  }

  /** Copy with the time-of-day replaced (microsecond/nanosecond zeroed). @category Setters */
  withTime(hours: number, minutes: number, seconds = 0, ms = 0): Carbon {
    return this._wrap(
      this._zdt.with({
        hour: hours,
        minute: minutes,
        second: seconds,
        millisecond: ms,
        microsecond: 0,
        nanosecond: 0,
      }),
    );
  }

  // ── Predicates ────────────────────────────────────────────────────────────

  /** Whether this date falls on the current calendar day. @category Comparison */
  isToday(): boolean {
    const now = _nowIn(this._zdt.timeZoneId);
    return Temporal.PlainDate.compare(this._zdt.toPlainDate(), now.toPlainDate()) === 0;
  }

  /** Whether this date falls on tomorrow's calendar day. @category Comparison */
  isTomorrow(): boolean {
    const tom = _nowIn(this._zdt.timeZoneId).add({ days: 1 });
    return Temporal.PlainDate.compare(this._zdt.toPlainDate(), tom.toPlainDate()) === 0;
  }

  /** Whether this date falls on yesterday's calendar day. @category Comparison */
  isYesterday(): boolean {
    const yes = _nowIn(this._zdt.timeZoneId).subtract({ days: 1 });
    return Temporal.PlainDate.compare(this._zdt.toPlainDate(), yes.toPlainDate()) === 0;
  }

  /** Whether this instant is before now. @category Comparison */
  isPast(): boolean {
    return Temporal.ZonedDateTime.compare(this._zdt, _nowIn(this._zdt.timeZoneId)) < 0;
  }
  /** Whether this instant is after now. @category Comparison */
  isFuture(): boolean {
    return Temporal.ZonedDateTime.compare(this._zdt, _nowIn(this._zdt.timeZoneId)) > 0;
  }

  /**
   * Weekend: Saturday (6) or Sunday (7) in ISO dayOfWeek.
   * @category Comparison
   */
  isWeekend(): boolean {
    return this._zdt.dayOfWeek >= 6;
  }
  /** Whether this date is Monday–Friday. @category Comparison */
  isWeekday(): boolean {
    return !this.isWeekend();
  }

  /** Whether this date's year is a leap year. @category Comparison */
  isLeapYear(): boolean {
    return this._zdt.inLeapYear;
  }

  /** Whether both fall on the same calendar day. @category Comparison */
  isSameDay(other: Carbon): boolean {
    return Temporal.PlainDate.compare(this._zdt.toPlainDate(), other._zdt.toPlainDate()) === 0;
  }

  /** Whether both fall in the same calendar month and year. @category Comparison */
  isSameMonth(other: Carbon): boolean {
    return this.year === other.year && this.month === other.month;
  }

  /** Whether both fall in the same calendar year. @category Comparison */
  isSameYear(other: Carbon): boolean {
    return this.year === other.year;
  }

  /** Whether this instant is strictly before `other`. @category Comparison */
  isBefore(other: Carbon): boolean {
    return Temporal.ZonedDateTime.compare(this._zdt, other._zdt) < 0;
  }

  /** Whether this instant is strictly after `other`. @category Comparison */
  isAfter(other: Carbon): boolean {
    return Temporal.ZonedDateTime.compare(this._zdt, other._zdt) > 0;
  }

  /** Whether this instant equals `other`. @category Comparison */
  isEqual(other: Carbon): boolean {
    return Temporal.ZonedDateTime.compare(this._zdt, other._zdt) === 0;
  }

  /**
   * Whether this instant lies between `start` and `end`.
   *
   * @param inclusive - Include the endpoints when `true` (default).
   * @category Comparison
   */
  isBetween(start: Carbon, end: Carbon, inclusive = true): boolean {
    if (inclusive) return !this.isBefore(start) && !this.isAfter(end);
    return this.isAfter(start) && this.isBefore(end);
  }

  // ── Calendar queries ──────────────────────────────────────────────────────

  /** Number of days in this date's month (28–31). @category Getters */
  daysInMonth(): number {
    return this._zdt.daysInMonth;
  }
  /** Number of days in this date's year (365 or 366). @category Getters */
  daysInYear(): number {
    return this._zdt.daysInYear;
  }
  /** Number of ISO weeks in this date's year (52 or 53). @category Getters */
  weeksInYear(): number {
    // Temporal dropped `weeksInYear` from ZonedDateTime, so compute the ISO-8601
    // week count: a year has 53 weeks when it starts on a Thursday, or is a leap
    // year starting on a Wednesday; otherwise 52.
    const year = this._zdt.year;
    const startDayOfWeek = new Date(Date.UTC(year, 0, 1)).getUTCDay(); // 0=Sun … 6=Sat
    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return startDayOfWeek === 4 || (isLeapYear && startDayOfWeek === 3) ? 53 : 52;
  }

  // ── Diff ──────────────────────────────────────────────────────────────────

  /**
   * Raw millisecond difference: `this - other`. Positive when this is later.
   * @category Difference
   */
  diffInMilliseconds(other: Carbon): number {
    return Number(this._zdt.epochMilliseconds - other._zdt.epochMilliseconds);
  }

  /** Signed difference in seconds (fractional). @category Difference */
  diffInSeconds(other: Carbon): number {
    return this.diffInMilliseconds(other) / 1000;
  }
  /** Signed difference in minutes (fractional). @category Difference */
  diffInMinutes(other: Carbon): number {
    return this.diffInSeconds(other) / 60;
  }
  /** Signed difference in hours (fractional). @category Difference */
  diffInHours(other: Carbon): number {
    return this.diffInMinutes(other) / 60;
  }
  /** Signed difference in days (fractional). @category Difference */
  diffInDays(other: Carbon): number {
    return this.diffInHours(other) / 24;
  }
  /** Signed difference in weeks (fractional). @category Difference */
  diffInWeeks(other: Carbon): number {
    return this.diffInDays(other) / 7;
  }

  /** Signed whole-month difference by calendar year/month fields. @category Difference */
  diffInMonths(other: Carbon): number {
    return (this.year - other.year) * 12 + (this.month - other.month);
  }

  /**
   * Signed difference in whole years — the number a person would call an age.
   *
   * Derived from Temporal's calendar arithmetic rather than from subtracted year/month
   * fields, because the day matters: a Feb-29 birthday measured on 28 February 2024
   * subtracts to a whole number of months and reports the birthday as already passed. The
   * result truncates toward zero, so a birthday one day away is still the lower age.
   *
   * @param other - The date to measure from.
   * @returns Whole years from `other` to this instant; negative when `other` is later.
   * @category Difference
   */
  diffInYears(other: Carbon): number {
    const duration = other._zdt.until(this._zdt, { largestUnit: "year" });
    return duration.years;
  }

  /**
   * Return the difference as a CarbonInterval (backed by Temporal.Duration).
   *
   * Uses Temporal's `until()` with the given largest unit so the result is
   * calendar-aware (months and years are counted properly).
   *
   * @example
   * ```ts
   * const interval = birthday.diffAsCarbonInterval(Carbon.now(), "year");
   * console.log(interval.years); // → 28
   * ```
   * @category Difference
   */
  diffAsCarbonInterval(other: Carbon, largestUnit: Temporal.DateTimeUnit = "day"): CarbonInterval {
    const duration = this._zdt.until(other._zdt, { largestUnit });
    return CarbonInterval.fromDuration(duration);
  }

  // ── diffForHumans ─────────────────────────────────────────────────────────

  /**
   * Human-readable relative phrasing via `Intl.RelativeTimeFormat`.
   *
   * With no argument, compares against now; pass another date to compare
   * against it. The largest matching unit is used by default; raise
   * `options.parts` for finer granularity.
   *
   * @param other - A date/`Carbon`/string to compare against, or the options object.
   * @param options - Formatting options (syntax, parts, absolute, join, locale, intl).
   * @returns A phrase such as `"3 days ago"`, `"in 2 hours"`, or `"just now"`.
   *
   * @example
   * ```ts
   * Carbon.now().subtractDays(3).diffForHumans();          // "3 days ago"
   * Carbon.now().addHours(2).diffForHumans();              // "in 2 hours"
   * a.diffForHumans(b, { parts: 2, absolute: true });      // "1 day, 4 hours"
   * ```
   * @category Difference
   */
  diffForHumans(): string;
  diffForHumans(options: DiffForHumansOptions): string;
  diffForHumans(other: Carbon | Date | string, options?: DiffForHumansOptions): string;
  diffForHumans(
    otherOrOptions?: Carbon | Date | string | DiffForHumansOptions,
    maybeOptions?: DiffForHumansOptions,
  ): string {
    let other: Carbon | null = null;
    let opts: DiffForHumansOptions = {};

    if (
      otherOrOptions instanceof Carbon ||
      otherOrOptions instanceof Date ||
      typeof otherOrOptions === "string"
    ) {
      other = new Carbon(otherOrOptions as CarbonInput);
      opts = maybeOptions ?? {};
    } else if (otherOrOptions !== undefined) {
      opts = otherOrOptions;
    }

    const {
      parts = 1,
      absolute = false,
      join = ", ",
      locale = "en",
      intl = { numeric: "auto" },
    } = opts;

    const compareTo = other ?? Carbon.now(this._zdt.timeZoneId);
    const diffMs = Number(this._zdt.epochMilliseconds - compareTo._zdt.epochMilliseconds);
    const isNeg = diffMs < 0;
    const absDiff = Math.abs(diffMs);

    const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
      ["year", 31_536_000_000],
      ["month", 2_592_000_000],
      ["week", 604_800_000],
      ["day", 86_400_000],
      ["hour", 3_600_000],
      ["minute", 60_000],
      ["second", 1_000],
    ];

    const segments: { unit: Intl.RelativeTimeFormatUnit; value: number }[] = [];
    let remaining = absDiff;

    for (const [unit, ms] of UNITS) {
      if (remaining >= ms) {
        const value = Math.floor(remaining / ms);
        remaining %= ms;
        segments.push({ unit, value });
        if (segments.length >= parts) break;
      }
    }

    if (segments.length === 0) return "just now";

    const fmt = new Intl.RelativeTimeFormat(locale, intl);
    const sign = opts.syntax ?? (isNeg ? "ago" : "from");
    const relSign = sign === "ago" ? -1 : 1;

    const formatted = segments.map(({ unit, value }) =>
      absolute ? `${value} ${unit}${value !== 1 ? "s" : ""}` : fmt.format(relSign * value, unit),
    );

    return formatted.join(join);
  }

  // ── Formatting ────────────────────────────────────────────────────────────

  /**
   * Token-based formatting:
   *
   * | Token | Meaning                    | Example  |
   * |-------|----------------------------|----------|
   * | YYYY  | 4-digit year               | 2024     |
   * | YY    | 2-digit year               | 24       |
   * | MMMM  | Full month name            | January  |
   * | MMM   | Short month name           | Jan      |
   * | MM    | 2-digit month              | 01       |
   * | M     | Month                      | 1        |
   * | DDDD  | Full weekday               | Monday   |
   * | DDD   | Short weekday              | Mon      |
   * | DD    | 2-digit day                | 05       |
   * | D     | Day                        | 5        |
   * | HH    | 24h hour (padded)          | 09       |
   * | H     | 24h hour                   | 9        |
   * | mm    | Minutes (padded)           | 04       |
   * | m     | Minutes                    | 4        |
   * | ss    | Seconds (padded)           | 07       |
   * | s     | Seconds                    | 7        |
   * | SSS   | Milliseconds (3 digits)    | 042      |
   * | Z     | UTC offset (+05:30 / Z)    | +05:30   |
   *
   * @param template - Token string; defaults to `"YYYY-MM-DD HH:mm:ss"`.
   * @example
   * ```ts
   * Carbon.now().format("MMM DD, YYYY"); // "Jun 09, 2026"
   * Carbon.now().format("HH:mm");        // "14:30"
   * ```
   * @category Formatting
   */
  format(template = "YYYY-MM-DD HH:mm:ss"): string {
    return this._format(template);
  }

  /**
   * Format using native Intl.DateTimeFormat (locale-aware).
   *
   * @example
   * ```ts
   * Carbon.now().intlFormat("en-US", { dateStyle: "long" });
   * // → "June 9, 2026"
   * ```
   * @category Formatting
   */
  intlFormat(locale = "en-US", options: Intl.DateTimeFormatOptions = {}): string {
    // Defaults to this instance's zone, so the output agrees with every field getter.
    // Without it the formatter used the system zone and could name a different day
    // entirely. An explicit `timeZone` in `options` still wins.
    return new Intl.DateTimeFormat(locale, { timeZone: this.timezone, ...options }).format(
      this.toDate(),
    );
  }

  // ── Serialisation ─────────────────────────────────────────────────────────

  /** Return a native JS Date. @category Conversion */
  toDate(): Date {
    return new Date(Number(this._zdt.epochMilliseconds));
  }

  /** ISO 8601 string with UTC offset, e.g. "2024-01-01T12:00:00+00:00". @category Conversion */
  toISOString(): string {
    return this._zdt.toInstant().toString();
  }

  /** Return the backing Temporal.ZonedDateTime. @category Conversion */
  toZonedDateTime(): Temporal.ZonedDateTime {
    return this._zdt;
  }

  /** Return a Temporal.Instant for this point in time. @category Conversion */
  toInstant(): Temporal.Instant {
    return this._zdt.toInstant();
  }

  /** Return a Temporal.PlainDateTime (loses timezone info). @category Conversion */
  toPlainDateTime(): Temporal.PlainDateTime {
    return this._zdt.toPlainDateTime();
  }

  /** Return a Temporal.PlainDate (loses time and timezone info). @category Conversion */
  toPlainDate(): Temporal.PlainDate {
    return this._zdt.toPlainDate();
  }

  /** Unix timestamp in seconds. @category Conversion */
  toUnix(): number {
    return Math.floor(Number(this._zdt.epochMilliseconds) / 1000);
  }

  /** Unix timestamp in milliseconds. @category Conversion */
  toMilliseconds(): number {
    return Number(this._zdt.epochMilliseconds);
  }

  /** Epoch milliseconds — enables numeric coercion and `<`/`>` comparison. @category Conversion */
  valueOf(): number {
    return Number(this._zdt.epochMilliseconds);
  }

  /** `"YYYY-MM-DD"` date string. @category Conversion */
  toDateString(): string {
    return this.format("YYYY-MM-DD");
  }
  /** `"YYYY-MM-DD HH:mm:ss"` date-time string. @category Conversion */
  toDateTimeString(): string {
    return this.format("YYYY-MM-DD HH:mm:ss");
  }
  /** `"HH:mm:ss"` time string. @category Conversion */
  toTimeString(): string {
    return this.format("HH:mm:ss");
  }
  /** Short date string, e.g. `"Jun 09, 2026"`. @category Conversion */
  toShortDate(): string {
    return this.format("MMM DD, YYYY");
  }
  /** Long date string, e.g. `"09 June 2026"`. @category Conversion */
  toLongDate(): string {
    return this.format("DD MMMM YYYY");
  }

  /** ISO string returned when JSON.stringify is called. @category Conversion */
  toJSON(): string {
    return this._zdt.toInstant().toString();
  }

  /** `"YYYY-MM-DD HH:mm:ss"` string used for string coercion. @category Conversion */
  toString(): string {
    return this.format("YYYY-MM-DD HH:mm:ss");
  }

  /** ISO 8601 string — compatible with most database datetime columns. @category Conversion */
  toDatabase(): string {
    return this._zdt.toInstant().toString();
  }

  // ── Private formatting impl ───────────────────────────────────────────────

  private _format(template: string): string {
    const zdt = this._zdt;
    const pad = (value: number, length = 2) => value.toString().padStart(length, "0");

    const MONTHS = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    // Temporal dayOfWeek: 1=Mon … 7=Sun → map to DAYS index
    const dayIndex = zdt.dayOfWeek % 7; // Mon(1)→1 … Sat(6)→6, Sun(7)→0

    // UTC offset string e.g. "+05:30" or "Z"
    const offsetNs = zdt.offsetNanoseconds;
    const offsetMin = offsetNs / 60_000_000_000;
    const offsetStr =
      offsetNs === 0
        ? "Z"
        : `${offsetMin > 0 ? "+" : "-"}${pad(Math.floor(Math.abs(offsetMin) / 60))}:${pad(Math.abs(offsetMin) % 60)}`;

    const tokens: Record<string, string> = {
      YYYY: zdt.year.toString(),
      YY: zdt.year.toString().slice(-2),
      MMMM: MONTHS[zdt.month - 1]!,
      MMM: MONTHS[zdt.month - 1]!.slice(0, 3),
      MM: pad(zdt.month),
      M: zdt.month.toString(),
      DDDD: DAYS[dayIndex]!,
      DDD: DAYS[dayIndex]!.slice(0, 3),
      DD: pad(zdt.day),
      D: zdt.day.toString(),
      HH: pad(zdt.hour),
      H: zdt.hour.toString(),
      mm: pad(zdt.minute),
      m: zdt.minute.toString(),
      ss: pad(zdt.second),
      s: zdt.second.toString(),
      SSS: pad(zdt.millisecond, 3),
      SS: pad(zdt.millisecond, 3).slice(0, 2),
      S: zdt.millisecond.toString().charAt(0) || "0",
      Z: offsetStr,
    };

    const pattern = new RegExp(
      Object.keys(tokens)
        .sort((a, b) => b.length - a.length)
        .join("|"),
      "g",
    );
    return template.replace(pattern, (match) => tokens[match] ?? match);
  }
}
