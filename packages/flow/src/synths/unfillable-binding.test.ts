/**
 * A bound field the model will not accept used to vanish without a word.
 *
 * `_applyWireValues` filters incoming values to the model's `fillable` list, which
 * is correct and must stay: the same path receives whatever a browser chooses to
 * send, so an unknown key must not write a column and must not be able to 500 the
 * page either. What was wrong is that a *developer's* mistake — a typo in a
 * `flow:model`, a field missing from `fillable` — produced exactly the same
 * silence as a hostile payload. The form submits, nothing is written, nothing
 * fails, and there is no clue.
 *
 * This project's own severity key calls that shape the worst kind. So the drop
 * stays and now says so, in development, once per class per field.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { _applyWireValues, _resetUnfillableWarnings } from "./ModelSynth.ts";

/** A model-shaped object: `_applyWireValues` only needs `fillable`, `fill` and a table. */
function modelClass(fillable: string[]) {
  return class Post {
    static table = "posts";
    static fillable = fillable;
    static hidden: string[] = [];
    filled: Record<string, unknown> = {};
    fill(values: Record<string, unknown>): void {
      Object.assign(this.filled, values);
    }
  };
}

const originalEnv = Bun.env["ZT_APP_ENV"];
const originalNode = Bun.env["NODE_ENV"];
let warnings: string[];
let restore: () => void;

beforeEach(() => {
  Bun.env["ZT_APP_ENV"] = "development";
  delete Bun.env["NODE_ENV"];
  warnings = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  restore = () => {
    console.warn = original;
  };
});

afterEach(() => {
  restore();
  if (originalEnv === undefined) delete Bun.env["ZT_APP_ENV"];
  else Bun.env["ZT_APP_ENV"] = originalEnv;
  if (originalNode === undefined) delete Bun.env["NODE_ENV"];
  else Bun.env["NODE_ENV"] = originalNode;
});

describe("a bound field the model will not accept", () => {
  it("is still dropped — the filter is the security property and does not move", () => {
    const Post = modelClass(["title"]);
    _resetUnfillableWarnings(Post);
    const post = new Post();

    _applyWireValues(post, { title: "ok", is_admin: true });

    expect(post.filled).toEqual({ title: "ok" });
    expect(post.filled["is_admin"]).toBeUndefined();
  });

  it("now says so, naming the field and the list it is missing from", () => {
    const Post = modelClass(["title"]);
    _resetUnfillableWarnings(Post);

    _applyWireValues(new Post(), { summary: "hello" });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("`summary`");
    expect(warnings[0]).toContain('fillable is ["title"]');
    expect(warnings[0]).toContain("nothing was written and nothing failed");
  });

  it("offers both readings of the mistake, because either can be the right one", () => {
    const Post = modelClass(["title"]);
    _resetUnfillableWarnings(Post);

    _applyWireValues(new Post(), { summary: "hello" });

    // Add the field, or remove the binding. Which one is right is the developer's
    // call — the warning's job is to make it a call rather than a mystery.
    expect(warnings[0]).toContain("static fillable");
    expect(warnings[0]).toContain("remove the flow:model");
  });

  it("warns once per field, not once per row", () => {
    const Post = modelClass(["title"]);
    _resetUnfillableWarnings(Post);

    for (let i = 0; i < 50; i++) _applyWireValues(new Post(), { summary: "x" });

    expect(warnings).toHaveLength(1);
  });

  it("still reports a second field on the same model", () => {
    const Post = modelClass(["title"]);
    _resetUnfillableWarnings(Post);

    _applyWireValues(new Post(), { summary: "x" });
    _applyWireValues(new Post(), { author_id: 1 });

    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toContain("`author_id`");
  });

  it("names every field dropped in one payload", () => {
    const Post = modelClass(["title"]);
    _resetUnfillableWarnings(Post);

    _applyWireValues(new Post(), { summary: "x", author_id: 1 });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("`summary`");
    expect(warnings[0]).toContain("`author_id`");
  });

  it("says nothing when every field was accepted", () => {
    const Post = modelClass(["title", "body"]);
    _resetUnfillableWarnings(Post);

    _applyWireValues(new Post(), { title: "a", body: "b" });

    expect(warnings).toEqual([]);
  });

  it("explains a model that declares no fillable at all", () => {
    // The ORM's default: no `fillable` means no writes. A bound field on such a
    // model is the most confusing version of this, because *nothing* works.
    const Locked = modelClass([]);
    _resetUnfillableWarnings(Locked);

    _applyWireValues(new Locked(), { title: "a" });

    expect(warnings[0]).toContain("fillable is [empty]");
  });

  it("is silent in production", () => {
    const Post = modelClass(["title"]);
    _resetUnfillableWarnings(Post);
    Bun.env["ZT_APP_ENV"] = "production";

    const post = new Post();
    _applyWireValues(post, { summary: "x" });

    // Nobody is reading this log, and the payload may well be hostile — a warning
    // per request would be the attacker's own amplifier.
    expect(warnings).toEqual([]);
    expect(post.filled).toEqual({});
  });
});
