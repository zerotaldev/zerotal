import { describe, it, expect } from "bun:test";
import { RuleBuilder } from "@zerotal/validator";
import { recheckAgainstSchema, strippedConstraints, translateSchema } from "./schema.ts";
import { AiSchemaError } from "./errors.ts";
import type { JsonSchema } from "./types.ts";

const rule = new RuleBuilder();

/**
 * The exact JSON Schema each validator schema must produce.
 *
 * A table, because this is where a subtle bug is cheapest to introduce and most
 * expensive to find: the provider rejects an unsupported keyword at *request*
 * time, so a wrong translation surfaces as a 400 on a user's first prompt rather
 * than in any test that only checks "we produced some schema".
 */
const CASES: Array<{ name: string; schema: Record<string, unknown>; expected: JsonSchema }> = [
  {
    name: "a required string",
    schema: { name: rule.string() },
    expected: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "string length bounds are stripped (unsupported by the API)",
    schema: { title: rule.string().min(3).max(80) },
    expected: {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "email becomes a format",
    schema: { email: rule.string().email() },
    expected: {
      type: "object",
      properties: { email: { type: "string", format: "email" } },
      required: ["email"],
      additionalProperties: false,
    },
  },
  {
    name: "url becomes format: uri, not format: url",
    schema: { link: rule.string().url() },
    expected: {
      type: "object",
      properties: { link: { type: "string", format: "uri" } },
      required: ["link"],
      additionalProperties: false,
    },
  },
  {
    name: "in() becomes an enum and drops the type",
    schema: { sentiment: rule.string().in(["positive", "neutral", "negative"]) },
    expected: {
      type: "object",
      properties: { sentiment: { enum: ["positive", "neutral", "negative"] } },
      required: ["sentiment"],
      additionalProperties: false,
    },
  },
  {
    name: "a plain number",
    schema: { score: rule.number() },
    expected: {
      type: "object",
      properties: { score: { type: "number" } },
      required: ["score"],
      additionalProperties: false,
    },
  },
  {
    name: "integer() narrows the JSON Schema type",
    schema: { count: rule.number().integer() },
    expected: {
      type: "object",
      properties: { count: { type: "integer" } },
      required: ["count"],
      additionalProperties: false,
    },
  },
  {
    name: "numeric bounds are stripped",
    schema: { rating: rule.number().min(1).max(5) },
    expected: {
      type: "object",
      properties: { rating: { type: "number" } },
      required: ["rating"],
      additionalProperties: false,
    },
  },
  {
    name: "a boolean",
    schema: { urgent: rule.boolean() },
    expected: {
      type: "object",
      properties: { urgent: { type: "boolean" } },
      required: ["urgent"],
      additionalProperties: false,
    },
  },
  {
    name: "a date becomes a date-time string",
    schema: { due: rule.date() },
    expected: {
      type: "object",
      properties: { due: { type: "string", format: "date-time" } },
      required: ["due"],
      additionalProperties: false,
    },
  },
  {
    name: "an array of strings",
    schema: { tags: rule.array(rule.string()) },
    expected: {
      type: "object",
      properties: { tags: { type: "array", items: { type: "string" } } },
      required: ["tags"],
      additionalProperties: false,
    },
  },
  {
    name: "a nested object carries its own additionalProperties: false",
    schema: { author: rule.object({ name: rule.string(), email: rule.string().email() }) },
    expected: {
      type: "object",
      properties: {
        author: {
          type: "object",
          properties: { name: { type: "string" }, email: { type: "string", format: "email" } },
          required: ["name", "email"],
          additionalProperties: false,
        },
      },
      required: ["author"],
      additionalProperties: false,
    },
  },
  {
    name: "optional widens to anyOf with null, and stays in required",
    schema: { note: rule.string().optional() },
    expected: {
      type: "object",
      properties: { note: { anyOf: [{ type: "string" }, { type: "null" }] } },
      required: ["note"],
      additionalProperties: false,
    },
  },
  {
    name: "nullable widens the same way",
    schema: { note: rule.string().nullable() },
    expected: {
      type: "object",
      properties: { note: { anyOf: [{ type: "string" }, { type: "null" }] } },
      required: ["note"],
      additionalProperties: false,
    },
  },
  {
    name: "uuid() is a regex rule under the hood, so it is stripped",
    schema: { id: rule.string().uuid() },
    expected: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

describe("translateSchema", () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      expect(translateSchema(testCase.schema as never)).toEqual(testCase.expected);
    });
  }

  it("marks every object with additionalProperties: false, at every depth", () => {
    const schema = translateSchema({
      outer: rule.object({ inner: rule.object({ leaf: rule.string() }) }),
    } as never);

    const objects: JsonSchema[] = [];
    (function collect(node: JsonSchema): void {
      if (node.type === "object") objects.push(node);
      for (const child of Object.values(node.properties ?? {})) collect(child);
      if (node.items) collect(node.items);
    })(schema);

    expect(objects.length).toBe(3);
    for (const object of objects) expect(object.additionalProperties).toBe(false);
  });

  it("refuses a recursive schema at definition time rather than at request time", () => {
    const node = rule.object({ label: rule.string() });
    // Tie the shape back to itself — the thing structured output cannot express.
    // Cast because the shape type is now exact: `child` is precisely the key the
    // type system says cannot be there, which is the point of the test.
    (node._def.shape as Record<string, unknown>)["child"] = node._def;

    expect(() => translateSchema({ node } as never)).toThrow(AiSchemaError);
    expect(() => translateSchema({ node } as never)).toThrow(/recursive/);
  });

  it("refuses a file field, which has no JSON representation", () => {
    expect(() => translateSchema({ upload: rule.file() } as never)).toThrow(/file/);
  });

  it("refuses an array with no declared item type", () => {
    const bare = rule.array(rule.string());
    // `children` is required on an ArrayDef, so removing it is only reachable
    // through a cast — which is exactly the malformed state under test.
    delete (bare._def as { children?: unknown }).children;
    expect(() => translateSchema({ tags: bare } as never)).toThrow(/no item type/);
  });
});

describe("strippedConstraints", () => {
  it("names exactly what the provider will not enforce", () => {
    expect(
      strippedConstraints({
        title: rule.string().min(3).max(80),
        email: rule.string().email(),
        count: rule.number().integer(),
        sentiment: rule.string().in(["a", "b"]),
      } as never),
    ).toEqual(["title: min", "title: max"]);
  });

  it("reaches into nested objects", () => {
    expect(
      strippedConstraints({ author: rule.object({ name: rule.string().min(2) }) } as never),
    ).toEqual(["author.name: min"]);
  });
});

describe("recheckAgainstSchema", () => {
  const schema = {
    title: rule.string().min(3),
    score: rule.number().min(1).max(5),
    note: rule.string().optional(),
  };

  it("passes an answer that satisfies the stripped constraints", () => {
    const value = recheckAgainstSchema<{ title: string; score: number }>(schema as never, {
      title: "Fine",
      score: 4,
      note: null,
    });

    expect(value.title).toBe("Fine");
    expect(value.score).toBe(4);
  });

  it("catches what the provider could not enforce", () => {
    expect(() =>
      recheckAgainstSchema(schema as never, { title: "ab", score: 4, note: null }),
    ).toThrow(AiSchemaError);
  });

  it("catches a numeric bound the provider could not enforce", () => {
    expect(() =>
      recheckAgainstSchema(schema as never, { title: "Fine", score: 9, note: null }),
    ).toThrow(/score/);
  });

  it("drops the null that stood in for an absent optional field", () => {
    // The wire form widened `note` to `string | null`; the caller asked for
    // optional, not nullable, so a null must not reach the validator as a value.
    const value = recheckAgainstSchema<{ note?: string }>(schema as never, {
      title: "Fine",
      score: 3,
      note: null,
    });
    expect(value.note).toBeUndefined();
  });

  it("rejects an answer that is not an object at all", () => {
    expect(() => recheckAgainstSchema(schema as never, ["nope"])).toThrow(/an array/);
  });
});
