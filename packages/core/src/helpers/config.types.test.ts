import { test, expect } from "bun:test";
import type { ConfigPath, ConfigValue } from "../config/registry.ts";

// Compile-time assertions for the typed-config dot-path machinery. These are erased
// at runtime (bun test) but enforced by `tsc --noEmit`: each alias fails to compile
// if ConfigValue / ConfigPath regress. Core only registers the `app` and `health`
// namespaces, so we assert against `app.*`.

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// Top-level scalars resolve to their declared type.
type _Name = Expect<Equal<ConfigValue<"app.name">, string>>;
type _Port = Expect<Equal<ConfigValue<"app.port">, number>>;
type _Debug = Expect<Equal<ConfigValue<"app.debug">, boolean>>;

// Nested paths resolve through object levels.
type _Cred = Expect<Equal<ConfigValue<"app.cors.credentials">, boolean>>;
type _Max = Expect<Equal<ConfigValue<"app.throttle.maxAttempts">, number>>;

// Known paths are members of the ConfigPath union; unknown paths fall back to unknown.
type _Known = Expect<"app.name" extends ConfigPath ? true : false>;
type _Unknown = Expect<Equal<ConfigValue<"app.totally.made.up">, unknown>>;

// Reference the aliases so noUnusedLocals doesn't flag them.
type _All = [_Name, _Port, _Debug, _Cred, _Max, _Known, _Unknown];

test("typed config dot-paths compile (type-level)", () => {
  expect(true).toBe(true);
});
