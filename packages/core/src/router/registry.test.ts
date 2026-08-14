/**
 * Type-level tests for the params `route()` derives from a URL pattern. These
 * assert at compile time (`bun run typecheck:tests`); the runtime body only
 * exists so the file is a normal test.
 */
import { describe, it, expect } from "bun:test";
import type { ParamsOf } from "./registry.ts";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type Value = string | number;

// A static route takes no params at all.
type _NoParams = Expect<Equal<ParamsOf<"/about">, Record<never, never>>>;
type _Root = Expect<Equal<ParamsOf<"/">, Record<never, never>>>;

// One param, trailing.
type _One = Expect<Equal<keyof ParamsOf<"/posts/:slug">, "slug">>;
type _OneValue = Expect<Equal<ParamsOf<"/posts/:slug">["slug"], Value>>;

// A param mid-pattern, and several of them.
type _Mid = Expect<Equal<keyof ParamsOf<"/users/:id/posts">, "id">>;
type _Many = Expect<Equal<keyof ParamsOf<"/a/:x/b/:y">, "x" | "y">>;
type _Nested = Expect<Equal<keyof ParamsOf<"/api/:version/users/:id/edit">, "version" | "id">>;

// A catch-all reaches the router as `*` — its `[...slug]` name is gone by then.
type _Wildcard = Expect<Equal<keyof ParamsOf<"/docs/*">, "*">>;
type _WildcardValue = Expect<Equal<ParamsOf<"/docs/*">["*"], Value | readonly Value[]>>;
type _ParamThenWildcard = Expect<Equal<keyof ParamsOf<"/docs/:version/*">, "version" | "*">>;

// An unaugmented registry leaves the pattern as plain `string`, which must not
// invent params — that is the case every app is in before it runs the generator.
type _Unknown = Expect<Equal<ParamsOf<string>, Record<never, never>>>;

describe("ParamsOf", () => {
  it("compiles — the assertions above are the test", () => {
    expect(true).toBe(true);
  });
});
