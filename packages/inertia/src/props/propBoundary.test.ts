import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { checkPropBoundary, _resetPropBoundaryWarnings } from "./propBoundary.ts";

/** A model that has said nothing about which of its columns are safe to publish. */
class Trip {
  id = 1;
  title = "Kruger, 4 nights";
  cost_cents = 812_00;
  markup_percent = 22;
  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      title: this.title,
      cost_cents: this.cost_cents,
      markup_percent: this.markup_percent,
    };
  }
}

/** The same model, with the dangerous columns declared once at the class. */
class GuardedTrip {
  static hidden = ["cost_cents", "markup_percent"];
  id = 1;
  title = "Kruger, 4 nights";
  toJSON(): Record<string, unknown> {
    return { id: this.id, title: this.title };
  }
}

/** An allow-list rather than a deny-list — equally a declared boundary. */
class ListedTrip {
  static visible = ["id", "title"];
  id = 1;
  toJSON(): Record<string, unknown> {
    return { id: this.id };
  }
}

const originalEnv = process.env["ZT_APP_ENV"];
let findings: string[];

/** Collects warnings and starts every test from a clean slate of reported classes. */
function collect(props: Record<string, unknown>): string[] {
  const out: string[] = [];
  checkPropBoundary(props, (m) => out.push(m));
  return out;
}

beforeEach(() => {
  process.env["ZT_APP_ENV"] = "development";
  _resetPropBoundaryWarnings([Trip, GuardedTrip, ListedTrip]);
  findings = [];
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env["ZT_APP_ENV"];
  else process.env["ZT_APP_ENV"] = originalEnv;
});

describe("checkPropBoundary", () => {
  it("warns about a model that declares neither hidden nor visible", () => {
    findings = collect({ trip: new Trip() });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("`Trip`");
    expect(findings[0]).toContain("`trip` prop");
    expect(findings[0]).toContain("all 4 of its serialised fields");
    expect(findings[0]).toContain("page source");
  });

  it("is silent about a model with a hidden list", () => {
    expect(collect({ trip: new GuardedTrip() })).toEqual([]);
  });

  it("is silent about a model with a visible list", () => {
    expect(collect({ trip: new ListedTrip() })).toEqual([]);
  });

  it("warns once per class, not once per instance", () => {
    findings = collect({ a: new Trip(), b: new Trip(), c: new Trip() });
    expect(findings).toHaveLength(1);
  });

  it("stays quiet on a second page once a class has been reported", () => {
    expect(collect({ trip: new Trip() })).toHaveLength(1);
    expect(collect({ trip: new Trip() })).toHaveLength(0);
  });

  it("finds a model inside an array of them", () => {
    findings = collect({ trips: [new Trip(), new Trip()] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("`trips` prop");
  });

  it("finds a model inside a paginator envelope", () => {
    findings = collect({ trips: { data: [new Trip()], meta: { total: 1 } } });
    expect(findings).toHaveLength(1);
  });

  it("says nothing about plain objects, which are already projections", () => {
    expect(collect({ trip: { id: 1, title: "Kruger" }, total: 4, ok: true })).toEqual([]);
  });

  it("says nothing about null, dates and primitives", () => {
    expect(collect({ a: null, b: 1, c: "x", d: new Date(), e: undefined })).toEqual([]);
  });

  it("terminates on a relation that points back at its parent", () => {
    const trip = new Trip() as Trip & { owner?: unknown };
    const owner = { name: "Desk", trip };
    trip.owner = owner;
    expect(() => collect({ trip })).not.toThrow();
  });

  it("is a no-op outside development", () => {
    process.env["ZT_APP_ENV"] = "production";
    expect(collect({ trip: new Trip() })).toEqual([]);
  });

  it("names the fix in a form that can be pasted", () => {
    findings = collect({ trip: new Trip() });
    expect(findings[0]).toContain("static hidden: Columns<Trip>[]");
    expect(findings[0]).toContain("static visible: Columns<Trip>[]");
  });
});
