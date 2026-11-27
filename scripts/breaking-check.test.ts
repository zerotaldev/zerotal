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

describe("isWidening — an additive change that reads as a removal", () => {
  const frameworkEvents =
    "const FrameworkEvents = {    on<E extends object>(t: string, h: Handler<E>): () => void;    emit<E extends object>(event: E): void;    clear(): void;}";

  it("accepts a const that gained a method", () => {
    const after =
      "const FrameworkEvents = {    on<E extends object>(t: string, h: Handler<E>): () => void;    onAsync<E extends object>(t: string, h: Handler<E>): () => void;    emit<E extends object>(event: E): void;    clear(): void;}";
    expect(isWidening(frameworkEvents, added(after))).toBe(true);
  });

  it("reports a const that lost a method while gaining another", () => {
    const after =
      "const FrameworkEvents = {    on<E extends object>(t: string, h: Handler<E>): () => void;    onAsync(): void;    clear(): void;}";
    expect(isWidening(frameworkEvents, added(after))).toBe(false);
  });

  it("reports a const whose existing method changed while one was added", () => {
    const after =
      "const FrameworkEvents = {    on<E extends object>(t: string): () => void;    onAsync(): void;    emit<E extends object>(event: E): void;    clear(): void;}";
    expect(isWidening(frameworkEvents, added(after))).toBe(false);
  });

  it("reports a type alias that gained a required member, which breaks every literal", () => {
    expect(isWidening("type O = {    a: X;}", added("type O = {    a: X;    b: Y;}"))).toBe(false);
  });

  it("accepts a function that gained an optional parameter", () => {
    expect(
      isWidening(
        "static install: () => AiFake",
        added("static install: (options?: {    emit?: boolean;}) => AiFake"),
      ),
    ).toBe(true);
  });

  it("accepts a constructor that gained trailing optional parameters", () => {
    expect(
      isWidening(
        "new (a: string, b: Record<string, unknown>, error?: string | undefined): E",
        added(
          "new (a: string, b: Record<string, unknown>, error?: string | undefined, meta?: Record<string, unknown> | undefined): E",
        ),
      ),
    ).toBe(true);
  });

  it("reports a function that gained a required parameter", () => {
    expect(
      isWidening("static install: () => AiFake", added("static install: (options: X) => AiFake")),
    ).toBe(false);
  });

  it("reports a parameter that changed type while another was added", () => {
    expect(
      isWidening("run: (a: string) => void", added("run: (a: number, b?: string) => void")),
    ).toBe(false);
  });

  it("reports a function whose return type changed while it gained a parameter", () => {
    expect(
      isWidening("run: (a: string) => void", added("run: (a: string, b?: string) => string")),
    ).toBe(false);
  });

  it("reports an optional parameter list that lost one", () => {
    expect(
      isWidening("run: (a: string, b?: string) => void", added("run: (a: string) => void")),
    ).toBe(false);
  });
});

describe("isWidening — overloads added to a function", () => {
  const before =
    "function column = {    (): D;    (type: S): D;    (options: O): D;    (type: S, options: Omit<O, 'type'>): D;}";

  it("accepts a function that gained overloads, every old one kept in order", () => {
    const after =
      "function column = {    (): D;    (type: S): D;    (options: O): D;    (options: I): D;    (type: S, options: Omit<O, 'type'>): D;    (type: 'x'): D;}";
    expect(isWidening(before, added(after))).toBe(true);
  });

  it("reports an overload that changed while another was added", () => {
    const after =
      "function column = {    (): D;    (type: S): D;    (options: I): D;    (type: S, options: Omit<O, 'type'>): D;    (type: 'x'): D;}";
    expect(isWidening(before, added(after))).toBe(false);
  });

  it("reports an overload that was dropped", () => {
    const after =
      "function column = {    (): D;    (type: S): D;    (options: O): D;    (type: 'x'): D;}";
    expect(isWidening(before, added(after))).toBe(false);
  });
});

describe("isWidening — overloads added to a method", () => {
  const before = "  inertia: () => InertiaPage | null";

  it("accepts a method that gained an overload beside its signature", () => {
    const after =
      "  inertia: {    (): InertiaPage | null;    <P extends object>(): InertiaPageOf<P> | null;}";
    expect(isWidening(before, added(after))).toBe(true);
  });

  it("reports a method whose old signature changed while it gained one", () => {
    const after =
      "  inertia: {    (): InertiaPage;    <P extends object>(): InertiaPageOf<P> | null;}";
    expect(isWidening(before, added(after))).toBe(false);
  });

  it("reports a method that is renamed or made optional", () => {
    for (const after of [
      "  page: {    (): InertiaPage | null;    <P extends object>(): InertiaPageOf<P> | null;}",
      "  inertia?: {    (): InertiaPage | null;    <P extends object>(): InertiaPageOf<P> | null;}",
    ]) {
      expect({ after, ok: isWidening(before, added(after)) }).toEqual({ after, ok: false });
    }
  });

  it("reports a signature set with nothing added", () => {
    expect(isWidening(before, added("  inertia: {    (): InertiaPage | null;}"))).toBe(false);
  });
});

describe("isWidening — a parameter widened through a new union", () => {
  const before =
    "multipart: (url: string, body?: Record<string, TestFormValue>, method?: 'POST') => Promise<R>";
  const after =
    "multipart: (url: string, body?: Record<string, TestMultipartValue>, method?: 'POST') => Promise<R>";

  it("accepts a parameter whose type names a new union of the old type", () => {
    const alias = "type TestMultipartValue = TestFormValue | readonly TestFormValue[]";
    expect(isWidening(before, added(after, alias))).toBe(true);
  });

  it("reports it when the union does not include the old type", () => {
    const alias = "type TestMultipartValue = TestFileInput | readonly TestFormValue[]";
    expect(isWidening(before, added(after, alias))).toBe(false);
  });

  it("reports it when the alias is not a union", () => {
    expect(isWidening(before, added(after, "type TestMultipartValue = TestFormValue"))).toBe(false);
  });

  it("reports it when the alias was not added", () => {
    expect(isWidening(before, added(after))).toBe(false);
  });

  it("reports the return type widened the same way, which callers read", () => {
    const was = "read: (key: string) => Promise<TestFormValue>";
    const now = "read: (key: string) => Promise<TestMultipartValue>";
    const alias = "type TestMultipartValue = TestFormValue | readonly TestFormValue[]";
    expect(isWidening(was, added(now, alias))).toBe(false);
  });

  it("reports a callback's parameter widened the same way", () => {
    const was = "each: (fn: (value: TestFormValue) => void) => void";
    const now = "each: (fn: (value: TestMultipartValue) => void) => void";
    const alias = "type TestMultipartValue = TestFormValue | readonly TestFormValue[]";
    expect(isWidening(was, added(now, alias))).toBe(false);
  });
});

describe("isWidening — a union printed in another order", () => {
  it("accepts the same members in a different order", () => {
    expect(
      isWidening(
        "status: 'dispatched' | 'completed' | 'failed'",
        added("status: 'failed' | 'dispatched' | 'completed'"),
      ),
    ).toBe(true);
  });

  it("accepts the readonly form too", () => {
    expect(
      isWidening("readonly status: 'a' | 'b' | 'c'", added("readonly status: 'c' | 'a' | 'b'")),
    ).toBe(true);
  });

  it("reports a union that lost a member, which is a narrowing", () => {
    expect(isWidening("status: 'a' | 'b' | 'c'", added("status: 'c' | 'a'"))).toBe(false);
  });

  it("reports a union that changed a member", () => {
    expect(isWidening("status: 'a' | 'b'", added("status: 'b' | 'z'"))).toBe(false);
  });

  it("does not rearrange a parameter list under cover of the rule", () => {
    expect(isWidening("run: (a: A | B, c: C) => D", added("run: (c: C, a: A | B) => D"))).toBe(
      false,
    );
  });
});
