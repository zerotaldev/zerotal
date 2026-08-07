import { describe, it, expect, beforeAll } from "bun:test";
import { Component } from "./Component.ts";
import { expose, locked, transient } from "./decorators.ts";
import { dehydrate, hydrate, FlowIntegrityError } from "./dehydrate.ts";
import { runStringRules as runValidation } from "@zerotal/validator";
import { ValidationError } from "./validation.ts";
import type { Snapshot } from "./types.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

class CounterPage extends Component {
  @expose count = 0;
  @expose label = "acme";
  @locked secret = "locked-value";
  @transient scratch = "should-not-serialize";
  async render(): Promise<HtmlNode> {
    return null as unknown as HtmlNode;
  }
}

const memo = { id: "c1", name: "CounterPage", path: "/test" };
const make = () => {
  const p = new CounterPage();
  p._flowId = "c1";
  p._flowPath = "/test";
  return p;
};
const clone = (s: Snapshot): Snapshot => JSON.parse(JSON.stringify(s));

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

describe("Flow snapshot — what crosses the wire", () => {
  it("serializes @expose and @locked props but not @transient", () => {
    const snap = dehydrate(make(), memo);
    expect(Object.keys(snap.data).sort()).toEqual(["count", "label", "secret"]);
    expect("scratch" in snap.data).toBe(false);
  });

  it("marks @locked props so the client refuses writes", () => {
    const snap = dehydrate(make(), memo);
    expect(snap.data["secret"]![1]["locked"]).toBe(true);
    expect(snap.data["count"]![1]["locked"]).toBeUndefined();
  });

  it("produces a hex HMAC checksum", () => {
    const snap = dehydrate(make(), memo);
    expect(snap.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Flow snapshot — HMAC integrity (tamper protection)", () => {
  it("round-trips an untampered snapshot", async () => {
    const page = make();
    page.count = 7;
    page.label = "globex";
    const snap = dehydrate(page, memo);
    const restored = await hydrate(snap, CounterPage);
    expect(restored.count).toBe(7);
    expect(restored.label).toBe("globex");
  });

  it("rejects a snapshot whose data was tampered with", async () => {
    const snap = clone(dehydrate(make(), memo));
    snap.data["count"]![0] = 9999; // attacker bumps the value, keeps old checksum
    await expect(hydrate(snap, CounterPage)).rejects.toBeInstanceOf(FlowIntegrityError);
  });

  it("rejects a forged checksum", async () => {
    const snap = clone(dehydrate(make(), memo));
    snap.checksum = "f".repeat(64);
    await expect(hydrate(snap, CounterPage)).rejects.toBeInstanceOf(FlowIntegrityError);
  });

  it("rejects a snapshot signed with a different APP_KEY", async () => {
    const snap = dehydrate(make(), memo); // signed with the original key
    const prev = Bun.env.APP_KEY;
    Bun.env.APP_KEY = "a-totally-different-key-bbbbbbbbbbbb";
    try {
      await expect(hydrate(snap, CounterPage)).rejects.toBeInstanceOf(FlowIntegrityError);
    } finally {
      Bun.env.APP_KEY = prev;
    }
  });

  it("refuses to sign when APP_KEY is unset", () => {
    const prev = Bun.env.APP_KEY;
    delete Bun.env.APP_KEY;
    try {
      expect(() => dehydrate(make(), memo)).toThrow(/APP_KEY/);
    } finally {
      Bun.env.APP_KEY = prev;
    }
  });

  it("FlowIntegrityError carries the E_PULSE_INTEGRITY code and 400 status", () => {
    const err = new FlowIntegrityError();
    expect(err.code).toBe("E_PULSE_INTEGRITY");
    expect(err.status).toBe(400);
  });
});

describe("runValidation", () => {
  it("flags required fields that are empty or missing", () => {
    const e = runValidation({ name: "" }, { name: "required", email: "required" });
    expect(e["name"]).toBeDefined();
    expect(e["email"]).toBeDefined();
  });

  it("passes when required fields are present", () => {
    expect(runValidation({ name: "x" }, { name: "required" })).toEqual({});
  });

  it("enforces min/max on strings and numbers", () => {
    expect(runValidation({ p: "ab" }, { p: "min:3" })["p"]).toBeDefined();
    expect(runValidation({ p: "abcd" }, { p: "max:3" })["p"]).toBeDefined();
    expect(runValidation({ n: 2 }, { n: "min:5" })["n"]).toBeDefined();
    expect(runValidation({ n: 8 }, { n: "min:5|max:10" })).toEqual({});
  });

  it("validates email and in: rules", () => {
    expect(runValidation({ e: "nope" }, { e: "email" })["e"]).toBeDefined();
    expect(runValidation({ e: "a@b.co" }, { e: "email" })).toEqual({});
    expect(runValidation({ r: "pink" }, { r: "in:red,blue" })["r"]).toBeDefined();
  });

  it("supports confirmed and same", () => {
    expect(
      runValidation({ pw: "x", pw_confirmation: "y" }, { pw: "confirmed" })["pw"],
    ).toBeDefined();
    expect(runValidation({ pw: "x", pw_confirmation: "x" }, { pw: "confirmed" })).toEqual({});
    expect(runValidation({ a: 1, b: 2 }, { a: "same:b" })["a"]).toBeDefined();
  });

  it("skips with nullable (empty) and sometimes (absent)", () => {
    expect(runValidation({ bio: "" }, { bio: "nullable|min:5" })).toEqual({});
    expect(runValidation({}, { nick: "sometimes|min:5" })).toEqual({});
  });

  it("ignores unknown rules instead of throwing", () => {
    expect(runValidation({ x: "v" }, { x: "no_such_rule" })).toEqual({});
  });

  it("ValidationError carries errors, code and status", () => {
    const err = new ValidationError({ name: ["required"] });
    expect(err.errors["name"]).toEqual(["required"]);
    expect(err.code).toBe("E_VALIDATION");
    expect(err.status).toBe(422);
  });
});
