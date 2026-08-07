import { describe, it, expect } from "bun:test";
import { collect } from "./Collection.ts";

const users = [
  { name: "Alice", score: 90, active: true, role: "admin" },
  { name: "Bob", score: 70, active: false, role: "user" },
  { name: "Carol", score: 85, active: true, role: "user" },
  { name: "Dave", score: 70, active: true, role: "admin" },
];

describe("collect() basics", () => {
  it("toArray() returns original items", () => {
    expect(collect([1, 2, 3]).toArray()).toEqual([1, 2, 3]);
  });
  it("count() returns item count", () => {
    expect(collect(users).count()).toBe(4);
  });
  it("isEmpty() / isNotEmpty()", () => {
    expect(collect([]).isEmpty()).toBe(true);
    expect(collect([1]).isNotEmpty()).toBe(true);
  });
  it("is iterable", () => {
    const result: number[] = [];
    for (const n of collect([1, 2, 3])) result.push(n);
    expect(result).toEqual([1, 2, 3]);
  });
});

describe("collect() — filter / transform", () => {
  it("map() transforms items", () => {
    expect(
      collect([1, 2, 3])
        .map((n) => n * 2)
        .toArray(),
    ).toEqual([2, 4, 6]);
  });
  it("filter() keeps matching items", () => {
    expect(
      collect(users)
        .filter((u) => u.active)
        .count(),
    ).toBe(3);
  });
  it("reject() removes matching items", () => {
    expect(
      collect(users)
        .reject((u) => u.active)
        .count(),
    ).toBe(1);
  });
  it("flatMap() flattens mapped results", () => {
    expect(
      collect([[1, 2], [3]])
        .flatMap((a) => a)
        .toArray(),
    ).toEqual([1, 2, 3]);
  });
  it("reverse() reverses order", () => {
    expect(collect([1, 2, 3]).reverse().toArray()).toEqual([3, 2, 1]);
  });
  it("take() returns first n items", () => {
    expect(collect([1, 2, 3]).take(2).toArray()).toEqual([1, 2]);
  });
  it("skip() drops first n items", () => {
    expect(collect([1, 2, 3]).skip(1).toArray()).toEqual([2, 3]);
  });
});

describe("collect() — where", () => {
  it("where(key, value) filters by equality", () => {
    expect(collect(users).where("role", "admin").count()).toBe(2);
  });
  it("where(key, op, value) filters by operator", () => {
    expect(collect(users).where("score", ">=", 85).count()).toBe(2);
  });
  it("whereIn() keeps listed values", () => {
    expect(collect(users).whereIn("role", ["admin"]).count()).toBe(2);
  });
  it("whereNotIn() excludes listed values", () => {
    expect(collect(users).whereNotIn("role", ["admin"]).count()).toBe(2);
  });
});

describe("collect() — pluck / groupBy / keyBy", () => {
  it("pluck() extracts one key", () => {
    expect(collect(users).pluck("name").toArray()).toEqual(["Alice", "Bob", "Carol", "Dave"]);
  });
  it("groupBy() groups by key", () => {
    const groups = collect(users).groupBy("role");
    expect(groups["admin"]).toHaveLength(2);
    expect(groups["user"]).toHaveLength(2);
  });
  it("groupBy() accepts a function", () => {
    const groups = collect(users).groupBy((u) => (u.score >= 80 ? "high" : "low"));
    expect(groups["high"]).toHaveLength(2);
    expect(groups["low"]).toHaveLength(2);
  });
  it("keyBy() indexes by key", () => {
    const map = collect(users).keyBy("name");
    expect(map["Alice"]?.score).toBe(90);
  });
});

describe("collect() — sort / unique / chunk", () => {
  it("sortBy() sorts ascending", () => {
    expect(collect(users).sortBy("score").first()?.name).toBe("Bob");
  });
  it("sortBy() sorts descending", () => {
    expect(collect(users).sortBy("score", "desc").first()?.name).toBe("Alice");
  });
  it("unique() removes duplicates", () => {
    expect(collect([1, 2, 2, 3]).unique().toArray()).toEqual([1, 2, 3]);
  });
  it("unique(key) removes duplicates by key", () => {
    expect(collect(users).unique("score").count()).toBe(3);
  });
  it("chunk() splits into groups", () => {
    const chunks = collect([1, 2, 3, 4, 5]).chunk(2).toArray();
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual([1, 2]);
  });
});

describe("collect() — aggregates", () => {
  it("sum() adds primitives", () => {
    expect(collect([1, 2, 3]).sum()).toBe(6);
  });
  it("sum(key) adds by key", () => {
    expect(collect(users).sum("score")).toBe(315);
  });
  it("avg(key) computes average", () => {
    expect(collect(users).avg("score")).toBe(315 / 4);
  });
  it("min(key) returns minimum", () => {
    expect(collect(users).min("score")).toBe(70);
  });
  it("max(key) returns maximum", () => {
    expect(collect(users).max("score")).toBe(90);
  });
  it("first() returns first item", () => {
    expect(collect(users).first()?.name).toBe("Alice");
  });
  it("first(fn) returns first matching", () => {
    expect(collect(users).first((u) => u.score < 80)?.name).toBe("Bob");
  });
  it("last() returns last item", () => {
    expect(collect(users).last()?.name).toBe("Dave");
  });
  it("contains() checks for value", () => {
    expect(collect([1, 2, 3]).contains(2)).toBe(true);
    expect(collect([1, 2, 3]).contains(9)).toBe(false);
  });
  it("contains(fn) checks predicate", () => {
    expect(collect(users).contains((u) => u.role === "admin")).toBe(true);
    expect(collect(users).contains((u) => u.role === "superuser")).toBe(false);
  });
});

describe("collect() — output", () => {
  it("toJson() serializes to JSON string", () => {
    expect(JSON.parse(collect([1, 2]).toJson())).toEqual([1, 2]);
  });
  it("each() iterates without transforming", () => {
    const names: string[] = [];
    collect(users).each((u) => names.push(u.name));
    expect(names).toHaveLength(4);
  });
});

// ── Collection.macro() ────────────────────────────────────────────────────────

import { Collection } from "./Collection.ts";

describe("Collection.macro()", () => {
  it("adds a method to all Collection instances", () => {
    Collection.macro("doubled", function (this: Collection<number>) {
      return this.map((n) => n * 2);
    });
    const result = (collect([1, 2, 3]) as unknown as Record<string, unknown>)["doubled"]?.();
    expect(result).toBeInstanceOf(Collection);
    expect((result as Collection<number>).toArray()).toEqual([2, 4, 6]);
  });

  it("macro has access to collection items via public methods", () => {
    Collection.macro("activeUsers", function (this: Collection<{ active: boolean }>) {
      return this.filter((u) => u.active);
    });
    const active = (collect(users) as unknown as Record<string, unknown>)["activeUsers"]?.();
    expect((active as Collection<(typeof users)[0]>).count()).toBe(3);
  });

  it("overwrites a macro when registered again with the same name", () => {
    Collection.macro("testMacro", function (this: Collection<unknown>) {
      return "v1";
    });
    Collection.macro("testMacro", function (this: Collection<unknown>) {
      return "v2";
    });
    const r = (collect([]) as unknown as Record<string, unknown>)["testMacro"]?.();
    expect(r).toBe("v2");
  });

  it("macro is available on instances created after registration", () => {
    Collection.macro("countPlus1", function (this: Collection<unknown>) {
      return this.count() + 1;
    });
    const later = collect([1, 2, 3, 4]);
    expect((later as unknown as Record<string, unknown>)["countPlus1"]?.()).toBe(5);
  });
});
