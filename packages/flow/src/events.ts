// ── Type-safe real-time events ─────────────────────────────────────────────────
//
// `dispatch` / `dispatchTo` / `dispatchSelf` and `@on` are string-keyed at runtime, but their
// payloads can be type-checked end-to-end by declaring a contract — an app-augmentable interface
// that maps each event name to its payload type. No codegen: augment `FlowEvents` once and every
// dispatch site is checked, from server actions and client expressions alike.
//
//   // app/flow-events.d.ts
//   declare module "@zerotal/flow" {
//     interface FlowEvents {
//       "post-created": { id: number; title: string };
//       "cart-cleared": void;   // no payload
//     }
//   }
//
// Unknown event names still work (a `string` fallback overload keeps `echo:…` broadcasts and
// gradual adoption compiling), they're just untyped. Payloads are object shapes or `void`.

/**
 * The realtime event contract: maps each event name to its payload type. Empty by default; apps
 * augment it via TypeScript module augmentation so every dispatch site and `@on` handler is
 * type-checked end-to-end, with no codegen. `keyof FlowEvents` drives dispatch/`@on`
 * autocomplete.
 *
 * @remarks
 * Payloads are object shapes or `void` (for events with no payload). Unknown event names still
 * compile (a `string` fallback keeps `echo:…` broadcasts and gradual adoption working); they are
 * simply untyped.
 *
 * @example
 * ```ts
 * // app/flow-events.d.ts
 * declare module "@zerotal/flow" {
 *   interface FlowEvents {
 *     "post-created": { id: number; title: string };
 *     "cart-cleared": void; // no payload
 *   }
 * }
 * ```
 *
 * @category Realtime
 */

export interface FlowEvents {}

/**
 * A known event name — a key of the augmented {@link FlowEvents} contract.
 *
 * @category Realtime
 */
export type EventName = keyof FlowEvents;

/**
 * The payload type for a known event `K`, resolved from the {@link FlowEvents} contract. Use it
 * to type an `@on` handler's parameter, e.g. `EventPayload<"post-created">`.
 *
 * @category Realtime
 */
export type EventPayload<K extends EventName> = FlowEvents[K];

/**
 * The trailing argument(s) of a dispatch call for payload `P`: none when `P` is `void`
 * (`dispatch("cart-cleared")`), otherwise a single typed payload.
 */
export type EventArgs<P> = [P] extends [void] ? [] : [payload: P];

/** An event name loosened to accept any string (autocomplete for known names, `echo:…` too). */
export type LooseEventName = EventName | (string & {});

// ── Optional runtime shape guards ──────────────────────────────────────────────
// The types cover dispatch sites at compile time; a guard adds a runtime check for payloads that
// arrive from an untrusted source (a client-originated dispatch) or to catch a refactor that the
// types missed. Opt in per event; a failed guard throws from dispatch().

type Guard = (payload: unknown) => boolean;
const _guards = new Map<string, Guard>();

/**
 * Registers a runtime guard for a known event's payload.
 *
 * @remarks
 * The compile-time {@link FlowEvents} contract covers dispatch sites at build time; this adds a
 * runtime check for payloads arriving from an untrusted source (a client-originated dispatch) or
 * to catch a refactor the types missed. Opt in per event. When a guard is set, `dispatch` (and
 * its variants) throw a `TypeError` if the payload doesn't satisfy it — surfacing a malformed
 * payload loudly instead of letting it flow to listeners. Registering the same event again
 * replaces its guard.
 *
 * @param name - The known event name to guard (a key of {@link FlowEvents}).
 * @param guard - A type-guard predicate that narrows an `unknown` payload to the event's type.
 *
 * @example
 * ```ts
 * registerFlowEvent("post-created", (p): p is { id: number } =>
 *   typeof (p as { id?: unknown })?.id === "number");
 * ```
 *
 * @category Realtime
 */
export function registerFlowEvent<K extends EventName>(
  name: K,
  guard: (payload: unknown) => payload is FlowEvents[K],
): void {
  _guards.set(name as string, guard as Guard);
}

/** @internal Validate a dispatched payload against its registered guard; throws on mismatch. */
export function _validateEventPayload(name: string, payload: unknown): void {
  const guard = _guards.get(name);
  if (guard && !guard(payload)) {
    throw new TypeError(`[Flow] dispatch("${name}") payload failed its registered guard.`);
  }
}

/** @internal Test hook — clear all registered guards. */
export function _resetEventGuards(): void {
  _guards.clear();
}
