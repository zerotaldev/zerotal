/**
 * One object-graph redaction walk, shared by everything that records a value it
 * did not choose.
 *
 * Several packages need the same thing: copy a value, replace what a key name
 * says is a secret, and come back with something `JSON.stringify` survives. Each
 * had written its own — and each had to solve the same three hazards, which are
 * the parts that are easy to get subtly wrong:
 *
 * - **Cycles.** A model holding a back-reference to its parent is ordinary, and
 *   `JSON.stringify` throws on it. The ancestor set is released on the way back
 *   *up*, so a value that legitimately appears twice as a sibling is rendered
 *   twice rather than reported as a cycle the second time.
 * - **Depth.** Recording happens on the request path, so a pathological graph
 *   must not stall it.
 * - **Values that read better flat than walked.** A `Date`, a `File`, an `Error`
 *   — `Object.entries` on any of them produces something worse than useless.
 *
 * What it deliberately does *not* fix is the vocabulary. Callers bring their own
 * markers and their own sensitivity predicate, because those are not
 * interchangeable: a devtools panel's `‹redacted›` is a display choice, while an
 * adapter implementing a published wire protocol has its markers specified for
 * it. Sharing the walk does not mean agreeing on the words.
 */

/** How one caller wants the graph walked. */
export interface RedactGraphOptions {
  /** Whether the value under this key should be withheld. */
  sensitive: (key: string) => boolean;
  /** What a withheld value is replaced with. */
  mask: string;
  /** What a reference back to an ancestor is replaced with. */
  circular: string;
  /** What a value at or below the depth limit is replaced with. */
  tooDeep: string;
  /**
   * The depth at which the walk stops. The root is depth 0, so `6` renders five
   * levels of nesting and replaces the sixth.
   */
  maxDepth: number;
  /**
   * Render a value instead of walking into it — a `Date` as an ISO string, a
   * `File` as a summary. Return `undefined` to walk it normally.
   *
   * Called for every non-null value, before the cycle and depth checks, so a
   * flattened value is never reported as either — and so a caller can also name
   * things that are not objects at all. A function is the case worth having:
   * `JSON.stringify` drops the key it sits under, and a debugging tool that
   * silently omits a field is worse than one that says `‹fn›`.
   */
  flatten?: ((value: unknown) => string | undefined) | undefined;
}

/**
 * Copy `value`, masking every field whose name `options.sensitive` rejects.
 *
 * A primitive is returned unchanged — there is no key to judge it by, and
 * inspecting a string's *contents* for things that look like secrets is a
 * different, guessier job this does not attempt.
 *
 * @param value - Anything. Not modified.
 * @param options - Markers, limits, and the sensitivity predicate.
 * @returns A new value, safe to serialise.
 */
export function redactGraph(value: unknown, options: RedactGraphOptions): unknown {
  return _walk(value, options, 0, new WeakSet());
}

function _walk(
  value: unknown,
  options: RedactGraphOptions,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null) return null;

  const flat = options.flatten?.(value);
  if (flat !== undefined) return flat;
  if (typeof value !== "object") return value;

  const object = value as object;
  if (seen.has(object)) return options.circular;
  if (depth >= options.maxDepth) return options.tooDeep;

  seen.add(object);
  try {
    if (Array.isArray(object)) {
      return object.map((item) => _walk(item, options, depth + 1, seen));
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(object as Record<string, unknown>)) {
      // A boolean is never a secret. It has two possible values, so masking one
      // conceals nothing a reader could not guess — while destroying the answer
      // they came for. Names are matched by substring, so this is not
      // hypothetical: `cors.credentials` contains "credential" and came back as
      // `‹redacted›` on the DevTools Config tab, hiding whether credentialed
      // CORS was on. That is a security setting a reader is checking *because*
      // it matters.
      const maskable = typeof item !== "boolean";
      out[key] =
        maskable && options.sensitive(key) ? options.mask : _walk(item, options, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(object);
  }
}
