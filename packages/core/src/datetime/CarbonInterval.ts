/**
 * `CarbonInterval` — an immutable duration value object backed by
 * `Temporal.Duration`. Every modifier returns a new instance; arithmetic is
 * calendar-aware (months of varying length resolve correctly).
 */

import { Temporal } from "./temporal-shim.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A plain object describing a duration by its individual time-unit fields. */
export interface DurationLike {
  years?: number;
  months?: number;
  weeks?: number;
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
  microseconds?: number;
  nanoseconds?: number;
}

// ── CarbonInterval ────────────────────────────────────────────────────────────

/**
 * An immutable, calendar-aware duration backed by `Temporal.Duration`; every
 * modifier returns a new instance. Build durations fluently, do arithmetic on
 * them, apply them to a {@link Carbon}, and render them for humans or as ISO 8601.
 *
 * @example
 * ```ts
 * import { Carbon, CarbonInterval } from "@zerotal/core/carbon";
 *
 * const span = CarbonInterval.days(1).andHours(2).andMinutes(30);
 * span.forHumans();          // "1 day 2 hours 30 minutes"
 * span.toISO();              // "P1DT2H30M"
 * Carbon.now().add(span);    // apply to a date
 *
 * CarbonInterval.fromISO("PT90M").cascade(); // → 1 hour 30 minutes
 * ```
 */
export class CarbonInterval {
  /** @internal — the backing Temporal.Duration (treat as immutable) */
  readonly _duration: Temporal.Duration;

  constructor(duration: Temporal.Duration | DurationLike = {}) {
    if (duration instanceof Temporal.Duration) {
      this._duration = duration;
    } else {
      this._duration = new Temporal.Duration(
        duration.years ?? 0,
        duration.months ?? 0,
        duration.weeks ?? 0,
        duration.days ?? 0,
        duration.hours ?? 0,
        duration.minutes ?? 0,
        duration.seconds ?? 0,
        duration.milliseconds ?? 0,
        duration.microseconds ?? 0,
        duration.nanoseconds ?? 0,
      );
    }
  }

  // ── Internal wrap ─────────────────────────────────────────────────────────

  private _wrap(duration: Temporal.Duration): CarbonInterval {
    const interval = Object.create(CarbonInterval.prototype) as CarbonInterval;
    (interval as unknown as { _duration: Temporal.Duration })._duration = duration;
    return interval;
  }

  // ── Static factories ──────────────────────────────────────────────────────

  static years(amount: number): CarbonInterval {
    return new CarbonInterval({ years: amount });
  }
  static months(amount: number): CarbonInterval {
    return new CarbonInterval({ months: amount });
  }
  static weeks(amount: number): CarbonInterval {
    return new CarbonInterval({ weeks: amount });
  }
  static days(amount: number): CarbonInterval {
    return new CarbonInterval({ days: amount });
  }
  static hours(amount: number): CarbonInterval {
    return new CarbonInterval({ hours: amount });
  }
  static minutes(amount: number): CarbonInterval {
    return new CarbonInterval({ minutes: amount });
  }
  static seconds(amount: number): CarbonInterval {
    return new CarbonInterval({ seconds: amount });
  }
  static milliseconds(amount: number): CarbonInterval {
    return new CarbonInterval({ milliseconds: amount });
  }
  static microseconds(amount: number): CarbonInterval {
    return new CarbonInterval({ microseconds: amount });
  }
  static nanoseconds(amount: number): CarbonInterval {
    return new CarbonInterval({ nanoseconds: amount });
  }

  /**
   * Wrap an existing Temporal.Duration.
   *
   * @example
   * const dur = Temporal.Duration.from('P1Y2M3DT4H5M6S');
   * const interval = CarbonInterval.fromDuration(dur);
   */
  static fromDuration(duration: Temporal.Duration): CarbonInterval {
    return new CarbonInterval(duration);
  }

  /**
   * Parse an ISO 8601 duration string.
   *
   * @example
   * CarbonInterval.fromISO('P1Y2M3DT4H5M6S')
   * CarbonInterval.fromISO('PT30M')
   */
  static fromISO(iso: string): CarbonInterval {
    return new CarbonInterval(Temporal.Duration.from(iso));
  }

  /**
   * Return the absolute (non-negative) version of all fields.
   */
  static abs(interval: CarbonInterval): CarbonInterval {
    return interval.abs();
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  get years(): number {
    return this._duration.years;
  }
  get months(): number {
    return this._duration.months;
  }
  get weeks(): number {
    return this._duration.weeks;
  }
  get days(): number {
    return this._duration.days;
  }
  get hours(): number {
    return this._duration.hours;
  }
  get minutes(): number {
    return this._duration.minutes;
  }
  get seconds(): number {
    return this._duration.seconds;
  }
  get milliseconds(): number {
    return this._duration.milliseconds;
  }
  get microseconds(): number {
    return this._duration.microseconds;
  }
  get nanoseconds(): number {
    return this._duration.nanoseconds;
  }

  /** Sign of the duration: 1, -1, or 0. */
  get sign(): -1 | 0 | 1 {
    return this._duration.sign as -1 | 0 | 1;
  }

  get isZero(): boolean {
    return this._duration.blank;
  }

  // ── Fluent builder ("and*" prefix) ────────────────────────────────────────

  /**
   * Return a new interval that also adds the given years.
   *
   * @example
   * CarbonInterval.days(3).andHours(6).andMinutes(30)
   */
  andYears(amount: number): CarbonInterval {
    return this.add(CarbonInterval.years(amount));
  }
  andMonths(amount: number): CarbonInterval {
    return this.add(CarbonInterval.months(amount));
  }
  andWeeks(amount: number): CarbonInterval {
    return this.add(CarbonInterval.weeks(amount));
  }
  andDays(amount: number): CarbonInterval {
    return this.add(CarbonInterval.days(amount));
  }
  andHours(amount: number): CarbonInterval {
    return this.add(CarbonInterval.hours(amount));
  }
  andMinutes(amount: number): CarbonInterval {
    return this.add(CarbonInterval.minutes(amount));
  }
  andSeconds(amount: number): CarbonInterval {
    return this.add(CarbonInterval.seconds(amount));
  }
  andMilliseconds(amount: number): CarbonInterval {
    return this.add(CarbonInterval.milliseconds(amount));
  }
  andMicroseconds(amount: number): CarbonInterval {
    return this.add(CarbonInterval.microseconds(amount));
  }
  andNanoseconds(amount: number): CarbonInterval {
    return this.add(CarbonInterval.nanoseconds(amount));
  }

  // ── Arithmetic ────────────────────────────────────────────────────────────

  /**
   * Return a new interval that is the sum of this and another.
   *
   * @example
   * CarbonInterval.hours(2).add(CarbonInterval.minutes(30))
   */
  add(other: CarbonInterval): CarbonInterval {
    return this._wrap(this._duration.add(other._duration));
  }

  /**
   * Return a new interval that is this minus another.
   */
  subtract(other: CarbonInterval): CarbonInterval {
    return this._wrap(this._duration.subtract(other._duration));
  }

  /**
   * Return a new interval with all fields negated.
   */
  negate(): CarbonInterval {
    return this._wrap(this._duration.negated());
  }

  /**
   * Return a new interval with all negative fields made positive.
   */
  abs(): CarbonInterval {
    return this._wrap(this._duration.abs());
  }

  /**
   * Multiply all fields by a scalar.
   *
   * @example
   * CarbonInterval.hours(1).multiply(3)  // → 3 hours
   */
  multiply(factor: number): CarbonInterval {
    return new CarbonInterval({
      years: Math.round(this.years * factor),
      months: Math.round(this.months * factor),
      weeks: Math.round(this.weeks * factor),
      days: Math.round(this.days * factor),
      hours: Math.round(this.hours * factor),
      minutes: Math.round(this.minutes * factor),
      seconds: Math.round(this.seconds * factor),
      milliseconds: Math.round(this.milliseconds * factor),
      microseconds: Math.round(this.microseconds * factor),
      nanoseconds: Math.round(this.nanoseconds * factor),
    });
  }

  // ── Normalisation ─────────────────────────────────────────────────────────

  /**
   * Cascade (normalize) excess sub-units up to higher units.
   *
   * Requires a reference ZonedDateTime to resolve calendar ambiguities
   * (e.g. how many days are in a month). Defaults to "now" in UTC.
   *
   * @example
   * CarbonInterval.seconds(90).cascade()
   * // → CarbonInterval { minutes: 1, seconds: 30 }
   *
   * CarbonInterval.minutes(90).cascade()
   * // → CarbonInterval { hours: 1, minutes: 30 }
   */
  cascade(relativeTo?: Temporal.ZonedDateTime): CarbonInterval {
    const ref = relativeTo ?? Temporal.Now.zonedDateTimeISO("UTC");
    const balanced = this._duration.round({
      largestUnit: "years",
      relativeTo: ref,
    });
    return this._wrap(balanced);
  }

  // ── Total values ──────────────────────────────────────────────────────────

  /**
   * Convert this interval to a total number of seconds.
   * Calendar units (years, months) are approximated.
   */
  totalSeconds(): number {
    return (
      this.years * 365.25 * 24 * 3600 +
      this.months * 30.4375 * 24 * 3600 +
      this.weeks * 7 * 24 * 3600 +
      this.days * 24 * 3600 +
      this.hours * 3600 +
      this.minutes * 60 +
      this.seconds +
      this.milliseconds / 1_000 +
      this.microseconds / 1_000_000 +
      this.nanoseconds / 1_000_000_000
    );
  }

  totalMinutes(): number {
    return this.totalSeconds() / 60;
  }
  totalHours(): number {
    return this.totalSeconds() / 3600;
  }
  totalDays(): number {
    return this.totalSeconds() / 86_400;
  }
  totalWeeks(): number {
    return this.totalDays() / 7;
  }

  // ── Human-readable ────────────────────────────────────────────────────────

  /**
   * Return a human-readable description of the interval.
   *
   * @example
   * CarbonInterval.days(1).andHours(2).andMinutes(30).forHumans()
   * // → "1 day 2 hours 30 minutes"
   *
   * CarbonInterval.years(2).andMonths(3).forHumans({ join: ' and ' })
   * // → "2 years and 3 months"
   */
  forHumans(options: { join?: string; short?: boolean } = {}): string {
    const { join = " ", short = false } = options;

    const parts: string[] = [];

    const add = (value: number, singular: string, plural?: string) => {
      if (value === 0) return;
      const label = short
        ? singular.slice(0, 3)
        : value === 1
          ? singular
          : (plural ?? singular + "s");
      parts.push(`${value} ${label}`);
    };

    add(Math.abs(this.years), "year");
    add(Math.abs(this.months), "month");
    add(Math.abs(this.weeks), "week");
    add(Math.abs(this.days), "day");
    add(Math.abs(this.hours), "hour");
    add(Math.abs(this.minutes), "minute");
    add(Math.abs(this.seconds), "second");
    add(Math.abs(this.milliseconds), "millisecond");
    add(Math.abs(this.microseconds), "microsecond");
    add(Math.abs(this.nanoseconds), "nanosecond");

    if (parts.length === 0) return short ? "0s" : "0 seconds";
    return (this.sign < 0 ? "-" : "") + parts.join(join);
  }

  // ── Serialisation ─────────────────────────────────────────────────────────

  /**
   * Return the ISO 8601 duration string.
   *
   * @example
   * CarbonInterval.days(1).andHours(2).toISO()
   * // → "P1DT2H"
   */
  toISO(): string {
    return this._duration.toString();
  }

  /** Alias for toISO(). Used by JSON.stringify. */
  toJSON(): string {
    return this.toISO();
  }

  toString(): string {
    return this.forHumans();
  }

  /** Return the backing Temporal.Duration. */
  toDuration(): Temporal.Duration {
    return this._duration;
  }

  // ── Comparison ────────────────────────────────────────────────────────────

  /**
   * Compare two intervals by total seconds (approximate for calendar units).
   * Returns -1, 0, or 1.
   */
  static compare(a: CarbonInterval, b: CarbonInterval): -1 | 0 | 1 {
    const diff = a.totalSeconds() - b.totalSeconds();
    if (diff < 0) return -1;
    if (diff > 0) return 1;
    return 0;
  }

  isLessThan(other: CarbonInterval): boolean {
    return CarbonInterval.compare(this, other) < 0;
  }
  isGreaterThan(other: CarbonInterval): boolean {
    return CarbonInterval.compare(this, other) > 0;
  }
  isEqualTo(other: CarbonInterval): boolean {
    return CarbonInterval.compare(this, other) === 0;
  }
}
