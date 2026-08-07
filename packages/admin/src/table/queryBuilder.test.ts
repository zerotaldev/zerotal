import { describe, it, expect } from "bun:test";
import { queryBuilder, parseRuleTree, ruleTreeIsEmpty } from "./Filter.ts";
import type { QueryRule } from "./Filter.ts";
import {
  textConstraint,
  numberConstraint,
  booleanConstraint,
  selectConstraint,
} from "./Constraint.ts";
import type { AdminQuery } from "../Resource.ts";

/**
 * A query double that records the calls a rule tree makes, including the shape
 * of nested groups — which is the part that matters, since a group that fails to
 * nest lets an `OR` escape its scope.
 */
type Call = string;

function fakeQuery(sink: Call[]): AdminQuery {
  const q: Record<string, unknown> = {};
  const record =
    (name: string) =>
    (...args: unknown[]): AdminQuery => {
      if (typeof args[0] === "function") {
        sink.push(`${name}(`);
        (args[0] as (sub: AdminQuery) => void)(q as AdminQuery);
        sink.push(")");
      } else {
        sink.push(`${name}(${args.map((a) => JSON.stringify(a)).join(",")})`);
      }
      return q as AdminQuery;
    };

  for (const name of [
    "where",
    "orWhere",
    "whereLike",
    "orWhereLike",
    "whereNotLike",
    "orWhereNotLike",
    "whereNull",
    "orWhereNull",
    "whereNotNull",
    "orWhereNotNull",
  ]) {
    q[name] = record(name);
  }
  return q as AdminQuery;
}

const filter = (): ReturnType<typeof queryBuilder> =>
  queryBuilder("q").constraints([
    textConstraint("title"),
    numberConstraint("total"),
    booleanConstraint("featured"),
    selectConstraint("status").options({ open: "Open", closed: "Closed" }),
  ]);

const apply = (tree: QueryRule): Call[] => {
  const calls: Call[] = [];
  filter().apply(fakeQuery(calls), JSON.stringify(tree));
  return calls;
};

describe("rule tree parsing", () => {
  it("rejects malformed JSON rather than throwing", () => {
    expect(parseRuleTree("not json")).toBeNull();
    expect(parseRuleTree("")).toBeNull();
    expect(parseRuleTree('{"type":"nonsense"}')).toBeNull();
  });

  it("treats an empty group as no filter at all", () => {
    expect(ruleTreeIsEmpty(null)).toBe(true);
    expect(ruleTreeIsEmpty({ type: "group", operator: "and", rules: [] })).toBe(true);
    expect(
      ruleTreeIsEmpty({
        type: "group",
        operator: "and",
        rules: [{ type: "group", operator: "or", rules: [] }],
      }),
    ).toBe(true);
    expect(
      ruleTreeIsEmpty({ type: "rule", constraint: "title", operator: "contains", value: "x" }),
    ).toBe(false);
  });
});

describe("applying a rule tree", () => {
  it("wraps the whole tree in one group so an OR can't escape the page's scope", () => {
    const calls = apply({
      type: "group",
      operator: "or",
      rules: [
        { type: "rule", constraint: "title", operator: "contains", value: "a" },
        { type: "rule", constraint: "title", operator: "contains", value: "b" },
      ],
    });

    expect(calls[0]).toBe("where(");
    expect(calls[calls.length - 1]).toBe(")");
    // First rule ANDs (nothing precedes it); the second is the alternative.
    expect(calls.slice(1, -1)).toEqual(['whereLike("title","%a%")', 'orWhereLike("title","%b%")']);
  });

  it("maps each text operator to its predicate", () => {
    const one = (operator: string, value = "x"): string =>
      apply({ type: "rule", constraint: "title", operator, value })[1]!;

    expect(one("contains")).toBe('whereLike("title","%x%")');
    expect(one("not_contains")).toBe('whereNotLike("title","%x%")');
    expect(one("starts_with")).toBe('whereLike("title","x%")');
    expect(one("ends_with")).toBe('whereLike("title","%x")');
    expect(one("equals")).toBe('where("title","=","x")');
    expect(one("not_equals")).toBe('where("title","!=","x")');
  });

  it("casts numeric values so a comparison isn't done on strings", () => {
    const calls = apply({ type: "rule", constraint: "total", operator: "gt", value: "100" });
    expect(calls[1]).toBe('where("total",">",100)');
  });

  it("applies unary operators without a value", () => {
    expect(apply({ type: "rule", constraint: "title", operator: "is_empty" })[1]).toBe(
      'whereNull("title")',
    );
    expect(apply({ type: "rule", constraint: "featured", operator: "is_true" })[1]).toBe(
      'where("featured","=",true)',
    );
    expect(apply({ type: "rule", constraint: "featured", operator: "is_false" })[1]).toBe(
      'where("featured","=",false)',
    );
  });

  it("nests a subgroup rather than flattening it", () => {
    const calls = apply({
      type: "group",
      operator: "and",
      rules: [
        { type: "rule", constraint: "status", operator: "equals", value: "open" },
        {
          type: "group",
          operator: "or",
          rules: [
            { type: "rule", constraint: "total", operator: "gt", value: "100" },
            { type: "rule", constraint: "title", operator: "contains", value: "acme" },
          ],
        },
      ],
    });

    expect(calls).toEqual([
      "where(",
      'where("status","=","open")',
      "where(",
      'where("total",">",100)',
      'orWhereLike("title","%acme%")',
      ")",
      ")",
    ]);
  });

  it("joins a nested group with OR when the parent group says so", () => {
    const calls = apply({
      type: "group",
      operator: "or",
      rules: [
        { type: "rule", constraint: "status", operator: "equals", value: "open" },
        {
          type: "group",
          operator: "and",
          rules: [{ type: "rule", constraint: "total", operator: "lt", value: "10" }],
        },
      ],
    });

    expect(calls).toEqual([
      "where(",
      'where("status","=","open")',
      "orWhere(",
      'where("total","<",10)',
      ")",
      ")",
    ]);
  });

  it("drops a rule naming a constraint the resource never offered", () => {
    // A hand-edited URL must not become an arbitrary-column filter.
    const calls = apply({
      type: "rule",
      constraint: "password_hash",
      operator: "contains",
      value: "$",
    });
    expect(calls).toEqual([]);
  });

  it("drops a value-taking rule that has no value yet", () => {
    // Half-built rows in the UI shouldn't narrow the table.
    const calls = apply({ type: "rule", constraint: "title", operator: "contains", value: "" });
    expect(calls).toEqual([]);
  });

  it("leaves the query untouched when the tree is empty", () => {
    expect(apply({ type: "group", operator: "and", rules: [] })).toEqual([]);
  });
});
