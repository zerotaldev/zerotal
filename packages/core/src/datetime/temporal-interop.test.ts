/**
 * Carbon and CarbonInterval take Temporal values from any implementation, not
 * only from the polyfill they are built on. Bun 1.4 and later ship a native
 * `globalThis.Temporal`, and Bun APIs such as `Bun.TOML.parse` hand back its
 * values. Bun 1.3 has no native Temporal, so there a stand-in object that
 * carries the same brand covers the conversion path instead.
 */

import { describe, it, expect } from "bun:test";
import { Carbon } from "./Carbon.ts";
import { CarbonInterval } from "./CarbonInterval.ts";
import { Temporal, adoptTemporal, temporalBrand } from "./temporal-shim.ts";

/** The runtime's own Temporal, typed like the polyfill's. Absent before Bun 1.4. */
const Native = (globalThis as unknown as { Temporal?: typeof Temporal }).Temporal;
const hasNative = Native !== undefined && Native !== Temporal;

/** A value from "another implementation": only the brand and the ISO string. */
function foreign(kind: string, iso: string): object {
  return { [Symbol.toStringTag]: `Temporal.${kind}`, toString: () => iso };
}

describe("adoptTemporal()", () => {
  it("returns a polyfill value as it is", () => {
    const instant = Temporal.Instant.from("2024-03-15T10:30:45Z");
    expect(adoptTemporal(instant)).toBe(instant);
  });

  it("leaves non-Temporal values alone", () => {
    const date = new Date(0);
    expect(adoptTemporal(date)).toBe(date);
    expect(adoptTemporal("2024-03-15")).toBe("2024-03-15");
    expect(adoptTemporal(null)).toBeNull();
  });

  it("leaves Temporal types Carbon does not take alone", () => {
    const time = foreign("PlainTime", "07:32:00");
    expect(adoptTemporal(time)).toBe(time);
  });

  it("converts a branded value from another implementation", () => {
    const adopted = adoptTemporal(foreign("Instant", "2024-03-15T10:30:45.123456789Z"));
    expect(adopted).toBeInstanceOf(Temporal.Instant);
    expect(String(adopted)).toBe("2024-03-15T10:30:45.123456789Z");
  });

  it("reads the brand of polyfill values", () => {
    expect(temporalBrand(Temporal.PlainDate.from("2024-03-15"))).toBe("PlainDate");
    expect(temporalBrand({})).toBeNull();
    expect(temporalBrand("Temporal.Instant")).toBeNull();
  });
});

describe("Carbon with a Temporal value from another implementation", () => {
  it("takes an Instant", () => {
    const c = new Carbon(foreign("Instant", "2024-03-15T10:30:45.123Z") as Temporal.Instant, "UTC");
    expect(c.toISOString()).toBe("2024-03-15T10:30:45.123Z");
  });

  it("takes a ZonedDateTime and keeps its zone", () => {
    const zdt = foreign("ZonedDateTime", "2024-03-15T10:30:00+01:00[Europe/Paris]");
    const c = new Carbon(zdt as Temporal.ZonedDateTime);
    expect(c.timezone).toBe("Europe/Paris");
    expect(c.hour).toBe(10);
  });

  it("rejects a Temporal type with no date or no time of day, by name", () => {
    expect(() => new Carbon(foreign("PlainTime", "07:32:00") as Temporal.Instant)).toThrow(
      "Temporal.PlainTime",
    );
  });

  it("rejects any other object with a TypeError", () => {
    expect(() => new Carbon({} as Temporal.Instant)).toThrow(TypeError);
  });
});

describe.skipIf(!hasNative)("Carbon with native Temporal values (Bun 1.4+)", () => {
  const N = Native as typeof Temporal;

  it("takes Temporal.Now.instant(), the documented call", () => {
    const instant = N.Now.instant();
    const c = new Carbon(instant, "UTC");
    expect(c.toInstant().epochNanoseconds).toBe(BigInt(instant.epochNanoseconds));
  });

  it("takes an Instant", () => {
    const c = new Carbon(N.Instant.from("2024-03-15T10:30:45.123456789Z"), "UTC");
    expect(c.toInstant().toString()).toBe("2024-03-15T10:30:45.123456789Z");
  });

  it("takes a ZonedDateTime and keeps its zone", () => {
    const c = new Carbon(N.ZonedDateTime.from("2024-03-15T10:30:00+01:00[Europe/Paris]"));
    expect(c.timezone).toBe("Europe/Paris");
    expect(c.hour).toBe(10);
    expect(c.toISOString()).toBe("2024-03-15T09:30:00Z");
  });

  it("takes a PlainDateTime in the given zone", () => {
    const c = new Carbon(N.PlainDateTime.from("2024-03-15T10:30:45"), "UTC");
    expect(c.toISOString()).toBe("2024-03-15T10:30:45Z");
  });

  it("takes a PlainDate as midnight", () => {
    const c = new Carbon(N.PlainDate.from("2024-03-15"), "UTC");
    expect(c.toISOString()).toBe("2024-03-15T00:00:00Z");
  });

  it("works through every entry point that takes a CarbonInput", () => {
    const instant = N.Instant.from("2024-03-15T10:30:45Z");
    expect(Carbon.create(instant, "UTC").toISOString()).toBe("2024-03-15T10:30:45Z");
    try {
      Carbon.setTestNow(instant);
      expect(Carbon.now("UTC").toISOString()).toBe("2024-03-15T10:30:45Z");
    } finally {
      Carbon.release();
    }
  });

  it("takes the dates Bun.TOML.parse returns", () => {
    const parsed = Bun.TOML.parse("at = 1979-05-27T07:32:00Z\non = 1979-05-27\n") as {
      at: Temporal.Instant;
      on: Temporal.PlainDate;
    };
    expect(new Carbon(parsed.at, "UTC").toISOString()).toBe("1979-05-27T07:32:00Z");
    expect(new Carbon(parsed.on, "UTC").toISOString()).toBe("1979-05-27T00:00:00Z");
  });
});

describe.skipIf(!hasNative)("CarbonInterval with native Temporal values (Bun 1.4+)", () => {
  const N = Native as typeof Temporal;

  it("wraps a Duration", () => {
    const interval = CarbonInterval.fromDuration(N.Duration.from("P1Y2M3DT4H5M6.007S"));
    expect(interval.toDuration()).toBeInstanceOf(Temporal.Duration);
    expect(interval.toISO()).toBe("P1Y2M3DT4H5M6.007S");
  });

  it("can be added to a Carbon", () => {
    const later = Carbon.create("2024-03-15T00:00:00Z", "UTC").add(
      new CarbonInterval(N.Duration.from("P1DT2H")),
    );
    expect(later.toISOString()).toBe("2024-03-16T02:00:00Z");
  });

  it("cascades relative to a ZonedDateTime", () => {
    const ref = N.ZonedDateTime.from("2024-01-01T00:00:00+00:00[UTC]");
    expect(CarbonInterval.days(31).cascade(ref).toISO()).toBe("P1M");
  });
});

describe("CarbonInterval with a Duration from another implementation", () => {
  it("wraps it", () => {
    const interval = new CarbonInterval(foreign("Duration", "PT90M") as Temporal.Duration);
    expect(interval.toDuration()).toBeInstanceOf(Temporal.Duration);
    expect(interval.minutes).toBe(90);
  });
});
