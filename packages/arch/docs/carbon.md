---
title: Carbon & CarbonInterval
description: Timezone-aware, immutable date-times and durations — creating, reading, arithmetic, differences, formatting, intervals, and testing on one page.
---

# Carbon & CarbonInterval

Carbon is an immutable date-time value object backed by the TC39 Temporal API
(`Temporal.ZonedDateTime`); CarbonInterval is its companion duration type. Every
modifier returns a **new** instance, so values are safe to share, cache, and pass
around without defensive copying.

Reach for Carbon instead of the native `Date` whenever you need timezone-aware
arithmetic, fluent formatting, or human-readable diffs.

## Getting Started

Both classes are exported from `zerotal/carbon` — no package to install or provider
to register, they are part of the core runtime.

```typescript
// in a controller, model, or anywhere in your app
import { Carbon, CarbonInterval } from "zerotal/carbon";
```

## Creating a Carbon

The constructor accepts a string, a millisecond timestamp, a native `Date`, a
Temporal type, or another Carbon. A second argument sets the timezone.

```typescript fragment
// anywhere in your app
// Current date and time (system timezone)
const now = new Carbon();
const now2 = Carbon.now();

// With an explicit timezone
const inNY = Carbon.now("America/New_York");
const inLondon = new Carbon(new Date(), "Europe/London");

// From a string
const d1 = new Carbon("2026-06-15");
const d2 = new Carbon("2026-06-15T09:30:00");
const d3 = new Carbon("2026-06-15T09:30:00+02:00[Europe/Paris]"); // ZonedDateTime string

// From a Unix timestamp in milliseconds
const d4 = new Carbon(1_718_400_000_000);

// From a Unix timestamp (static factories)
const d5 = Carbon.fromTimestamp(1_718_400); // seconds
const d6 = Carbon.fromMilliseconds(1_718_400_000); // milliseconds

// From a native Date
const d7 = new Carbon(new Date());

// From a Temporal type (Instant, PlainDateTime, PlainDate, ZonedDateTime)
const d8 = new Carbon(Temporal.Now.instant());
```

Named static factories cover the common boundary cases (all accept an optional
timezone string):

```typescript fragment
// anywhere in your app
Carbon.today(); // today at 00:00:00
Carbon.tomorrow(); // tomorrow at 00:00:00
Carbon.yesterday(); // yesterday at 00:00:00
Carbon.startOfMonth(); // first day of current month at 00:00:00
Carbon.endOfMonth(); // last day of current month at 23:59:59.999…
Carbon.startOfWeek(); // Monday of current ISO week at 00:00:00
Carbon.endOfWeek(); // Sunday of current ISO week at 23:59:59.999…
Carbon.startOfYear(); // 1 Jan at 00:00:00
Carbon.endOfYear(); // 31 Dec at 23:59:59.999…
Carbon.create(input); // same as new Carbon(input)
```

## Immutability

Every modifier returns a **new** Carbon. Chain freely — the base instance never
changes.

```typescript fragment
// anywhere in your app
const base = new Carbon("2026-01-15");
const nextWeek = base.addDays(7);
const deadline = base.addMonths(1).startOfDay();

base.format("YYYY-MM-DD"); // '2026-01-15' — unchanged
nextWeek.format("YYYY-MM-DD"); // '2026-01-22'
deadline.format("YYYY-MM-DD"); // '2026-02-15'
```

## Timezones

A Carbon carries its timezone; converting produces a new instance pointing at the
same instant.

```typescript fragment
// anywhere in your app
// Read the timezone of an instance
const tz = Carbon.now("Asia/Tokyo").timezone; // 'Asia/Tokyo'

// Convert to a different timezone (same instant, different local time)
const utc = new Carbon("2026-06-15T12:00:00", "UTC");
const paris = utc.inTimezone("Europe/Paris"); // 14:00 (UTC+2)
const tokyo = utc.inTimezone("Asia/Tokyo"); // 21:00 (UTC+9)

// Static factories accept a timezone
const ny = Carbon.today("America/New_York");
```

## Reading a Carbon

### Getters

Reading a Carbon never changes it. Calendar fields are plain properties, so they
carry no parentheses; the three counts that depend on the surrounding calendar are
methods, because they compute an answer rather than expose a stored field.

```typescript fragment
// anywhere in your app
const d = new Carbon("2026-06-15 09:30:45.123");

d.year; // 2026
d.month; // 6    (1-indexed)
d.day; // 15
d.hour; // 9
d.minute; // 30
d.second; // 45
d.millisecond; // 123
d.microsecond; // 0
d.nanosecond; // 0

d.dayOfWeek; // 1    (ISO 8601: 1 = Monday … 7 = Sunday)
d.dayOfYear; // 166
d.weekOfYear; // 25   (ISO week number)

d.monthName; // 'June'
d.dayName; // 'Monday'

d.timezone; // 'America/Chicago'  (system tz)

d.daysInMonth(); // 30
d.daysInYear(); // 365
d.weeksInYear(); // 52
```

This `d` is the sample instance the arithmetic and formatting examples below reuse.

Two of these follow ISO 8601 where the native `Date` does not, and both differences
bite silently — the code runs and the answer is wrong:

| Field       | Carbon                  | Native `Date`            |
| ----------- | ----------------------- | ------------------------ |
| `month`     | 1 = January             | `getMonth()` 0 = January |
| `dayOfWeek` | 1 = Monday … 7 = Sunday | `getDay()` 0 = Sunday    |

Getters read the value in the instance's own timezone, so the same instant viewed
in two zones reports different fields. That is the intended behaviour, and the
reason to compare instants with the predicates below rather than by pulling fields
out and comparing them by hand.

### Predicates

```typescript fragment
// anywhere in your app
d.isToday();
d.isTomorrow();
d.isYesterday();

d.isPast(); // strictly before now
d.isFuture(); // strictly after now

d.isWeekend(); // Saturday (6) or Sunday (7) in ISO dayOfWeek
d.isWeekday();

d.isLeapYear();

d.isBefore(other);
d.isAfter(other);
d.isEqual(other); // same instant

d.isSameDay(other); // same calendar date
d.isSameMonth(other); // same year + month
d.isSameYear(other);

d.isBetween(start, end); // inclusive (default)
d.isBetween(start, end, false); // exclusive
```

`isPast()` and `isFuture()` are strict: an instant equal to now satisfies neither.

> **Warning** — Comparing two Carbons with `===` compares object identity and is
> always false. Compare with the predicates above (`isEqual`, `isBefore`,
> `isAfter`) or on a serialised form.

### Comparing instants and comparing dates

The comparison predicates fall into two families, and choosing across them is the
most common source of date bugs:

- **Instant comparisons** — `isBefore`, `isAfter`, `isEqual` — ask which moment
  came first on the world's timeline. Timezones are already accounted for, so two
  values written in different zones compare correctly.
- **Calendar comparisons** — `isSameDay`, `isSameMonth`, `isSameYear` — ask whether
  two values fall in the same named period, as read in their own timezones.

The two disagree exactly when a timezone boundary falls between the values. Two
instants a minute apart can land on different calendar days; the same instant read
in Tokyo and in Chicago routinely does. So when the question is "did this happen
before that", reach for `isBefore`; when it is "does this belong to today's
report", reach for `isSameDay`.

`isBetween` includes both endpoints by default. Pass `false` as the third argument
for an exclusive range — worth doing when you are bucketing values into adjacent
ranges, where inclusive bounds would place a boundary value in both buckets.

## Arithmetic

### Add and subtract

All arithmetic returns a new Carbon.

```typescript fragment
// anywhere in your app
d.addNanoseconds(1)       d.subtractNanoseconds(1)
d.addMicroseconds(1)      d.subtractMicroseconds(1)
d.addMilliseconds(500)    d.subtractMilliseconds(500)
d.addSeconds(30)          d.subtractSeconds(30)
d.addMinutes(15)          d.subtractMinutes(15)
d.addHours(2)             d.subtractHours(2)
d.addDays(7)              d.subtractDays(7)
d.addWeeks(2)             d.subtractWeeks(2)
d.addMonths(3)            d.subtractMonths(3)
d.addYears(1)             d.subtractYears(1)
d.addDecades(1)           d.subtractDecades(1)
d.addCenturies(1)         d.subtractCenturies(1)
d.addMillennia(1)         d.subtractMillennia(1)
```

Short `sub*` aliases exist for the common units (`subDays`, `subMonths`, etc.).

Passing a negative amount is the same as subtracting, so one call site can move in
either direction from a computed value without branching.

To add a [CarbonInterval](#carboninterval), use `add()` / `subtract()`:

```typescript fragment
// anywhere in your app
const interval = CarbonInterval.days(3).andHours(6);

d.add(interval); // new Carbon = d + 3d 6h
d.subtract(interval); // new Carbon = d - 3d 6h
```

### Calendar units clamp, and do not reverse

Months and years are calendar units rather than fixed spans, so adding one lands
on the same day number in the target month — and clamps when that day does not
exist there:

```typescript fragment
new Carbon("2026-01-31").addMonths(1); // → 2026-02-28
new Carbon("2024-02-29").addYears(1); // → 2025-02-28
```

Clamping discards information, which makes month arithmetic asymmetric. Adding a
month and taking it back does not always return the original date:

```typescript fragment
new Carbon("2026-01-31").addMonths(1).subtractMonths(1); // → 2026-01-28
```

This is correct calendar behaviour rather than a rounding bug, and it matters in
two places worth guarding. When stepping through months in a loop, advance from a
fixed anchor rather than from the previous result, or the day of month drifts
earlier with every iteration. When a monthly billing date must stay on the 31st,
keep the intended day number alongside the date rather than trying to recover it
from the last value computed.

Days, hours, and the smaller units carry no such ambiguity — they are exact spans
and always reverse cleanly.

### Boundary methods

Snap to the start or end of a time period — all return a new Carbon.

```typescript fragment
// anywhere in your app
d.startOfMinute(); // :00.000
d.endOfMinute(); // :59.999999999

d.startOfHour(); // hh:00:00.000
d.endOfHour(); // hh:59:59.999999999

d.startOfDay(); // 00:00:00.000
d.endOfDay(); // 23:59:59.999999999

d.startOfWeek(); // Monday 00:00:00  (ISO: Mon–Sun)
d.endOfWeek(); // Sunday 23:59:59.999999999

d.startOfMonth(); // 1st of month, 00:00:00
d.endOfMonth(); // last day of month, 23:59:59.999999999

d.startOfYear(); // 1 Jan 00:00:00
d.endOfYear(); // 31 Dec 23:59:59.999999999

d.startOfDecade(); // first day of decade (e.g. 2020) 00:00:00
d.endOfDecade(); // last day of decade (e.g. 2029) 23:59:59.999…

d.startOfCentury(); // first day of century 00:00:00
d.endOfCentury(); // last day of century 23:59:59.999…
```

Weeks follow ISO 8601, so `startOfWeek()` moves back to Monday. Applied to a
Sunday it therefore travels six days _backwards_ rather than forward, because that
Sunday closes the week instead of opening it.

The `end*` methods land on the last representable nanosecond of the period rather
than on the start of the next one, which is what makes them safe as the upper
bound of an inclusive range: `between(startOfDay(), endOfDay())` captures the whole
day without also catching midnight the next morning.

### Field setters

The `with` prefix signals a new instance is returned.

```typescript fragment
// anywhere in your app
d.withYear(2030);
d.withMonth(12); // 1-indexed
d.withDay(1);
d.withHour(9);
d.withMinute(0);
d.withSecond(0);
d.withMillisecond(0);
d.withMicrosecond(0);
d.withNanosecond(0);
d.withTime(9, 30); // hours + minutes (seconds and ms reset to 0)
d.withTime(9, 30, 0, 0); // hours, minutes, seconds, milliseconds
```

Setters replace a field outright instead of shifting by an amount — the difference
between "the 15th of this month" (`withDay(15)`) and "a fortnight from now"
(`addDays(14)`). Reach for `withTime()` when normalising a timestamp to a fixed
time of day, since it resets the smaller fields for you rather than needing a chain
of setters.

## Differences

All numeric diff methods return a **number** — positive when `this` is after
`other`.

```typescript fragment
// anywhere in your app
const a = new Carbon("2026-01-01");
const b = new Carbon("2026-06-15");

b.diffInMilliseconds(a); // ~14,515,200,000  (raw millisecond difference)
b.diffInSeconds(a);
b.diffInMinutes(a);
b.diffInHours(a);
b.diffInDays(a); // ~165.5
b.diffInWeeks(a); // ~23.6
b.diffInMonths(a); // 5    (calendar months: year×12 + month delta)
b.diffInYears(a); // ~0.42
```

> **Note** — `diffInMonths` counts calendar months (`year×12 + month` delta), not
> elapsed time, so `diffInYears` derives from it. For a fractional, instant-based
> measure use `diffInDays` or `diffAsCarbonInterval`.

For a calendar-aware breakdown use `diffAsCarbonInterval`, which delegates to
Temporal's `until()`:

```typescript fragment
// anywhere in your app
const age = birthday.diffAsCarbonInterval(Carbon.now(), "year");
// → CarbonInterval { years: 28, months: 3, days: 12, … }

age.years; // 28
age.forHumans(); // '28 years'

// largestUnit controls the highest denomination in the result
post.createdAt.diffAsCarbonInterval(Carbon.now(), "day");
// → CarbonInterval { days: 165, hours: 3, minutes: 22, … }
```

The `largestUnit` defaults to `'day'` and accepts `'year'`, `'month'`, `'week'`,
`'day'`, `'hour'`, `'minute'`, `'second'`, or `'millisecond'`.

### diffForHumans

Returns a human-readable relative string using `Intl.RelativeTimeFormat`. With no
argument it compares against now.

```typescript fragment
// anywhere in your app
const posted = new Carbon("2026-06-08");
posted.diffForHumans(); // '1 week ago'

// Compare to a specific date instead of now
const a = new Carbon("2026-01-01");
const b = new Carbon("2026-06-09");
a.diffForHumans(b); // '5 months ago'
```

Pass an options object to tune the output:

```typescript fragment
// anywhere in your app
a.diffForHumans(b, {
  parts: 2, // include up to 2 units → '5 months, 1 week ago'
  absolute: true, // drop "ago / from now"  → '5 months, 1 week'
  join: " and ", // custom joiner          → '5 months and 1 week ago'
  locale: "fr", // locale                 → 'il y a 5 mois'
  intl: { numeric: "always" },
  syntax: "ago", // force past phrasing ('ago' | 'from')
});
```

```typescript fragment
// anywhere in your app
const future = Carbon.now().addDays(3);
future.diffForHumans(); // '3 days from now'
future.diffForHumans({ syntax: "ago" }); // '3 days ago'
future.diffForHumans({ absolute: true }); // '3 days'
```

> **Tip** — `parts` defaults to `1`, so only the largest unit shows by default.
> Bump it to surface finer detail (`'5 months, 1 week ago'`).

## Formatting

### Token-based

```typescript fragment
// anywhere in your app
d.format(); // '2026-06-15 09:30:00'  (default)
d.format("YYYY-MM-DD"); // '2026-06-15'
d.format("DD/MM/YYYY"); // '15/06/2026'
d.format("DDDD, DD MMMM YYYY"); // 'Monday, 15 June 2026'
d.format("HH:mm:ss"); // '09:30:00'
d.format("SSS"); // '042'  (milliseconds)
d.format("YYYY-MM-DDTHH:mm:ssZ"); // '2026-06-15T09:30:00+02:00'
```

| Token  | Output                  | Example         |
| ------ | ----------------------- | --------------- |
| `YYYY` | 4-digit year            | `2026`          |
| `YY`   | 2-digit year            | `26`            |
| `MMMM` | Full month              | `June`          |
| `MMM`  | Short month             | `Jun`           |
| `MM`   | Month (padded)          | `06`            |
| `M`    | Month                   | `6`             |
| `DDDD` | Full weekday            | `Monday`        |
| `DDD`  | Short weekday           | `Mon`           |
| `DD`   | Day (padded)            | `05`            |
| `D`    | Day                     | `5`             |
| `HH`   | Hour 24h (padded)       | `09`            |
| `H`    | Hour 24h                | `9`             |
| `mm`   | Minutes (padded)        | `04`            |
| `m`    | Minutes                 | `4`             |
| `ss`   | Seconds (padded)        | `07`            |
| `s`    | Seconds                 | `7`             |
| `SSS`  | Milliseconds            | `042`           |
| `SS`   | Milliseconds (2 digits) | `04`            |
| `S`    | Milliseconds (1 digit)  | `0`             |
| `Z`    | UTC offset              | `+05:30` or `Z` |

### Locale-aware

`intlFormat` delegates to `Intl.DateTimeFormat`:

```typescript fragment
// anywhere in your app
d.intlFormat("en-US", { dateStyle: "full" });
// → 'Monday, June 15, 2026'

d.intlFormat("fr-FR", { dateStyle: "long" });
// → '15 juin 2026'

d.intlFormat("en-ZA", { dateStyle: "short", timeStyle: "short" });
// → '2026/06/15, 09:30'

d.intlFormat("ja-JP", { year: "numeric", month: "long", day: "numeric" });
// → '2026年6月15日'
```

### Convenience formatters

```typescript fragment
// anywhere in your app
d.toDateString(); // '2026-06-15'
d.toDateTimeString(); // '2026-06-15 09:30:00'
d.toTimeString(); // '09:30:00'
d.toShortDate(); // 'Jun 15, 2026'
d.toLongDate(); // '15 June 2026'
```

### Which formatter should I use?

- **`format(token)`** — fixed, machine-style output you control exactly (logs,
  filenames, API payloads). Locale-independent.
- **`intlFormat(locale, options)`** — output shown to a user whose locale and date
  style should adapt. Delegates to the platform.
- **`toShortDate()` / `toLongDate()` / `toDateString()` etc.** — quick presets when
  you don't want to remember tokens.

## Serialisation

```typescript fragment
// anywhere in your app
d.toDate(); // native Date
d.toISOString(); // '2026-06-15T07:30:00+00:00' (UTC)
d.toDatabase(); // same — compatible with DB datetime columns
d.toUnix(); // 1_750_067_400 (seconds)
d.toMilliseconds(); // 1_750_067_400_000
d.valueOf(); // same as toMilliseconds() — enables < > comparisons
d.toJSON(); // same as toISOString() — used by JSON.stringify()
d.toString(); // '2026-06-15 09:30:00'

// Temporal interop
d.toZonedDateTime(); // Temporal.ZonedDateTime
d.toInstant(); // Temporal.Instant
d.toPlainDateTime(); // Temporal.PlainDateTime (loses timezone)
d.toPlainDate(); // Temporal.PlainDate (loses time + timezone)
```

`valueOf()` enables direct comparison with `<`, `>`, `-`:

```typescript fragment
// anywhere in your app
const a = new Carbon("2026-01-01");
const b = new Carbon("2026-06-15");

a < b; // true
b - a; // ms between them
Math.min(+a, +b) === +a; // true
```

## CarbonInterval

`CarbonInterval` is an immutable duration value object backed by
`Temporal.Duration`. Every method returns a new instance.

```typescript fragment
// anywhere in your app
import { CarbonInterval } from "zerotal/carbon";

// Single-unit factories
const a = CarbonInterval.years(1);
const b = CarbonInterval.months(6);
const c = CarbonInterval.weeks(2);
const e = CarbonInterval.days(3);
const f = CarbonInterval.hours(4);
const g = CarbonInterval.minutes(30);
const h = CarbonInterval.seconds(90);
const i = CarbonInterval.milliseconds(500);
const j = CarbonInterval.microseconds(250);
const k = CarbonInterval.nanoseconds(100);

// From ISO 8601 duration string
const fromIso = CarbonInterval.fromISO("P1Y2M3DT4H5M6S");
const halfHour = CarbonInterval.fromISO("PT30M");

// From a Temporal.Duration
const fromDur = CarbonInterval.fromDuration(Temporal.Duration.from("P1D"));

// Direct constructor
const built = new CarbonInterval({ years: 1, months: 6, days: 3 });
```

### Fluent builder

Chain `and*` methods to compose multi-unit intervals:

```typescript fragment
// anywhere in your app
CarbonInterval.days(3).andHours(6).andMinutes(30);
// → 3 days 6 hours 30 minutes

CarbonInterval.years(1).andMonths(6);
// → 1 year 6 months

CarbonInterval.hours(2).andSeconds(45);
// → 2 hours 45 seconds
```

Available: `andYears`, `andMonths`, `andWeeks`, `andDays`, `andHours`,
`andMinutes`, `andSeconds`, `andMilliseconds`, `andMicroseconds`, `andNanoseconds`.

### Interval getters

```typescript fragment
// anywhere in your app
const i = CarbonInterval.fromISO("P1Y2M3DT4H5M6S");

i.years; // 1
i.months; // 2
i.weeks; // 0
i.days; // 3
i.hours; // 4
i.minutes; // 5
i.seconds; // 6
i.milliseconds; // 0
i.microseconds; // 0
i.nanoseconds; // 0

i.sign; // 1 (positive), -1 (negative), or 0 (zero)
i.isZero; // false
```

### Interval arithmetic

```typescript fragment
// anywhere in your app
const a = CarbonInterval.hours(2);
const b = CarbonInterval.minutes(30);

a.add(b); // 2 hours 30 minutes
a.subtract(b); // 1 hour 30 minutes
a.multiply(3); // 6 hours
a.negate(); // -2 hours
CarbonInterval.abs(a.negate()); // 2 hours  (all fields positive)
```

### Normalization

`cascade()` rolls excess sub-units up into higher ones. It needs a reference date
for calendar-aware units (months, years) and defaults to now in UTC.

```typescript fragment
// anywhere in your app
CarbonInterval.seconds(90).cascade();
// → { minutes: 1, seconds: 30 }

CarbonInterval.minutes(90).cascade();
// → { hours: 1, minutes: 30 }

CarbonInterval.days(32).cascade();
// → { months: 1, days: 1 }  (calendar-aware — exact result depends on reference month)

// Pass an explicit reference date
CarbonInterval.days(32).cascade(Carbon.today().inTimezone("UTC").toZonedDateTime());
```

> **Warning** — Because `cascade()` is calendar-aware, the result of normalizing
> days into months depends on the reference month's length. Pass an explicit
> `relativeTo` when you need a deterministic outcome.

### Total values

Calendar units (years, months) are approximated as average lengths.

```typescript fragment
// anywhere in your app
CarbonInterval.hours(2).andMinutes(30).totalMinutes(); // 150
CarbonInterval.days(3).andHours(6).totalHours(); // 78

i.totalSeconds(); // all fields converted to seconds
i.totalMinutes();
i.totalHours();
i.totalDays();
i.totalWeeks();
```

### Interval comparison

```typescript fragment
// anywhere in your app
const a = CarbonInterval.hours(2);
const b = CarbonInterval.minutes(90);

a.isGreaterThan(b); // true  (2h > 1.5h)
b.isLessThan(a); // true
a.isEqualTo(b); // false

CarbonInterval.compare(a, b); // 1 (a > b), -1 (a < b), 0 (equal)
```

### Human-readable output

```typescript fragment
// anywhere in your app
CarbonInterval.days(1).andHours(2).andMinutes(30).forHumans();
// → '1 day 2 hours 30 minutes'

CarbonInterval.years(2).andMonths(3).forHumans({ join: " and " });
// → '2 years and 3 months'

CarbonInterval.hours(3).forHumans({ short: true });
// → '3 hou'  (first 3 chars of each unit label)

i.toString(); // alias for forHumans()
```

### Interval serialisation

```typescript fragment
// anywhere in your app
CarbonInterval.days(1).andHours(2).toISO();
// → 'P1DT2H'

CarbonInterval.years(1).andMonths(6).andDays(3).toISO();
// → 'P1Y6M3D'

i.toJSON(); // same as toISO() — used by JSON.stringify()
i.toDuration(); // Temporal.Duration
```

### Using CarbonInterval with Carbon

An interval is what [`add()` and `subtract()`](#add-and-subtract) accept, and what
[`diffAsCarbonInterval()`](#differences) returns — the two directions between the
types:

```typescript fragment
// anywhere in your app
const interval = CarbonInterval.days(3).andHours(6);

Carbon.now().add(interval); // Carbon + interval → Carbon
birthday.diffAsCarbonInterval(Carbon.now(), "year"); // Carbon − Carbon → interval
```

## Testing

Set your suite up once as described in [Testing](/docs/testing). Carbon is
immutable and pure, so it needs no application — but a test that reaches for
`Carbon.now()` is a test that will fail on a Tuesday.

**Pin the instant.** Pass a fixed input rather than using the current time, and
the assertion holds forever:

```typescript fragment
// tests/dates/BillingPeriod.test.ts
import { test, expect } from "bun:test";
import { Carbon } from "zerotal/carbon";
import { periodFor } from "../../app/services/billing.ts";

test("a mid-month signup bills to the end of the month", () => {
  const signedUp = Carbon.create("2026-03-14T09:00:00Z");

  const period = periodFor(signedUp);

  expect(period.end.toISOString()).toBe("2026-03-31T23:59:59.999Z");
});
```

**Take the clock as an argument** in any code you want to test. A service that
calls `Carbon.now()` internally can only be tested by waiting or by mocking; one
that accepts a `now` parameter is tested by passing a date:

```typescript fragment
// app/services/billing.ts
export function periodFor(signedUp: Carbon, now: Carbon = Carbon.now()): Period {
  // …
}
```

That default keeps the call site clean while leaving the seam open — and it is
the difference between a test suite that is deterministic and one that fails at
month end.

**Test the boundaries you actually cross.** Month ends, leap days, and DST
transitions are where date code breaks, and none of them appear in a test written
around today:

```typescript fragment
// tests/dates/BillingPeriod.test.ts
test("handles a leap day", () => {
  expect(Carbon.create("2028-02-29T12:00:00Z").addYears(1).toDateString()).toBe("2029-02-28");
});

test("survives a DST spring-forward", () => {
  const before = Carbon.create("2026-03-29T00:30:00Z", "Europe/London");

  expect(before.addHours(1).hour).toBe(2); // 01:30 does not exist locally
});
```

## References

### Carbon — static factories

| Method             | Signature                                                 | Description                                      |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------ |
| `now`              | `now(timezone?: string): Carbon`                          | Current instant in the system or given timezone. |
| `create`           | `create(input?: CarbonInput, timezone?: string): Carbon`  | Parse/wrap any supported input (same as `new`).  |
| `today`            | `today(timezone?: string): Carbon`                        | Today at 00:00:00.                               |
| `tomorrow`         | `tomorrow(timezone?: string): Carbon`                     | Tomorrow at 00:00:00.                            |
| `yesterday`        | `yesterday(timezone?: string): Carbon`                    | Yesterday at 00:00:00.                           |
| `fromTimestamp`    | `fromTimestamp(ts: number, timezone?: string): Carbon`    | From a Unix timestamp in **seconds**.            |
| `fromMilliseconds` | `fromMilliseconds(ms: number, timezone?: string): Carbon` | From a Unix timestamp in **milliseconds**.       |

### Carbon — selected instance methods

| Method                 | Signature                                                                                 | Description                                             |
| ---------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `inTimezone`           | `inTimezone(tz: string): Carbon`                                                          | Same instant in a different timezone.                   |
| `add` / `subtract`     | `add(interval: CarbonInterval): Carbon`                                                   | Apply a `CarbonInterval`.                               |
| `diffInMilliseconds`   | `diffInMilliseconds(other: Carbon): number`                                               | Raw millisecond difference `this - other`.              |
| `diffAsCarbonInterval` | `diffAsCarbonInterval(other: Carbon, largestUnit?: DateTimeUnit): CarbonInterval`         | Calendar-aware difference as an interval.               |
| `diffForHumans`        | `diffForHumans(other?: Carbon \| Date \| string, options?: DiffForHumansOptions): string` | Relative string via `Intl.RelativeTimeFormat`.          |
| `format`               | `format(template?: string): string`                                                       | Token-based formatting (default `YYYY-MM-DD HH:mm:ss`). |
| `intlFormat`           | `intlFormat(locale?: string, options?: Intl.DateTimeFormatOptions): string`               | Locale-aware formatting via `Intl.DateTimeFormat`.      |
| `valueOf`              | `valueOf(): number`                                                                       | Epoch milliseconds — enables `<`, `>`, `-`.             |
| `toDatabase`           | `toDatabase(): string`                                                                    | ISO string for DB datetime columns.                     |

### CarbonInterval — members

| Method                          | Signature                                                         | Description                                           |
| ------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| `years` … `nanoseconds`         | `static years(amount: number): CarbonInterval`                    | Single-unit factories.                                |
| `fromISO`                       | `static fromISO(iso: string): CarbonInterval`                     | Parse an ISO 8601 duration string.                    |
| `fromDuration`                  | `static fromDuration(d: Temporal.Duration): CarbonInterval`       | Wrap a `Temporal.Duration`.                           |
| `andYears` … `andNanoseconds`   | `andHours(amount: number): CarbonInterval`                        | Fluent builder — add another unit.                    |
| `add` / `subtract` / `multiply` | `add(other: CarbonInterval): CarbonInterval`                      | Interval arithmetic.                                  |
| `negate` / `abs`                | `negate(): CarbonInterval`                                        | Negate, or take the absolute value.                   |
| `cascade`                       | `cascade(relativeTo?: Temporal.ZonedDateTime): CarbonInterval`    | Normalize sub-units up into higher units.             |
| `totalSeconds` … `totalWeeks`   | `totalHours(): number`                                            | Total in a single unit (calendar units approximated). |
| `compare`                       | `static compare(a, b): -1 \| 0 \| 1`                              | Compare two intervals by total seconds.               |
| `forHumans`                     | `forHumans(options?: { join?: string; short?: boolean }): string` | Human-readable description.                           |
| `toISO`                         | `toISO(): string`                                                 | ISO 8601 duration string (`toJSON` alias).            |

## Types

`DurationLike` is what the arithmetic methods accept — `add`, `subtract` and their kin — so a
duration can be built once and passed around rather than spelled out at each call site.

## Next steps

- [Casts & Mutators](/docs/orm/casts) — `datetime` columns hydrate to Carbon automatically.
- [Migrations](/docs/migrations) — `dateTime`, `timestamp`, and `date` column types.
- [Helpers](/docs/helpers) — other framework value objects and utilities.
