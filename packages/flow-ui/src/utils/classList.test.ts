// `classList` replaced the `clsx` dependency in 1.16.3. These cases pin it to clsx 2.1.1's
// output, both as recorded strings and, while clsx stays a devDependency, against the
// package itself, so a drift in either direction shows up here.

import { describe, it, expect } from "bun:test";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { classList, cn, type ClassValue } from "./cn.ts";

class WithProto {
  own = true;
}
(WithProto.prototype as unknown as Record<string, unknown>).inherited = true;
const sparse: ClassValue[] = ["a"];
sparse[3] = "d";
// Read from somewhere the linter cannot see through, as a real condition would be.
const [off, on] = [process.env.NONEXISTENT_FLAG === "1", process.env.NONEXISTENT_FLAG !== "1"];

const CASES: [label: string, inputs: ClassValue[], expected: string][] = [
  ["no input", [], ""],
  ["one string", ["px-4"], "px-4"],
  ["several strings", ["px-4", "py-2"], "px-4 py-2"],
  ["strings are not trimmed or split", ["  a  b ", "c"], "  a  b  c"],
  ["empty strings are dropped", ["", "a", ""], "a"],
  ["false, null, undefined are dropped", [false, null, undefined, "a"], "a"],
  ["true is dropped", [true, "a"], "a"],
  ["0 is dropped", [0, "a"], "a"],
  ["other numbers are kept", [1, 2.5, -3], "1 2.5 -3"],
  ["NaN is dropped", [NaN, "a"], "a"],
  ["bigints are dropped, even non-zero", [0n, 1n, "a"], "a"],
  ["condition && class", [off && "x", on && "y"], "y"],
  ["flat array", [["a", "b"]], "a b"],
  ["nested arrays", [["a", ["b", ["c", [false, "d"]]]]], "a b c d"],
  ["empty arrays leave no gap", [[], "a", [[]], "b"], "a b"],
  ["array of falsy values", [[false, null, 0, ""]], ""],
  ["object keys with truthy values", [{ a: true, b: false, c: 1, d: 0, e: "x", f: "" }], "a c e"],
  ["object key with null/undefined", [{ a: null, b: undefined, c: [] }], "c"],
  ["objects inside arrays", [["a", { b: true, c: false }]], "a b"],
  ["arrays inside objects are just truthy values", [{ "a b": ["x"] }], "a b"],
  ["empty object", [{}], ""],
  ["inherited enumerable keys count", [new WithProto()], "own inherited"],
  ["sparse array holes", [sparse], "a d"],
  ["mixed", ["base", 0, ["x", { y: true, z: null }], undefined, { w: 1 }, 7], "base x y w 7"],
];

describe("classList() matches clsx 2.1.1", () => {
  for (const [label, inputs, expected] of CASES) {
    it(label, () => {
      expect(classList(...inputs)).toBe(expected);
      expect(clsx(...inputs)).toBe(expected);
    });
  }

  it("ignores functions and symbols the way clsx does", () => {
    const odd = [() => "f", Symbol("s"), "a"] as unknown as ClassValue[];
    expect(classList(...odd)).toBe(clsx(...odd));
    expect(classList(...odd)).toBe("a");
  });
});

describe("cn() matches the old twMerge(clsx(...))", () => {
  for (const [label, inputs] of CASES) {
    it(label, () => {
      expect(cn(...inputs)).toBe(twMerge(clsx(inputs)));
    });
  }

  it("still lets a later conflicting utility win", () => {
    const inputs: ClassValue[] = ["px-2 py-2 bg-primary", { "bg-red-500": true }, ["px-4"]];
    expect(cn(...inputs)).toBe(twMerge(clsx(inputs)));
    expect(cn(...inputs)).toBe("py-2 bg-red-500 px-4");
  });
});
