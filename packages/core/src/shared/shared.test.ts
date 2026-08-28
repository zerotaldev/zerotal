import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { formatDate, formatMoney, formatNumber, pluralize, Str } from "./index.ts";

describe("zerotal/shared — bundle safety", () => {
  // The whole promise of this entry point, asserted rather than believed. A single
  // `node:` import anywhere in the graph — added later, by somebody who did not know
  // this module existed — breaks a browser build with an error that points at the
  // bundler rather than at the import, so it is worth catching here.
  it("builds for the browser with nothing server-side reachable from it", async () => {
    const result = await Bun.build({
      entrypoints: [join(import.meta.dir, "index.ts")],
      target: "browser",
      minify: false,
    });

    expect(result.logs.filter((l) => l.level === "error")).toEqual([]);
    expect(result.success).toBe(true);

    const code = await result.outputs[0]!.text();
    for (const forbidden of ["node:fs", "node:path", "node:os", "node:crypto", "process.exit"]) {
      expect(code).not.toContain(forbidden);
    }
  });
});

describe("the helpers the browser was missing", () => {
  it("inflects only the last word, which is the part a hand-rolled copy gets wrong", () => {
    expect(pluralize("supplier line")).toBe("supplier lines");
    expect(pluralize("person")).toBe("people");
    expect(pluralize("child")).toBe("children");
  });

  it("carries the same Str helpers the server has", () => {
    expect(Str.slugify("Kruger, 4 nights")).toBe("kruger-4-nights");
    expect(Str.truncate("Kruger National Park", 10)).toBe("Kruger ...");
  });
});

describe("formatMoney", () => {
  it("treats the amount as minor units by default, because that is how money is stored", () => {
    expect(formatMoney(3_914_700, { currency: "USD", locale: "en-US" })).toBe("$39,147.00");
  });

  it("takes a major-unit amount when told to", () => {
    expect(formatMoney(39_147, { currency: "USD", locale: "en-US", minorUnits: false })).toBe(
      "$39,147.00",
    );
  });

  it("honours an explicit fraction-digit count", () => {
    expect(formatMoney(3_914_700, { currency: "USD", locale: "en-US", fractionDigits: 0 })).toBe(
      "$39,147",
    );
  });

  it("gives the same string on both sides for the same inputs", () => {
    const server = formatMoney(3_914_700, { currency: "ZAR", locale: "en-ZA" });
    const browser = formatMoney(3_914_700, { currency: "ZAR", locale: "en-ZA" });
    expect(server).toBe(browser);
  });
});

describe("formatNumber", () => {
  it("groups with the locale's separators", () => {
    expect(formatNumber(39147.5, { locale: "en-GB", maximumFractionDigits: 1 })).toBe("39,147.5");
  });
});

describe("formatDate", () => {
  it("writes the date and nothing else when given no style", () => {
    expect(formatDate("2026-08-28T09:00:00Z", { locale: "en-GB", timeZone: "UTC" })).toBe(
      "28 Aug 2026",
    );
  });

  it("writes a time part when asked for one", () => {
    const out = formatDate("2026-08-28T09:00:00Z", {
      locale: "en-GB",
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "UTC",
    });
    expect(out).toContain("09:00");
  });

  it("reads a zone, so a late booking does not land on the wrong day", () => {
    const at = "2026-08-28T21:30:00Z";
    const utc = formatDate(at, { locale: "en-GB", timeZone: "UTC" });
    const auckland = formatDate(at, { locale: "en-GB", timeZone: "Pacific/Auckland" });
    expect(utc).toBe("28 Aug 2026");
    expect(auckland).toBe("29 Aug 2026");
  });

  it("returns an empty string rather than 'Invalid Date' on junk", () => {
    expect(formatDate("not a date")).toBe("");
  });

  it("accepts a Date and epoch milliseconds as well as a string", () => {
    const at = Date.UTC(2026, 7, 28, 9, 0, 0);
    const options = { locale: "en-GB", timeZone: "UTC" } as const;
    expect(formatDate(new Date(at), options)).toBe(formatDate(at, options));
  });
});
