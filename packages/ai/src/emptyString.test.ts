/**
 * The most expensive pair in either field report, and they are one defect.
 *
 * A prompt asking for structured output naturally says:
 *
 * > A month must be YYYY-MM. Use an empty string when the question names no month.
 *
 * `required` treats `""` as absent, which is right for an HTML form — an empty text
 * input submits `""` and a user who typed nothing supplied nothing. It is wrong for a
 * model, where `""` is the conventional way to say "this field does not apply", and
 * is what the prompt asked for.
 *
 * So the answer was rejected as malformed and the whole feature returned nothing:
 * most questions named no month, the model replied `""` in 3.3 seconds every time,
 * and the page said "either no model is configured, or it was not about your money"
 * while a model was configured and had answered.
 *
 * And it shipped green, because `AiFake` handed back its canned `{ month: "" }`
 * without ever checking it against the schema. Eleven tests passed on a value the
 * live path rejected every time. One half made the mistake; the other made it
 * invisible.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, it, expect } from "bun:test";
import { Application } from "@zerotal/core";
import { RuleBuilder } from "@zerotal/validator";
import { recheckAgainstSchema } from "./schema.ts";
import { AiFake } from "./AiFake.ts";

const rule = new RuleBuilder();

describe("an empty string is an answer, not an absence", () => {
  it("accepts the empty string the prompt asked for", () => {
    expect(
      recheckAgainstSchema<{ month: string }>({ month: rule.string() }, { month: "" }),
    ).toEqual({
      month: "",
    });
  });

  it("still requires the field to be there at all", () => {
    // Absent is not the same as "does not apply". Only the second is an answer.
    expect(() => recheckAgainstSchema({ month: rule.string() }, {})).toThrow(/required/);
  });

  it("still applies the app's own constraints to it", () => {
    // `min(3)` is the app's requirement, not a form convention leaking in.
    expect(() => recheckAgainstSchema({ month: rule.string().min(3) }, { month: "" })).toThrow(
      /at least 3/,
    );
  });

  it("does not relax a non-string field", () => {
    // `""` for a number is a malformed answer, not a convention.
    expect(() => recheckAgainstSchema({ n: rule.number() }, { n: "" })).toThrow();
  });

  it("leaves an ordinary value alone", () => {
    expect(
      recheckAgainstSchema<{ month: string }>({ month: rule.string() }, { month: "2026-08" }),
    ).toEqual({ month: "2026-08" });
  });

  it("does not mutate the caller's schema", () => {
    // The relaxation clones, because a schema object is often module-level and
    // reused — relaxing it in place would silently loosen every later call.
    const schema = { month: rule.string() };
    recheckAgainstSchema(schema, { month: "" });
    expect(() => recheckAgainstSchema(schema, {})).toThrow(/required/);
  });
});

describe("AiFake checks what it is scripted with", () => {
  // `install()` replaces a container binding, so it needs an application — the same
  // setup the rest of the AiFake tests use.
  let ai: AiFake;
  beforeAll(() => Application.create());
  afterAll(() => Application._resetInstance());
  beforeEach(() => {
    ai = AiFake.install();
  });
  afterEach(() => ai.restore());

  it("rejects a canned object the real driver would reject", async () => {
    ai.respondWithObject({ month: "not-a-month", extra: 1 });

    await expect(ai.object("what did I spend", { month: rule.string().min(20) })).rejects.toThrow(
      /does not satisfy the schema/,
    );
  });

  it("says the scripted answer would fail in production, not just that it is invalid", async () => {
    ai.respondWithObject({});

    await expect(ai.object("q", { month: rule.string() })).rejects.toThrow(/in production/);
  });

  it("passes a canned object that does satisfy the schema", async () => {
    ai.respondWithObject({ month: "2026-08" });

    expect(await ai.object<{ month: string }>("q", { month: rule.string() })).toEqual({
      month: "2026-08",
    });
  });

  it("accepts the empty string, exactly as the live path now does", async () => {
    // The two halves agreeing is the whole fix: what the fake accepts is what the
    // driver accepts.
    ai.respondWithObject({ month: "" });

    expect(await ai.object<{ month: string }>("q", { month: rule.string() })).toEqual({
      month: "",
    });
  });

  it("still returns an unchecked object when no schema is given", async () => {
    // Nothing to check against, so nothing to check.
    ai.respondWithObject({ anything: true });

    expect(await ai.object<{ anything: boolean }>("q")).toEqual({ anything: true });
  });

  it("resolves a schema declared as a builder callback", async () => {
    ai.respondWithObject({ month: "2026-08" });

    expect(await ai.object<{ month: string }>("q", (r) => ({ month: r.string() }))).toEqual({
      month: "2026-08",
    });
  });
});
