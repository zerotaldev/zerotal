/**
 * Carbon runs on the runtime's own `Temporal` where there is one (Bun 1.4 and
 * later) and on `@js-temporal/polyfill` where there is not (Bun 1.3), and it
 * takes Temporal values from either implementation. Bun APIs such as
 * `Bun.TOML.parse` hand back native values; an app may still import the
 * polyfill itself. A stand-in object that carries only the brand covers the
 * conversion path on every runtime.
 */

import { describe, it, expect } from "bun:test";
import { Temporal as Polyfill } from "@js-temporal/polyfill";
import { Carbon } from "./Carbon.ts";
import { CarbonInterval } from "./CarbonInterval.ts";
import { type Temporal, temporal, adoptTemporal, temporalBrand } from "./temporal-shim.ts";

/** The runtime's own Temporal, typed like the polyfill's. Absent before Bun 1.4. */
const Native = (globalThis as { Temporal?: typeof Temporal }).Temporal;
const hasNative = Native !== undefined;

/** The Temporal Carbon runs on. */
const Own = temporal();

/** A value from "another implementation": only the brand and the ISO string. */
function foreign(kind: string, iso: string): object {
  return { [Symbol.toStringTag]: `Temporal.${kind}`, toString: () => iso };
}

/**
 * Run `source` in a fresh Bun process, optionally with the global `Temporal`
 * removed first, and return what it printed. The probe reports which
 * `@js-temporal/polyfill` files the process has loaded, read from `require.cache`.
 */
async function probe(source: string, dropNative: boolean): Promise<string> {
  const carbon = JSON.stringify(`${import.meta.dir}/index.ts`);
  const script = [
    dropNative ? "delete globalThis.Temporal;" : "",
    'const polyfillLoaded = () => Object.keys(require.cache).some((k) => k.includes("js-temporal"));',
    `const { Carbon, CarbonInterval } = await import(${carbon});`,
    source,
  ].join("\n");
  const proc = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`probe exited ${code}: ${err}`);
  return out.trim();
}

describe("temporal()", () => {
  it("is the runtime's own Temporal when there is one, and the polyfill otherwise", () => {
    if (hasNative) expect(Own).toBe(Native as typeof Temporal);
    else expect(temporalBrand(Own.Now.instant())).toBe("Instant");
  });

  it("returns the same namespace every time", () => {
    expect(temporal()).toBe(Own);
  });

  it("does not load the polyfill when Carbon is imported", async () => {
    expect(await probe("console.log(polyfillLoaded());", true)).toBe("false");
  });

  it("loads the polyfill on first use when there is no native Temporal", async () => {
    const out = await probe(
      'console.log(Carbon.create("2024-03-15T10:30:45Z", "UTC").addDays(1).toISOString(), polyfillLoaded());',
      true,
    );
    expect(out).toBe("2024-03-16T10:30:45Z true");
  });

  it.skipIf(!hasNative)("never loads the polyfill when the runtime has Temporal", async () => {
    const out = await probe(
      [
        'const c = Carbon.create("2024-03-15T10:30:45Z", "UTC").addMonths(1);',
        "const d = CarbonInterval.fromISO('P1DT2H').totalHours();",
        "const native = c.toInstant() instanceof globalThis.Temporal.Instant;",
        "console.log(c.toISOString(), d, native, polyfillLoaded());",
      ].join("\n"),
      false,
    );
    expect(out).toBe("2024-04-15T10:30:45Z 26 true false");
  });

  it("is the app's own import of the polyfill when there is no native Temporal", async () => {
    const out = await probe(
      [
        'const { Temporal: P } = await import("@js-temporal/polyfill");',
        'const c = Carbon.create("2024-03-15T10:30:45Z", "Europe/Paris");',
        "const own = c.toInstant() instanceof P.Instant && c.toZonedDateTime() instanceof P.ZonedDateTime;",
        'const cmp = P.ZonedDateTime.compare(c.toZonedDateTime(), P.ZonedDateTime.from("2024-01-01T00:00:00+01:00[Europe/Paris]"));',
        'const files = Object.keys(require.cache).filter((k) => k.includes("js-temporal")).length;',
        "console.log(own, cmp, files);",
      ].join("\n"),
      true,
    );
    expect(out).toBe("true 1 1");
  });
});

describe("the Temporal an app picks to match Carbon's", () => {
  /** The pattern docs/carbon.md gives an app that runs on Bun 1.3 and 1.4. */
  const AppTemporal = Native ?? Polyfill;

  it("is the one Carbon runs on", () => {
    expect(AppTemporal).toBe(Own);
  });

  it("takes the ZonedDateTime values Carbon hands back", () => {
    const c = Carbon.create("2024-03-15T10:30:45Z", "Europe/Paris");
    const zdt = AppTemporal.ZonedDateTime.from("2024-01-01T00:00:00+01:00[Europe/Paris]");
    expect(c.toZonedDateTime()).toBeInstanceOf(AppTemporal.ZonedDateTime);
    expect(AppTemporal.ZonedDateTime.compare(c.toZonedDateTime(), zdt)).toBe(1);
    expect(zdt.until(c.toZonedDateTime()).toString()).toBe("PT1787H30M45S");
    expect(c.toInstant()).toBeInstanceOf(AppTemporal.Instant);
  });
});

describe("adoptTemporal()", () => {
  it("returns a value of Carbon's own Temporal as it is", () => {
    const instant = Own.Instant.from("2024-03-15T10:30:45Z");
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
    expect(adopted).toBeInstanceOf(Own.Instant);
    expect(String(adopted)).toBe("2024-03-15T10:30:45.123456789Z");
  });

  it("reads the brand of values from either implementation", () => {
    expect(temporalBrand(Own.PlainDate.from("2024-03-15"))).toBe("PlainDate");
    expect(temporalBrand(Polyfill.PlainDate.from("2024-03-15"))).toBe("PlainDate");
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

describe("Carbon with values from an app's own copy of the polyfill", () => {
  it("takes an Instant to the nanosecond", () => {
    const c = new Carbon(Polyfill.Instant.from("2024-03-15T10:30:45.123456789Z"), "UTC");
    expect(c.toInstant().toString()).toBe("2024-03-15T10:30:45.123456789Z");
    expect(c.toInstant()).toBeInstanceOf(Own.Instant);
  });

  it("takes a ZonedDateTime and keeps its zone", () => {
    const c = new Carbon(Polyfill.ZonedDateTime.from("2024-03-15T10:30:00+01:00[Europe/Paris]"));
    expect(c.timezone).toBe("Europe/Paris");
    expect(c.toISOString()).toBe("2024-03-15T09:30:00Z");
  });

  it("takes a PlainDate as midnight", () => {
    expect(new Carbon(Polyfill.PlainDate.from("2024-03-15"), "UTC").toISOString()).toBe(
      "2024-03-15T00:00:00Z",
    );
  });

  it("takes a Duration in a CarbonInterval", () => {
    const interval = CarbonInterval.fromDuration(Polyfill.Duration.from("P1DT2H"));
    expect(interval.toDuration()).toBeInstanceOf(Own.Duration);
    expect(Carbon.create("2024-03-15T00:00:00Z", "UTC").add(interval).toISOString()).toBe(
      "2024-03-16T02:00:00Z",
    );
  });
});

describe.skipIf(!hasNative)("Carbon with native Temporal values (Bun 1.4+)", () => {
  const N = Native as typeof Temporal;

  it("hands back native values", () => {
    const c = Carbon.create("2024-03-15T10:30:45Z", "UTC");
    expect(c.toZonedDateTime()).toBeInstanceOf(N.ZonedDateTime);
    expect(c.toInstant()).toBeInstanceOf(N.Instant);
    expect(c.toPlainDate()).toBeInstanceOf(N.PlainDate);
    expect(CarbonInterval.days(1).toDuration()).toBeInstanceOf(N.Duration);
  });

  it("takes Temporal.Now.instant(), the documented call, without converting it", () => {
    const instant = N.Now.instant();
    expect(adoptTemporal(instant)).toBe(instant);
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
    expect(interval.toDuration()).toBeInstanceOf(Own.Duration);
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
    expect(interval.toDuration()).toBeInstanceOf(Own.Duration);
    expect(interval.minutes).toBe(90);
  });
});
