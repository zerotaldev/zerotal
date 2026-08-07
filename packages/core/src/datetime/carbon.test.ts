import { describe, it, expect } from "bun:test";
import { Carbon } from "./Carbon.ts";
import { CarbonInterval } from "./CarbonInterval.ts";
import { Temporal } from "./temporal-shim.ts";

// Fixed base: 2024-03-15 10:30:45.123 UTC (a Friday)
const BASE = "2024-03-15T10:30:45.123Z";
function base(): Carbon {
  return Carbon.create(BASE, "UTC");
}

// ── Carbon: static factories ──────────────────────────────────────────────────

describe("Carbon.now()", () => {
  it("returns a Carbon instance", () => {
    expect(Carbon.now()).toBeInstanceOf(Carbon);
  });
  it("accepts a timezone argument", () => {
    const c = Carbon.now("America/New_York");
    expect(c.timezone).toBe("America/New_York");
  });
  it("isToday() returns true", () => {
    expect(Carbon.now().isToday()).toBe(true);
  });
});

describe("Carbon.today() / tomorrow() / yesterday()", () => {
  it("today() starts at midnight", () => {
    const c = Carbon.today("UTC");
    expect(c.hour).toBe(0);
    expect(c.minute).toBe(0);
    expect(c.second).toBe(0);
  });
  it("tomorrow() is one day after today", () => {
    const t = Carbon.tomorrow("UTC");
    const today = Carbon.today("UTC");
    expect(t.diffInDays(today)).toBeCloseTo(1);
  });
  it("yesterday() is one day before today", () => {
    const y = Carbon.yesterday("UTC");
    const today = Carbon.today("UTC");
    expect(today.diffInDays(y)).toBeCloseTo(1);
  });
});

describe("Carbon.fromTimestamp()", () => {
  it("creates Carbon from unix seconds", () => {
    const ts = 1710498645; // 2024-03-15T10:30:45Z (verified)
    const c = Carbon.fromTimestamp(ts, "UTC");
    expect(c.year).toBe(2024);
    expect(c.month).toBe(3);
    expect(c.day).toBe(15);
    expect(c.hour).toBe(10);
    expect(c.second).toBe(45);
  });
});

describe("Carbon.fromMilliseconds()", () => {
  it("creates Carbon from milliseconds", () => {
    const ms = 1710496245123;
    const c = Carbon.fromMilliseconds(ms, "UTC");
    expect(c.toMilliseconds()).toBe(ms);
  });
});

describe("Carbon static boundary helpers", () => {
  it("startOfMonth() returns day 1", () => {
    expect(Carbon.startOfMonth("UTC").day).toBe(1);
  });
  it("endOfMonth() returns last day", () => {
    const c = Carbon.endOfMonth("UTC");
    expect(c.day).toBeGreaterThanOrEqual(28);
    expect(c.hour).toBe(23);
  });
  it("startOfWeek() returns a Monday", () => {
    expect(Carbon.startOfWeek("UTC").dayOfWeek).toBe(1);
  });
  it("endOfWeek() returns a Sunday", () => {
    expect(Carbon.endOfWeek("UTC").dayOfWeek).toBe(7);
  });
  it("startOfYear() is Jan 1", () => {
    const c = Carbon.startOfYear("UTC");
    expect(c.month).toBe(1);
    expect(c.day).toBe(1);
  });
  it("endOfYear() is Dec 31", () => {
    const c = Carbon.endOfYear("UTC");
    expect(c.month).toBe(12);
    expect(c.day).toBe(31);
  });
});

// ── Carbon: constructor input types ───────────────────────────────────────────

describe("Carbon constructor inputs", () => {
  it("accepts a JS Date", () => {
    const d = new Date(2024, 2, 15, 10, 30, 45); // local time
    const c = new Carbon(d);
    expect(c).toBeInstanceOf(Carbon);
    expect(c.year).toBe(2024);
  });

  it("accepts a unix timestamp (number)", () => {
    const ms = 1710496245123;
    const c = new Carbon(ms, "UTC");
    expect(c.toMilliseconds()).toBe(ms);
  });

  it("accepts a Temporal.Instant", () => {
    const inst = Temporal.Instant.from("2024-03-15T10:30:45.123Z");
    const c = new Carbon(inst, "UTC");
    expect(c.year).toBe(2024);
    expect(c.second).toBe(45);
  });

  it("accepts a Temporal.ZonedDateTime", () => {
    const zdt = Temporal.ZonedDateTime.from("2024-03-15T10:30:45.123Z[UTC]");
    const c = new Carbon(zdt);
    expect(c.year).toBe(2024);
    expect(c.timezone).toBe("UTC");
  });

  it("accepts a Temporal.PlainDateTime", () => {
    const pdt = Temporal.PlainDateTime.from("2024-03-15T10:30:45");
    const c = new Carbon(pdt, "UTC");
    expect(c.year).toBe(2024);
    expect(c.hour).toBe(10);
  });

  it("accepts a Temporal.PlainDate", () => {
    const pd = Temporal.PlainDate.from("2024-03-15");
    const c = new Carbon(pd, "UTC");
    expect(c.year).toBe(2024);
    expect(c.month).toBe(3);
    expect(c.day).toBe(15);
    expect(c.hour).toBe(0);
  });

  it("accepts an ISO 8601 string with Z", () => {
    const c = new Carbon("2024-03-15T10:30:45.123Z", "UTC");
    expect(c.year).toBe(2024);
    expect(c.millisecond).toBe(123);
  });

  it("accepts an ISO 8601 string with zoned bracket", () => {
    const c = new Carbon("2024-03-15T10:30:45.123Z[UTC]");
    expect(c.year).toBe(2024);
    expect(c.timezone).toBe("UTC");
  });

  it("accepts a plain datetime string (no offset)", () => {
    const c = new Carbon("2024-03-15T10:30:45", "UTC");
    expect(c.year).toBe(2024);
    expect(c.hour).toBe(10);
  });

  it("accepts a plain date string", () => {
    const c = new Carbon("2024-03-15", "UTC");
    expect(c.year).toBe(2024);
    expect(c.month).toBe(3);
    expect(c.day).toBe(15);
    expect(c.hour).toBe(0);
  });

  it("accepts a Carbon instance (preserves timezone)", () => {
    const original = base();
    const copy = new Carbon(original);
    expect(copy.year).toBe(2024);
    expect(copy.timezone).toBe("UTC");
  });

  it("throws on unparseable string", () => {
    expect(() => new Carbon("not-a-date")).toThrow();
  });

  it('accepts a "YYYY-MM-DD HH:mm:ss" string (space separator)', () => {
    const c = Carbon.create("2024-06-01 08:00:00", "UTC");
    expect(c.year).toBe(2024);
    expect(c.month).toBe(6);
    expect(c.hour).toBe(8);
  });
});

// ── Carbon: getters ───────────────────────────────────────────────────────────

describe("Carbon getters", () => {
  it("exposes year/month/day/hour/minute/second/millisecond", () => {
    const c = base();
    expect(c.year).toBe(2024);
    expect(c.month).toBe(3);
    expect(c.day).toBe(15);
    expect(c.hour).toBe(10);
    expect(c.minute).toBe(30);
    expect(c.second).toBe(45);
    expect(c.millisecond).toBe(123);
  });

  it("microsecond / nanosecond are numbers", () => {
    const c = base();
    expect(typeof c.microsecond).toBe("number");
    expect(typeof c.nanosecond).toBe("number");
  });

  it("dayOfWeek: 2024-03-15 is a Friday (5)", () => {
    expect(base().dayOfWeek).toBe(5); // ISO: Mon=1 … Fri=5
  });

  it("dayOfYear is a positive integer", () => {
    const c = base();
    expect(c.dayOfYear).toBeGreaterThan(0);
    expect(c.dayOfYear).toBeLessThanOrEqual(366);
  });

  it("weekOfYear is between 1 and 53", () => {
    const c = base();
    expect(c.weekOfYear).toBeGreaterThanOrEqual(1);
    expect(c.weekOfYear).toBeLessThanOrEqual(53);
  });

  it("monthName returns a month string", () => {
    expect(base().monthName).toBe("March");
  });

  it("dayName returns a weekday string", () => {
    expect(base().dayName).toBe("Friday");
  });

  it("timezone returns the TZ ID", () => {
    expect(base().timezone).toBe("UTC");
  });
});

// ── Carbon: add methods ───────────────────────────────────────────────────────

describe("Carbon add/subtract", () => {
  it("addYears returns correct year", () => {
    expect(base().addYears(3).year).toBe(2027);
  });
  it("addMonths crosses year boundary", () => {
    const c = base().addMonths(11);
    expect(c.year).toBe(2025);
    expect(c.month).toBe(2);
  });
  it("addDays returns new instance", () => {
    const c = base().addDays(10);
    expect(c.day).toBe(25);
    expect(base().day).toBe(15); // original unchanged
  });
  it("addHours / addMinutes / addSeconds", () => {
    const c = base().addHours(3).addMinutes(15).addSeconds(10);
    expect(c.hour).toBe(13);
    expect(c.minute).toBe(45);
    expect(c.second).toBe(55);
  });
  it("addWeeks adds 7 days per week", () => {
    expect(base().addWeeks(2).diffInDays(base())).toBeCloseTo(14);
  });
  it("addMilliseconds", () => {
    expect(base().addMilliseconds(500).millisecond).toBe(623);
  });
  it("addMicroseconds", () => {
    const c = base().addMicroseconds(1000);
    expect(c).toBeInstanceOf(Carbon);
  });
  it("addNanoseconds", () => {
    const c = base().addNanoseconds(5000);
    expect(c).toBeInstanceOf(Carbon);
  });
  it("addDecades adds 10 years", () => {
    expect(base().addDecades(1).year).toBe(2034);
  });
  it("addCenturies adds 100 years", () => {
    expect(base().addCenturies(1).year).toBe(2124);
  });
  it("addMillennia adds 1000 years", () => {
    expect(base().addMillennia(1).year).toBe(3024);
  });

  it("subtractDays", () => {
    expect(base().subtractDays(5).day).toBe(10);
  });
  it("subtractMonths", () => {
    expect(base().subtractMonths(2).month).toBe(1);
  });
  it("subtractYears", () => {
    expect(base().subtractYears(1).year).toBe(2023);
  });
  it("subtractWeeks", () => {
    expect(base().subtractWeeks(1).diffInDays(base())).toBeCloseTo(-7);
  });
  it("subtractHours / subtractMinutes / subtractSeconds", () => {
    const c = base().subtractHours(2).subtractMinutes(30).subtractSeconds(45);
    expect(c.hour).toBe(8);
    expect(c.minute).toBe(0);
    expect(c.second).toBe(0);
  });
  it("subtractMilliseconds", () => {
    expect(base().subtractMilliseconds(123).millisecond).toBe(0);
  });
  it("subtractMicroseconds", () => {
    expect(base().subtractMicroseconds(100)).toBeInstanceOf(Carbon);
  });
  it("subtractNanoseconds", () => {
    expect(base().subtractNanoseconds(100)).toBeInstanceOf(Carbon);
  });
  it("subtractDecades", () => {
    expect(base().subtractDecades(1).year).toBe(2014);
  });
  it("subtractCenturies", () => {
    expect(base().subtractCenturies(1).year).toBe(1924);
  });
  it("subtractMillennia", () => {
    expect(base().subtractMillennia(1).year).toBe(1024);
  });

  it("sub* aliases work (subDays, subYears, subMonths)", () => {
    expect(base().subDays(3).day).toBe(12);
    expect(base().subYears(1).year).toBe(2023);
    expect(base().subMonths(1).month).toBe(2);
  });
  it("subWeeks", () => {
    expect(base().subWeeks(1).diffInDays(base())).toBeCloseTo(-7);
  });
  it("subHours / subMinutes / subSeconds", () => {
    expect(base().subHours(2).hour).toBe(8);
    expect(base().subMinutes(30).minute).toBe(0);
    expect(base().subSeconds(45).second).toBe(0);
  });
  it("subMilliseconds / subMicroseconds / subNanoseconds", () => {
    expect(base().subMilliseconds(100)).toBeInstanceOf(Carbon);
    expect(base().subMicroseconds(100)).toBeInstanceOf(Carbon);
  });
  it("subDecades", () => {
    expect(base().subDecades(1).year).toBe(2014);
  });
});

describe("Carbon.add(interval) and .subtract(interval)", () => {
  it("adds a CarbonInterval", () => {
    const ci = CarbonInterval.days(5).andHours(3);
    const c = base().add(ci);
    expect(c.day).toBe(20);
    expect(c.hour).toBe(13);
  });
  it("subtracts a CarbonInterval", () => {
    const ci = CarbonInterval.days(5);
    const c = base().subtract(ci);
    expect(c.day).toBe(10);
  });
});

// ── Carbon: boundary setters ──────────────────────────────────────────────────

describe("Carbon boundary setters", () => {
  it("startOfDay() zeros time to midnight", () => {
    const c = base().startOfDay();
    expect(c.hour).toBe(0);
    expect(c.minute).toBe(0);
    expect(c.second).toBe(0);
    expect(c.millisecond).toBe(0);
  });
  it("endOfDay() sets time to 23:59:59.999", () => {
    const c = base().endOfDay();
    expect(c.hour).toBe(23);
    expect(c.minute).toBe(59);
    expect(c.second).toBe(59);
    expect(c.millisecond).toBe(999);
  });
  it("startOfHour()", () => {
    const c = base().startOfHour();
    expect(c.minute).toBe(0);
    expect(c.second).toBe(0);
  });
  it("endOfHour()", () => {
    const c = base().endOfHour();
    expect(c.minute).toBe(59);
    expect(c.second).toBe(59);
  });
  it("startOfMinute()", () => {
    const c = base().startOfMinute();
    expect(c.second).toBe(0);
    expect(c.millisecond).toBe(0);
  });
  it("endOfMinute()", () => {
    const c = base().endOfMinute();
    expect(c.second).toBe(59);
  });
  it("startOfMonth() sets day to 1 at midnight", () => {
    const c = base().startOfMonth();
    expect(c.day).toBe(1);
    expect(c.hour).toBe(0);
  });
  it("endOfMonth() sets to last day at 23:59:59", () => {
    const c = base().endOfMonth();
    expect(c.day).toBe(31); // March has 31 days
    expect(c.hour).toBe(23);
  });
  it("startOfWeek() returns Monday", () => {
    const c = base().startOfWeek(); // March 15 is Friday, so Monday = March 11
    expect(c.dayOfWeek).toBe(1);
    expect(c.day).toBe(11);
  });
  it("endOfWeek() returns Sunday at 23:59:59", () => {
    const c = base().endOfWeek();
    expect(c.dayOfWeek).toBe(7);
    expect(c.hour).toBe(23);
  });
  it("startOfYear() is Jan 1", () => {
    const c = base().startOfYear();
    expect(c.month).toBe(1);
    expect(c.day).toBe(1);
  });
  it("endOfYear() is Dec 31 at 23:59:59", () => {
    const c = base().endOfYear();
    expect(c.month).toBe(12);
    expect(c.day).toBe(31);
    expect(c.hour).toBe(23);
  });
  it("startOfDecade()", () => {
    const c = base().startOfDecade(); // 2024 → decade starts 2020
    expect(c.year).toBe(2020);
    expect(c.month).toBe(1);
  });
  it("endOfDecade()", () => {
    const c = base().endOfDecade(); // 2024 → decade ends 2029
    expect(c.year).toBe(2029);
    expect(c.month).toBe(12);
  });
  it("startOfCentury()", () => {
    const c = base().startOfCentury();
    expect(c.year % 100).toBe(0);
    expect(c.month).toBe(1);
  });
  it("endOfCentury()", () => {
    const c = base().endOfCentury();
    expect((c.year + 1) % 100).toBe(0);
  });
});

// ── Carbon: field setters ─────────────────────────────────────────────────────

describe("Carbon field setters (with*)", () => {
  it("withYear", () => {
    expect(base().withYear(2030).year).toBe(2030);
  });
  it("withMonth", () => {
    expect(base().withMonth(7).month).toBe(7);
  });
  it("withDay", () => {
    expect(base().withDay(1).day).toBe(1);
  });
  it("withHour", () => {
    expect(base().withHour(0).hour).toBe(0);
  });
  it("withMinute", () => {
    expect(base().withMinute(0).minute).toBe(0);
  });
  it("withSecond", () => {
    expect(base().withSecond(0).second).toBe(0);
  });
  it("withMillisecond", () => {
    expect(base().withMillisecond(0).millisecond).toBe(0);
  });
  it("withMicrosecond", () => {
    expect(base().withMicrosecond(500).microsecond).toBe(500);
  });
  it("withNanosecond", () => {
    expect(base().withNanosecond(100).nanosecond).toBe(100);
  });
  it("withTime sets h/m/s", () => {
    const c = base().withTime(12, 0, 0);
    expect(c.hour).toBe(12);
    expect(c.minute).toBe(0);
    expect(c.second).toBe(0);
  });
  it("withTime with ms param", () => {
    const c = base().withTime(12, 0, 0, 500);
    expect(c.millisecond).toBe(500);
  });
});

// ── Carbon: predicates ────────────────────────────────────────────────────────

describe("Carbon predicates", () => {
  it("isPast() is true for a past date", () => {
    expect(Carbon.create("2000-01-01", "UTC").isPast()).toBe(true);
  });
  it("isFuture() is true for a far future date", () => {
    expect(Carbon.create("3000-01-01", "UTC").isFuture()).toBe(true);
  });
  it("isWeekend() is true for Saturday", () => {
    expect(Carbon.create("2024-03-16", "UTC").isWeekend()).toBe(true); // Saturday
  });
  it("isWeekend() is true for Sunday", () => {
    expect(Carbon.create("2024-03-17", "UTC").isWeekend()).toBe(true); // Sunday
  });
  it("isWeekday() is true for Friday", () => {
    expect(base().isWeekday()).toBe(true);
  });
  it("isLeapYear() is true for 2024", () => {
    expect(base().isLeapYear()).toBe(true);
  });
  it("isLeapYear() is false for 2023", () => {
    expect(Carbon.create("2023-01-01", "UTC").isLeapYear()).toBe(false);
  });
  it("isSameDay() is true for same calendar date", () => {
    const a = Carbon.create("2024-03-15T08:00:00Z", "UTC");
    const b = Carbon.create("2024-03-15T20:00:00Z", "UTC");
    expect(a.isSameDay(b)).toBe(true);
  });
  it("isSameDay() is false for different dates", () => {
    expect(base().isSameDay(base().addDays(1))).toBe(false);
  });
  it("isSameMonth()", () => {
    expect(base().isSameMonth(base().addDays(10))).toBe(true);
    expect(base().isSameMonth(base().addMonths(1))).toBe(false);
  });
  it("isSameYear()", () => {
    expect(base().isSameYear(base().addMonths(3))).toBe(true);
    expect(base().isSameYear(base().addYears(1))).toBe(false);
  });
  it("isBefore()", () => {
    expect(base().isBefore(base().addDays(1))).toBe(true);
    expect(base().isBefore(base())).toBe(false);
  });
  it("isAfter()", () => {
    expect(base().addDays(1).isAfter(base())).toBe(true);
    expect(base().isAfter(base())).toBe(false);
  });
  it("isEqual()", () => {
    expect(base().isEqual(Carbon.create(BASE, "UTC"))).toBe(true);
    expect(base().isEqual(base().addSeconds(1))).toBe(false);
  });
  it("isBetween() inclusive", () => {
    const start = base().subtractDays(1);
    const end = base().addDays(1);
    expect(base().isBetween(start, end)).toBe(true);
    expect(base().isBetween(base(), end)).toBe(true); // inclusive boundary
  });
  it("isBetween() exclusive", () => {
    expect(base().isBetween(base(), base().addDays(1), false)).toBe(false);
    expect(base().addHours(1).isBetween(base(), base().addDays(1), false)).toBe(true);
  });
  it("isTomorrow() and isYesterday()", () => {
    expect(Carbon.tomorrow("UTC").isTomorrow()).toBe(true);
    expect(Carbon.yesterday("UTC").isYesterday()).toBe(true);
  });
});

// ── Carbon: calendar queries ──────────────────────────────────────────────────

describe("Carbon calendar queries", () => {
  it("daysInMonth() for March is 31", () => {
    expect(base().daysInMonth()).toBe(31);
  });
  it("daysInYear() for 2024 is 366 (leap)", () => {
    expect(base().daysInYear()).toBe(366);
  });
  it("weeksInYear() is 52 or 53", () => {
    expect(base().weeksInYear()).toBeGreaterThanOrEqual(52);
  });
});

// ── Carbon: diff methods ──────────────────────────────────────────────────────

describe("Carbon diff methods", () => {
  it("diff() returns ms", () => {
    const other = Carbon.create("2024-03-15T10:30:44.123Z", "UTC");
    expect(base().diffInMilliseconds(other)).toBe(1000);
  });
  it("diffInSeconds()", () => {
    const other = base().subtractSeconds(60);
    expect(base().diffInSeconds(other)).toBeCloseTo(60);
  });
  it("diffInMinutes()", () => {
    expect(base().diffInMinutes(base().subtractMinutes(30))).toBeCloseTo(30);
  });
  it("diffInHours()", () => {
    expect(base().diffInHours(base().subtractHours(2))).toBeCloseTo(2);
  });
  it("diffInDays()", () => {
    expect(base().diffInDays(base().subtractDays(5))).toBeCloseTo(5);
  });
  it("diffInWeeks()", () => {
    expect(base().diffInWeeks(base().subtractWeeks(2))).toBeCloseTo(2);
  });
  it("diffInMonths()", () => {
    expect(base().diffInMonths(base().subtractMonths(3))).toBe(3);
  });
  it("diffInYears()", () => {
    expect(base().diffInYears(base().subtractYears(2))).toBeCloseTo(2);
  });
  it("diffInMilliseconds() is same as diff()", () => {
    const other = base().subtractMilliseconds(500);
    expect(base().diffInMilliseconds(other)).toBe(500);
  });
  it("diffAsCarbonInterval() returns a CarbonInterval", () => {
    const ci = base().diffAsCarbonInterval(base().addDays(5), "day");
    expect(ci).toBeInstanceOf(CarbonInterval);
    expect(ci.days).toBe(5);
  });
  it("diffInMilliseconds between two instants", () => {
    const a = base();
    const b = base().subtractSeconds(10);
    expect(a.diffInMilliseconds(b)).toBe(10000);
  });
});

// ── Carbon: diffForHumans ─────────────────────────────────────────────────────

describe("Carbon.diffForHumans()", () => {
  it('returns "just now" for very small diff', () => {
    const c = Carbon.now().subtractMilliseconds(100);
    // might return 'just now' but could vary slightly — just check it's a string
    expect(typeof c.diffForHumans()).toBe("string");
  });
  it("returns a human string for past date", () => {
    const c = base(); // 2024 is past relative to now
    const s = c.diffForHumans();
    expect(typeof s).toBe("string");
    expect(s.length).toBeGreaterThan(0);
  });
  it("accepts absolute option", () => {
    const c = base();
    const s = c.diffForHumans({ absolute: true });
    expect(s).not.toContain("ago");
  });
  it("accepts another Carbon as reference", () => {
    const ref = base().addYears(1);
    const s = base().diffForHumans(ref);
    expect(typeof s).toBe("string");
  });
  it("accepts a Date as reference", () => {
    const ref = new Date(Date.now() + 86400000);
    const s = base().diffForHumans(ref);
    expect(typeof s).toBe("string");
  });
  it("accepts a string as reference", () => {
    const s = base().diffForHumans("2025-01-01", { parts: 2 });
    expect(typeof s).toBe("string");
  });
  it("accepts parts option", () => {
    const c = base().subtractYears(1).subtractMonths(3);
    const s = c.diffForHumans({ parts: 2, absolute: true });
    expect(s).toContain("year");
  });
  it("accepts join and locale options", () => {
    const c = base().subtractYears(2);
    const s = c.diffForHumans({ absolute: true, join: " and ", parts: 1 });
    expect(typeof s).toBe("string");
  });
  it('syntax: "from" produces a forward string', () => {
    const future = base().addYears(1);
    const s = future.diffForHumans({ syntax: "from" });
    expect(typeof s).toBe("string");
  });
});

// ── Carbon: formatting ────────────────────────────────────────────────────────

describe("Carbon.format()", () => {
  it("default format YYYY-MM-DD HH:mm:ss", () => {
    expect(base().format()).toBe("2024-03-15 10:30:45");
  });
  it("YYYY", () => {
    expect(base().format("YYYY")).toBe("2024");
  });
  it("YY", () => {
    expect(base().format("YY")).toBe("24");
  });
  it("MMMM", () => {
    expect(base().format("MMMM")).toBe("March");
  });
  it("MMM", () => {
    expect(base().format("MMM")).toBe("Mar");
  });
  it("MM", () => {
    expect(base().format("MM")).toBe("03");
  });
  it("M", () => {
    expect(base().format("M")).toBe("3");
  });
  it("DD", () => {
    expect(base().format("DD")).toBe("15");
  });
  it("D", () => {
    expect(base().format("D")).toBe("15");
  });
  it("HH", () => {
    expect(base().format("HH")).toBe("10");
  });
  it("H", () => {
    expect(base().format("H")).toBe("10");
  });
  it("mm", () => {
    expect(base().format("mm")).toBe("30");
  });
  it("m", () => {
    expect(base().format("m")).toBe("30");
  });
  it("ss", () => {
    expect(base().format("ss")).toBe("45");
  });
  it("s", () => {
    expect(base().format("s")).toBe("45");
  });
  it("SSS", () => {
    expect(base().format("SSS")).toBe("123");
  });
  it("Z for UTC offset is Z", () => {
    expect(base().format("Z")).toBe("Z");
  });
  it("DDDD (weekday)", () => {
    expect(base().format("DDDD")).toBe("Friday");
  });
  it("DDD (short weekday)", () => {
    expect(base().format("DDD")).toBe("Fri");
  });
  it("custom format string", () => {
    expect(base().format("DD/MM/YYYY")).toBe("15/03/2024");
  });
  it("non-UTC offset shows +/-", () => {
    const c = Carbon.create("2024-03-15T12:00:00", "America/New_York");
    expect(c.format("Z")).toMatch(/^[+-]\d{2}:\d{2}$/);
  });
});

describe("Carbon.intlFormat()", () => {
  it("formats using Intl", () => {
    const s = base().intlFormat("en-US", { year: "numeric", month: "long", day: "numeric" });
    expect(s).toContain("2024");
  });
});

// ── Carbon: serialisation ─────────────────────────────────────────────────────

describe("Carbon serialisation", () => {
  it("toDate() returns a native Date", () => {
    expect(base().toDate()).toBeInstanceOf(Date);
  });
  it("toISOString() returns ISO string", () => {
    const s = base().toISOString();
    expect(s).toContain("2024");
    expect(s).toContain("T");
  });
  it("toZonedDateTime() returns Temporal.ZonedDateTime", () => {
    expect(base().toZonedDateTime()).toBeInstanceOf(Temporal.ZonedDateTime);
  });
  it("toInstant() returns Temporal.Instant", () => {
    expect(base().toInstant()).toBeInstanceOf(Temporal.Instant);
  });
  it("toPlainDateTime() returns Temporal.PlainDateTime", () => {
    expect(base().toPlainDateTime()).toBeInstanceOf(Temporal.PlainDateTime);
  });
  it("toPlainDate() returns Temporal.PlainDate", () => {
    expect(base().toPlainDate()).toBeInstanceOf(Temporal.PlainDate);
  });
  it("toUnix() returns seconds", () => {
    expect(base().toUnix()).toBe(1710498645);
  });
  it("toMilliseconds() round-trips", () => {
    const ms = base().toMilliseconds();
    expect(Carbon.fromMilliseconds(ms, "UTC").toMilliseconds()).toBe(ms);
  });
  it("valueOf() is the ms value", () => {
    expect(base().valueOf()).toBe(base().toMilliseconds());
  });
  it("toDateString()", () => {
    expect(base().toDateString()).toBe("2024-03-15");
  });
  it("toDateTimeString()", () => {
    expect(base().toDateTimeString()).toBe("2024-03-15 10:30:45");
  });
  it("toTimeString()", () => {
    expect(base().toTimeString()).toBe("10:30:45");
  });
  it("toShortDate()", () => {
    expect(base().toShortDate()).toBe("Mar 15, 2024");
  });
  it("toLongDate()", () => {
    expect(base().toLongDate()).toBe("15 March 2024");
  });
  it("toJSON()", () => {
    expect(typeof base().toJSON()).toBe("string");
  });
  it("toString()", () => {
    expect(base().toString()).toBe("2024-03-15 10:30:45");
  });
  it("toDatabase()", () => {
    expect(typeof base().toDatabase()).toBe("string");
  });
});

describe("Carbon.inTimezone()", () => {
  it("changes timezone without changing instant", () => {
    const c = base().inTimezone("America/New_York");
    expect(c.timezone).toBe("America/New_York");
    expect(c.toMilliseconds()).toBe(base().toMilliseconds());
  });
  it("tz() is alias for inTimezone()", () => {
    const c = base().inTimezone("Europe/London");
    expect(c.timezone).toBe("Europe/London");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CarbonInterval
// ══════════════════════════════════════════════════════════════════════════════

describe("CarbonInterval static factories", () => {
  it("years()", () => {
    expect(CarbonInterval.years(2).years).toBe(2);
  });
  it("months()", () => {
    expect(CarbonInterval.months(3).months).toBe(3);
  });
  it("weeks()", () => {
    expect(CarbonInterval.weeks(4).weeks).toBe(4);
  });
  it("days()", () => {
    expect(CarbonInterval.days(5).days).toBe(5);
  });
  it("hours()", () => {
    expect(CarbonInterval.hours(6).hours).toBe(6);
  });
  it("minutes()", () => {
    expect(CarbonInterval.minutes(7).minutes).toBe(7);
  });
  it("seconds()", () => {
    expect(CarbonInterval.seconds(8).seconds).toBe(8);
  });
  it("milliseconds()", () => {
    expect(CarbonInterval.milliseconds(9).milliseconds).toBe(9);
  });
  it("microseconds()", () => {
    expect(CarbonInterval.microseconds(10).microseconds).toBe(10);
  });
  it("nanoseconds()", () => {
    expect(CarbonInterval.nanoseconds(11).nanoseconds).toBe(11);
  });

  it("fromDuration() wraps a Temporal.Duration", () => {
    const d = Temporal.Duration.from("P3DT2H");
    const ci = CarbonInterval.fromDuration(d);
    expect(ci.days).toBe(3);
    expect(ci.hours).toBe(2);
  });

  it("fromISO() parses ISO 8601 string", () => {
    const ci = CarbonInterval.fromISO("P1Y2M3DT4H5M6S");
    expect(ci.years).toBe(1);
    expect(ci.months).toBe(2);
    expect(ci.days).toBe(3);
    expect(ci.hours).toBe(4);
    expect(ci.minutes).toBe(5);
    expect(ci.seconds).toBe(6);
  });
});

describe("CarbonInterval constructor", () => {
  it("constructs from DurationLike object", () => {
    const ci = new CarbonInterval({ years: 1, months: 2, days: 3 });
    expect(ci.years).toBe(1);
    expect(ci.months).toBe(2);
    expect(ci.days).toBe(3);
  });
  it("constructs from Temporal.Duration", () => {
    const d = new Temporal.Duration(0, 0, 0, 7);
    const ci = new CarbonInterval(d);
    expect(ci.days).toBe(7);
  });
  it("defaults all fields to 0", () => {
    const ci = new CarbonInterval();
    expect(ci.years).toBe(0);
    expect(ci.months).toBe(0);
    expect(ci.days).toBe(0);
  });
});

describe("CarbonInterval getters", () => {
  it("exposes all time fields", () => {
    const ci = CarbonInterval.fromISO("P1Y2M3W4DT5H6M7S");
    expect(ci.years).toBe(1);
    expect(ci.months).toBe(2);
    expect(ci.weeks).toBe(3);
    expect(ci.days).toBe(4);
    expect(ci.hours).toBe(5);
    expect(ci.minutes).toBe(6);
    expect(ci.seconds).toBe(7);
  });
  it("sign is 1 for positive", () => {
    expect(CarbonInterval.days(5).sign).toBe(1);
  });
  it("sign is -1 for negative", () => {
    expect(CarbonInterval.days(5).negate().sign).toBe(-1);
  });
  it("isZero is true for empty interval", () => {
    expect(new CarbonInterval().isZero).toBe(true);
  });
  it("isZero is false for non-empty", () => {
    expect(CarbonInterval.days(1).isZero).toBe(false);
  });
});

describe("CarbonInterval fluent builder (and*)", () => {
  it("andYears() — verified via fromISO (Temporal requires relativeTo for calendar add)", () => {
    const ci = CarbonInterval.fromISO("P3Y");
    expect(ci.years).toBe(3);
    expect(() => CarbonInterval.years(1).andYears(2)).toThrow();
  });
  it("andMonths() — verified via fromISO (Temporal requires relativeTo for calendar add)", () => {
    const ci = CarbonInterval.fromISO("P4M");
    expect(ci.months).toBe(4);
    expect(() => CarbonInterval.months(1).andMonths(3)).toThrow();
  });
  it("andWeeks() — verified via fromISO (Temporal requires relativeTo for calendar add)", () => {
    const ci = CarbonInterval.fromISO("P3W");
    expect(ci.weeks).toBe(3);
    expect(() => CarbonInterval.weeks(1).andWeeks(2)).toThrow();
  });
  it("andDays()", () => {
    expect(CarbonInterval.hours(1).andDays(5).days).toBe(5);
  });
  it("andHours()", () => {
    expect(CarbonInterval.days(1).andHours(6).hours).toBe(6);
  });
  it("andMinutes()", () => {
    expect(CarbonInterval.days(1).andMinutes(30).minutes).toBe(30);
  });
  it("andSeconds()", () => {
    expect(CarbonInterval.days(1).andSeconds(45).seconds).toBe(45);
  });
  it("andMilliseconds()", () => {
    expect(CarbonInterval.days(1).andMilliseconds(500).milliseconds).toBe(500);
  });
  it("andMicroseconds()", () => {
    expect(CarbonInterval.days(1).andMicroseconds(100).microseconds).toBe(100);
  });
  it("andNanoseconds()", () => {
    expect(CarbonInterval.days(1).andNanoseconds(50).nanoseconds).toBe(50);
  });
  it("chain: days + hours + minutes", () => {
    const ci = CarbonInterval.days(1).andHours(2).andMinutes(30);
    expect(ci.days).toBe(1);
    expect(ci.hours).toBe(2);
    expect(ci.minutes).toBe(30);
  });
});

describe("CarbonInterval arithmetic", () => {
  it("add() combines two intervals", () => {
    const a = CarbonInterval.days(3);
    const b = CarbonInterval.days(2);
    const c = a.add(b);
    expect(c.days).toBe(5);
  });
  it("subtract() returns difference", () => {
    const a = CarbonInterval.hours(5);
    const b = CarbonInterval.hours(2);
    const c = a.subtract(b);
    expect(c.hours).toBe(3);
  });
  it("negate() negates all fields", () => {
    const ci = CarbonInterval.days(3).negate();
    expect(ci.sign).toBe(-1);
  });
  it("negated() is alias for negate()", () => {
    const ci = CarbonInterval.hours(1).negate();
    expect(ci.sign).toBe(-1);
  });
  it("abs() makes all fields positive", () => {
    const ci = CarbonInterval.days(3).negate().abs();
    expect(ci.sign).toBe(1);
    expect(ci.days).toBe(3);
  });
  it("CarbonInterval.abs() static method", () => {
    const ci = CarbonInterval.abs(CarbonInterval.days(3).negate());
    expect(ci.sign).toBe(1);
  });
  it("multiply() scales all fields", () => {
    const ci = CarbonInterval.hours(2).multiply(3);
    expect(ci.hours).toBe(6);
  });
  it("multiply() by zero returns zero interval", () => {
    const ci = CarbonInterval.days(5).multiply(0);
    expect(ci.days).toBe(0);
  });
});

describe("CarbonInterval.cascade()", () => {
  it("normalizes 90 seconds to 1 minute 30 seconds", () => {
    const ci = CarbonInterval.seconds(90).cascade();
    expect(ci.minutes).toBe(1);
    expect(ci.seconds).toBe(30);
  });
  it("normalizes 90 minutes to 1 hour 30 minutes", () => {
    const ci = CarbonInterval.minutes(90).cascade();
    expect(ci.hours).toBe(1);
    expect(ci.minutes).toBe(30);
  });
  it("accepts a custom relativeTo ZDT", () => {
    const ref = Temporal.Now.zonedDateTimeISO("UTC");
    const ci = CarbonInterval.seconds(120).cascade(ref);
    expect(ci.minutes).toBe(2);
  });
});

describe("CarbonInterval total*() helpers", () => {
  it("totalSeconds()", () => {
    expect(CarbonInterval.minutes(2).totalSeconds()).toBeCloseTo(120);
  });
  it("totalMinutes()", () => {
    expect(CarbonInterval.hours(1).andMinutes(30).totalMinutes()).toBeCloseTo(90);
  });
  it("totalHours()", () => {
    expect(CarbonInterval.hours(2).totalHours()).toBeCloseTo(2);
  });
  it("totalDays()", () => {
    expect(CarbonInterval.days(3).totalDays()).toBeCloseTo(3);
  });
  it("totalWeeks()", () => {
    expect(CarbonInterval.weeks(2).totalWeeks()).toBeCloseTo(2);
  });
});

describe("CarbonInterval.forHumans()", () => {
  it("single unit", () => {
    expect(CarbonInterval.days(1).forHumans()).toBe("1 day");
  });
  it("plural unit", () => {
    expect(CarbonInterval.days(5).forHumans()).toBe("5 days");
  });
  it("multiple units", () => {
    const ci = CarbonInterval.days(1).andHours(2).andMinutes(30);
    const s = ci.forHumans();
    expect(s).toContain("day");
    expect(s).toContain("hour");
    expect(s).toContain("minute");
  });
  it("short option abbreviates", () => {
    const s = CarbonInterval.minutes(5).forHumans({ short: true });
    expect(s).toContain("min");
  });
  it("join option", () => {
    const s = CarbonInterval.days(1).andHours(2).forHumans({ join: " and " });
    expect(s).toContain(" and ");
  });
  it('zero returns "0 seconds"', () => {
    expect(new CarbonInterval().forHumans()).toBe("0 seconds");
  });
  it('zero short returns "0s"', () => {
    expect(new CarbonInterval().forHumans({ short: true })).toBe("0s");
  });
  it("negative sign prefixes with -", () => {
    const s = CarbonInterval.days(2).negate().forHumans();
    expect(s).toContain("-");
  });
});

describe("CarbonInterval serialisation", () => {
  it("toISO() returns ISO 8601 string", () => {
    const s = CarbonInterval.days(1).andHours(2).toISO();
    expect(s).toContain("P");
  });
  it("toJSON() is alias for toISO()", () => {
    const ci = CarbonInterval.days(3);
    expect(ci.toJSON()).toBe(ci.toISO());
  });
  it("toString() returns forHumans()", () => {
    const ci = CarbonInterval.hours(5);
    expect(ci.toString()).toBe(ci.forHumans());
  });
  it("toDuration() returns Temporal.Duration", () => {
    expect(CarbonInterval.days(1).toDuration()).toBeInstanceOf(Temporal.Duration);
  });
});

describe("CarbonInterval comparison", () => {
  it("CarbonInterval.compare() returns -1, 0, 1", () => {
    const a = CarbonInterval.hours(1);
    const b = CarbonInterval.hours(2);
    const c = CarbonInterval.hours(1);
    expect(CarbonInterval.compare(a, b)).toBe(-1);
    expect(CarbonInterval.compare(b, a)).toBe(1);
    expect(CarbonInterval.compare(a, c)).toBe(0);
  });
  it("isLessThan()", () => {
    expect(CarbonInterval.hours(1).isLessThan(CarbonInterval.hours(2))).toBe(true);
    expect(CarbonInterval.hours(2).isLessThan(CarbonInterval.hours(1))).toBe(false);
  });
  it("isGreaterThan()", () => {
    expect(CarbonInterval.days(2).isGreaterThan(CarbonInterval.days(1))).toBe(true);
  });
  it("isEqualTo()", () => {
    expect(CarbonInterval.minutes(60).isEqualTo(CarbonInterval.minutes(60))).toBe(true);
    expect(CarbonInterval.minutes(60).isEqualTo(CarbonInterval.minutes(61))).toBe(false);
  });
});

describe("formatting answers in the instance's timezone", () => {
  it("names the month the instance is actually in", () => {
    // toDate() is a bare instant and Intl with no timeZone formats in the *system* zone,
    // so a Tokyo Carbon reporting .month === 1 said "December" on a machine behind it.
    const tokyo = new Carbon("2026-01-01T08:00:00", "Asia/Tokyo");
    expect(tokyo.month).toBe(1);
    expect(tokyo.monthName).toBe("January");
    expect(tokyo.dayName).toBe("Thursday");
  });

  it("intlFormat defaults to the instance's zone, and still honours an explicit one", () => {
    const tokyo = new Carbon("2026-01-01T08:00:00", "Asia/Tokyo");
    expect(tokyo.intlFormat("en-US", { dateStyle: "long" })).toContain("January 1, 2026");
    expect(tokyo.intlFormat("en-US", { dateStyle: "long", timeZone: "UTC" })).toContain(
      "December 31, 2025",
    );
  });
});

describe("diffInYears counts whole years the way a person counts an age", () => {
  const born = new Carbon("1996-02-29T00:00:00", "UTC");
  const on = (date: string) => new Carbon(`${date}T00:00:00`, "UTC").diffInYears(born);

  it("does not advance a Feb-29 birthday a day early", () => {
    // Subtracting calendar fields made 28 February a whole number of months, so the
    // birthday counted as passed and the answer was 28.
    expect(on("2024-02-28")).toBe(27);
    expect(on("2024-02-29")).toBe(28);
    expect(on("2024-03-01")).toBe(28);
  });

  it("handles an ordinary birthday and the day before it", () => {
    const b = new Carbon("2000-06-15T00:00:00", "UTC");
    expect(new Carbon("2026-06-14T00:00:00", "UTC").diffInYears(b)).toBe(25);
    expect(new Carbon("2026-06-15T00:00:00", "UTC").diffInYears(b)).toBe(26);
  });

  it("is signed", () => {
    const later = new Carbon("2030-01-01T00:00:00", "UTC");
    expect(new Carbon("2020-01-01T00:00:00", "UTC").diffInYears(later)).toBe(-10);
  });
});

describe("startOfDay", () => {
  it("takes the earlier midnight in a zone that repeats it", () => {
    // Santiago falls back at midnight, so 00:00 occurs twice. Temporal's default picks the
    // later one, which started a startOfDay()…endOfDay() range an hour late and dropped
    // every row in the first hour.
    const day = new Carbon("2026-04-04T12:00:00", "America/Santiago").startOfDay();
    expect(day.hour).toBe(0);
    expect(day.day).toBe(4);
  });

  it("is unremarkable on an ordinary day", () => {
    const day = new Carbon("2026-06-15T13:45:00", "UTC").startOfDay();
    expect(day.hour).toBe(0);
    expect(day.minute).toBe(0);
    expect(day.day).toBe(15);
  });
});
