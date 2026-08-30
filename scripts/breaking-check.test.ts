/**
 * The exemption that keeps the gate usable, and must not make it useless.
 *
 * Declaring every public option shape's optional properties as `?: T | undefined`
 * moved 438 lines of recorded surface at once. Every one of them reads in a diff as
 * a removal plus an addition, and none of them breaks a caller: a reader already got
 * `T | undefined`, and a writer can now do more, not less. Reported as removals they
 * would have buried whatever real removal shipped alongside them, which is exactly
 * how this gate stops working — a list of 679 findings is a list nobody reads.
 *
 * So the risk runs the other way, and these are mostly about the other way: a
 * *narrowing* still has to be reported, and so does anything that changed for a
 * second reason while it happened to gain an `| undefined`.
 */
import { describe, it, expect } from "bun:test";
import { isWidening } from "./breaking-check.ts";

/** The added-lines set a package's diff would produce. */
const added = (...lines: string[]): Set<string> => new Set(lines);

describe("isWidening", () => {
  it("accepts an optional property that gained `| undefined`", () => {
    expect(isWidening("image?: string", added("image?: string | undefined"))).toBe(true);
  });

  it("accepts a function type, which has to be parenthesised to be widened", () => {
    // `() => void | undefined` parses as a function returning `void | undefined`,
    // so the codemod wraps it — and the pairing has to expect the wrap.
    expect(
      isWidening("setup?: (db: SQL) => void", added("setup?: ((db: SQL) => void) | undefined")),
    ).toBe(true);
  });

  it("accepts a whole type alias where several members moved at once", () => {
    const before = "type C = {    a?: X;    b?: Y;}";
    const after = "type C = {    a?: X | undefined;    b?: Y | undefined;}";
    expect(isWidening(before, added(after))).toBe(true);
  });

  it("reports a removal with no replacement", () => {
    expect(isWidening("image?: string", added("something?: else | undefined"))).toBe(false);
  });

  it("reports a property that was deleted outright", () => {
    expect(isWidening("image?: string", added())).toBe(false);
  });

  it("reports a narrowing, which is the direction that does break a caller", () => {
    // `T | undefined` becoming `T` is the mirror image and is not exempt.
    expect(isWidening("image?: string | undefined", added("image?: string"))).toBe(false);
  });

  it("reports a type that changed for another reason while gaining `| undefined`", () => {
    expect(isWidening("count?: number", added("count?: string | undefined"))).toBe(false);
  });

  it("reports a rename that gained `| undefined`", () => {
    expect(isWidening("image?: string", added("picture?: string | undefined"))).toBe(false);
  });

  it("ignores a line with no optional property at all", () => {
    // A required member, a class, a function signature — nothing here can widen.
    expect(isWidening("store: (file: File) => Promise<void>", added("anything"))).toBe(false);
  });

  it("reports a required property that became optional-and-undefined", () => {
    // Widening a *required* property to optional removes a guarantee readers had.
    expect(isWidening("image: string", added("image?: string | undefined"))).toBe(false);
  });
});

/**
 * A shape that gained an optional member has not lost anything.
 *
 * `sqlite: { path: string }` becoming `sqlite: { path: string; foreignKeys?: boolean }`
 * reads as a removal plus an addition and breaks nobody — the old shape is still
 * constructible, assignable and implementable.
 *
 * The risk is the mirror cases, so most of these are about what must still be
 * reported: a member leaving, a member changing type, and a *required* member
 * arriving, which does stop existing object literals type-checking.
 */
describe("isWidening — a shape gaining an optional member", () => {
  const shape = (body: string): string => `sqlite: {    ${body}}`;

  it("accepts a new optional member", () => {
    expect(
      isWidening(
        shape("path: string;"),
        added(shape("path: string;    foreignKeys?: boolean | undefined;")),
      ),
    ).toBe(true);
  });

  it("reports a member that left", () => {
    expect(
      isWidening(shape("path: string;    mode?: number;"), added(shape("path: string;"))),
    ).toBe(false);
  });

  it("reports a member whose type changed", () => {
    expect(
      isWidening(
        shape("path: string;"),
        added(shape("path: number;    foreignKeys?: boolean | undefined;")),
      ),
    ).toBe(false);
  });

  it("reports a new *required* member, which breaks every existing literal", () => {
    expect(isWidening(shape("path: string;"), added(shape("path: string;    mode: number;")))).toBe(
      false,
    );
  });

  it("reports a change to the declaration around the members", () => {
    expect(
      isWidening("sqlite: {    path: string;}", added("postgres: {    path: string;    x?: 1;}")),
    ).toBe(false);
  });

  it("ignores a line with no inline shape at all", () => {
    expect(isWidening("function store = (f: File) => Promise<void>", added("anything"))).toBe(
      false,
    );
  });
});
