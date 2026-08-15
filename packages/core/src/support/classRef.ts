/**
 * The framework's one name for "a class, used as a key".
 *
 * Policies, event listeners, auto-registered middleware, injection metadata,
 * column and relation definitions — all of them are registered against the class
 * itself and read back by walking its prototype chain. A dozen signatures
 * therefore need a type that means *the constructor*, not *an instance*. That
 * type used to be the built-in `Function`, which also accepts a plain arrow
 * function and says nothing about being constructible: the registries would
 * happily key off a callback.
 *
 * `abstract` and `never[]` are both deliberate. A base class is often abstract, a
 * mixin-composed class takes whatever arguments its bases take, and neither
 * should be excluded from a registry key. Nothing that holds a `ClassRef` ever
 * calls the constructor — code that genuinely needs an instance narrows first.
 *
 * This is deliberately not the container's `AbstractToken`: a token is something
 * the container can *resolve*, and its `<T>` is the instance you get back. A
 * `ClassRef` is only ever a map key, so it asserts nothing about instances and
 * returns `unknown` — narrowing `object` here would reject the container's own
 * `new (...args: unknown[]) => T` tokens for a guarantee no caller uses.
 *
 * @internal Every signature that takes one is itself `@internal`: this is the
 * vocabulary first-party packages share for registering metadata, not surface an
 * app writes against.
 */
export type ClassRef = abstract new (...args: never[]) => unknown;
