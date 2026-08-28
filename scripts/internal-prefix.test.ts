/**
 * The detector behind the `_`-prefix ratchet.
 *
 * Its first version reported `action`, `actionGroup` and forty-odd other public
 * helpers as unprefixed internals — a lazy quantifier let an `@internal` docblock
 * several declarations earlier reach forward across intervening code and claim
 * whichever export followed the next comment close. The baseline it produced was
 * 200; the true number is 150. A ratchet built on a miscount is worse than no ratchet: it
 * fails on innocent changes until somebody raises the number to make it stop.
 */
import { describe, it, expect } from "bun:test";
import { unprefixedInternalExports } from "./internal-prefix.ts";

describe("unprefixedInternalExports", () => {
  it("finds an @internal export with no underscore", () => {
    const source = `/** Does a thing. @internal */\nexport function flattenActions() {}\n`;
    expect(unprefixedInternalExports(source)).toEqual(["flattenActions"]);
  });

  it("accepts one that carries the prefix", () => {
    const source = `/** Does a thing. @internal */\nexport function _flattenActions() {}\n`;
    expect(unprefixedInternalExports(source)).toEqual([]);
  });

  it("does not let an earlier docblock claim a later export", () => {
    // The bug this file exists for. Without the `*/`-guard, the @internal block
    // below reaches past `helper` and indicts `publicThing`.
    const source = [
      `/** Internal plumbing. @internal */`,
      `function _helper() {}`,
      ``,
      `/** Start a custom action. */`,
      `export function publicThing() {}`,
    ].join("\n");
    expect(unprefixedInternalExports(source)).toEqual([]);
  });

  it("ignores a file-level @internal on a @module block", () => {
    // A module marked internal wholesale is not every one of its exports being
    // individually at fault.
    const source = `/**\n * Plumbing.\n * @module\n * @internal\n */\nexport function helper() {}\n`;
    expect(unprefixedInternalExports(source)).toEqual([]);
  });

  it("covers const, let and class as well as function", () => {
    const source = [
      `/** @internal */`,
      `export const LIMIT = 1;`,
      `/** @internal */`,
      `export class Thing {}`,
      `/** @internal */`,
      `export async function work() {}`,
    ].join("\n");
    expect(unprefixedInternalExports(source)).toEqual(["LIMIT", "Thing", "work"]);
  });

  it("says nothing about an export with no docblock at all", () => {
    expect(unprefixedInternalExports(`export function plain() {}\n`)).toEqual([]);
  });

  it("does not match @internalSomething", () => {
    const source = `/** @internalised note */\nexport function thing() {}\n`;
    expect(unprefixedInternalExports(source)).toEqual([]);
  });
});
