/**
 * Shared identifier-case helpers — the ORM's one camel/snake implementation.
 *
 * Before this module existed there were five copies across three files, with
 * two different camel regexes. The divergence was live: `_keysetValue` used
 * `/_([a-z0-9])/g` while hydration used `/_([a-z])/g`, so for a column like
 * `user_2fa` the keyset lookup asked for `user2fa` on an instance whose
 * property was `user_2fa` — the cursor encoded `undefined` and keyset
 * pagination restarted from the top.
 *
 * The letters-only regex is canonical **because hydration uses it**: every
 * helper that reads a property off a hydrated instance must derive the same
 * name hydration produced.
 */

// DB schemas are static: the same names appear on every row. Caching the regex
// result turns thousands of executions into Map lookups after the first query.
const _camelCache = new Map<string, string>();
const _snakeCache = new Map<string, string>();

/** snake_case → camelCase, memoized. Matches BaseModel hydration exactly. */
export function toCamelKey(s: string): string {
  let v = _camelCache.get(s);
  if (v === undefined) {
    v = s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    _camelCache.set(s, v);
  }
  return v;
}

/**
 * Convert a model property name to its database column name (camelCase →
 * snake_case), mirroring the convention BaseModel uses on read/write. Raw
 * expressions (anything beyond identifier/dot characters) and already-snake
 * names pass through unchanged, so it is safe and idempotent to apply to any
 * caller-supplied column — qualified `table.createdAt` resolves cleanly too.
 */
export function toSnakeColumn(s: string): string {
  if (/[^\w.]/.test(s)) return s; // raw expression / function call — leave as-is
  let v = _snakeCache.get(s);
  if (v === undefined) {
    v = s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    _snakeCache.set(s, v);
  }
  return v;
}

/**
 * The constructor prototype chain of `ctor`, base-first — so a subclass's
 * entries override its parents' when merged in order. Terminates on
 * `Function.prototype` (not a falsy `.name`) so anonymous mixin classes are
 * still visited. Shared by cast collection and global-scope merging.
 */
export function ctorChain(ctor: Function): Function[] {
  const chain: Function[] = [];
  let current: Function | null = ctor;
  while (current && current !== Function.prototype) {
    chain.unshift(current);
    current = Object.getPrototypeOf(current) as Function | null;
  }
  return chain;
}
