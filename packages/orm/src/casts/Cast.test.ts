import { describe, it, expect } from "bun:test";
import { BaseModel, columnRegistry } from "@zerotal/orm";
import { Cast, json, objectOf, arrayOf } from "./Cast.ts";
import type { ClassRef } from "../support/classRef.ts";

class Address {
  street = "";
  city = "";
  full() {
    return `${this.street}, ${this.city}`;
  }
}
class Tagged {
  static fromJSON(r: { v: number }) {
    const t = new Tagged();
    t.v = r.v * 2;
    return t;
  }
  v = 0;
}

describe("Cast factories — unit", () => {
  it("json round-trips and is null-safe", () => {
    const j = json();
    expect(JSON.parse(j.set({ a: 1 }) as string)).toEqual({ a: 1 });
    expect(j.get(JSON.stringify({ a: 1 }))).toEqual({ a: 1 });
    expect(j.get(null)).toBeNull();
    expect(j.set(null)).toBeNull();
    expect(j.get({ already: "object" })).toEqual({ already: "object" });
  });
  it("arrayOf returns [] for non-arrays and round-trips", () => {
    expect(arrayOf().get(null)).toEqual([]);
    expect(arrayOf().get(JSON.stringify([1, 2, 3]))).toEqual([1, 2, 3]);
    expect(arrayOf().set([1, 2])).toBe("[1,2]");
  });
  it("hydrates array elements into a class", () => {
    const out = arrayOf(Address).get(JSON.stringify([{ street: "1 A St", city: "NYC" }]));
    expect(out[0]).toBeInstanceOf(Address);
    expect(out[0]!.full()).toBe("1 A St, NYC");
  });
  it("objectOf hydrates a single object; static fromJSON is honored", () => {
    expect(objectOf(Address).get(JSON.stringify({ street: "x", city: "y" }))).toBeInstanceOf(
      Address,
    );
    expect(arrayOf(Tagged).get(JSON.stringify([{ v: 5 }]))[0]!.v).toBe(10);
  });
  it("accepts a plain mapper function", () => {
    expect(
      arrayOf((r: { n: number }) => r.n + 1).get(JSON.stringify([{ n: 1 }, { n: 2 }])),
    ).toEqual([2, 3]);
  });
});

class Factor extends Cast<number> {
  constructor(private readonly factor = 1) {
    super();
  }
  get(db: unknown) {
    return Number(db) * this.factor;
  } // uses `this`
  set(v: number) {
    return v / this.factor;
  }
}
class Widget extends BaseModel {
  static override table = "cast_widgets";
}
columnRegistry.set(
  Widget as unknown as ClassRef,
  new Map<string, any>([
    ["id", { primary: true }],
    ["scaled", { cast: new Factor(3) }],
    ["addresses", { cast: arrayOf(Address) }],
    ["settings", { cast: json() }],
  ]),
);

describe("Cast — model integration (fromRow)", () => {
  it("a Cast class preserves `this` on read", () => {
    const w = Widget.fromRow({ id: 1, scaled: 5 }) as unknown as { scaled: number };
    expect(w.scaled).toBe(15); // 5 * this.factor(3)
  });
  it("arrayOf hydrates a JSON column into class instances", () => {
    const w = Widget.fromRow({
      id: 1,
      addresses: JSON.stringify([{ street: "1 A St", city: "NYC" }]),
    }) as unknown as { addresses: Address[] };
    expect(w.addresses[0]).toBeInstanceOf(Address);
    expect(w.addresses[0]!.full()).toBe("1 A St, NYC");
  });
  it("json cast parses a JSON column", () => {
    const w = Widget.fromRow({ id: 1, settings: JSON.stringify({ theme: "dark" }) }) as unknown as {
      settings: unknown;
    };
    expect(w.settings).toEqual({ theme: "dark" });
  });
});
