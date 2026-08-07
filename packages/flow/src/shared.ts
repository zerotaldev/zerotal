// ── @shared support (server side) ─────────────────────────────────────────────
//
// `@shared` props are convergent, server-authoritative state bound to a broadcast
// channel. A per-channel room store holds the canonical value; before every action the
// prop is refilled from the store (read-latest), and after an action that changed it the
// new value is written back and broadcast to the channel so other subscribers converge.
//
// Broadcasting is an OPTIONAL peer: flow does not depend on it. We resolve `Broadcast`
// through a variable-specifier dynamic import (not type-checked, so no hard dependency)
// and no-op gracefully when it isn't installed — the store still works in-process, so a
// single-tab app converges within its own round-trips even without broadcasting.

import type { Component } from "./Component.ts";
import { getSharedProps, resolveSharedChannel } from "./decorators.ts";

/**
 * The wire event name the server broadcasts (and the client subscribes to) when
 * one or more `@shared` props on a channel change, prompting subscribers to
 * re-read the room store and converge.
 */
export const SHARED_EVENT = "flow:shared";

// ── Room store ────────────────────────────────────────────────────────────────
// Keyed by `channel::prop`. The default is an in-process Map (single-process apps and
// the showcase). Multi-instance deployments swap in a Redis-backed store via
// `setSharedStore()` — the same convergence logic then fans out across processes.

/**
 * Pluggable backing store for `@shared` room state — the canonical, per-channel
 * value that all subscribers converge on.
 *
 * @remarks
 * Keys are of the form `channel::prop`. Stored values are already deep-cloned by
 * the caller, so the store may hold references without aliasing component state.
 * The default is an in-process {@link MemorySharedStore}; swap a distributed
 * implementation (e.g. Redis-backed) via {@link setSharedStore} to converge
 * across processes. Implement all three methods synchronously.
 */
export interface SharedStore {
  /** Read the current value for a `channel::prop` key, or `undefined` if unset. */
  get(key: string): unknown | undefined;
  /** Write the canonical value for a `channel::prop` key. */
  set(key: string, value: unknown): void;
  /** Whether a value has been stored for a `channel::prop` key. */
  has(key: string): boolean;
}

class MemorySharedStore implements SharedStore {
  private _map = new Map<string, unknown>();
  get(key: string): unknown | undefined {
    return this._map.get(key);
  }
  set(key: string, value: unknown): void {
    this._map.set(key, value);
  }
  has(key: string): boolean {
    return this._map.has(key);
  }
}

let _store: SharedStore = new MemorySharedStore();

/**
 * Replace the process-wide backing store for `@shared` room state. Call this once
 * at boot to move convergence off the default in-process map onto a distributed
 * backend so it fans out across server instances.
 *
 * @param store - The store implementation to install.
 *
 * @example
 * ```ts
 * // boot: converge @shared state across all app instances via Redis.
 * setSharedStore(new RedisSharedStore(redis));
 * ```
 */
export function setSharedStore(store: SharedStore): void {
  _store = store;
}

/**
 * Get the active `@shared` room store (the in-process default, or whatever was
 * installed via {@link setSharedStore}). Rarely needed in app code — `@shared`
 * props read/write it automatically — but useful for tests or admin tooling that
 * inspects room state directly.
 *
 * @returns The current {@link SharedStore}.
 *
 * @example
 * ```tsx
 * // A collaborative counter: every subscriber to `room.lobby` converges on `count`.
 * class Counter extends Component {
 *   @shared("room.lobby") count = 0;
 *   @expose increment() { this.count++; } // written back + broadcast on commit
 * }
 * ```
 */
export function getSharedStore(): SharedStore {
  return _store;
}

/** @internal Test hook — clear the default in-memory store between tests. */
export function _resetSharedStore(): void {
  _store = new MemorySharedStore();
}

function _key(channel: string, prop: string): string {
  return `${channel}::${prop}`;
}

/** Deep-clone a value so the store and the component never alias the same reference. */
function _clone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    // Functions / class instances with methods aren't structured-cloneable — fall back to
    // a JSON round-trip (the same shape the delta encoder already assumes for @shared props).
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

// ── Broadcasting (optional peer) ───────────────────────────────────────────────

interface BroadcastBuilder {
  as(event: string): BroadcastBuilder;
  with(data: unknown): BroadcastBuilder;
  toOthers(): BroadcastBuilder;
  send(): void;
}
interface BroadcastFacade {
  presence(channel: string): BroadcastBuilder;
}

let _broadcast: BroadcastFacade | null | undefined;

async function _resolveBroadcast(): Promise<BroadcastFacade | null> {
  if (_broadcast !== undefined) return _broadcast;
  try {
    const spec = "@zerotal/broadcasting";
    const mod = (await import(spec)) as { Broadcast?: BroadcastFacade };
    _broadcast = mod.Broadcast ?? null;
  } catch {
    _broadcast = null; // broadcasting not installed → in-process convergence only
  }
  return _broadcast;
}

// ── Populate / snapshot / commit ────────────────────────────────────────────────

/**
 * Refill every `@shared` prop on `page` from the room store (server-authoritative
 * read-latest). If a channel has no stored value yet, seed the store with the prop's
 * current default so the first writer converges against a known baseline. Called before
 * every action and on the initial GET; a no-op when the component has no `@shared` props.
 */
export function populateShared(page: Component): void {
  const props = getSharedProps(page);
  if (props.size === 0) return;
  const store = _store;
  const bag = page as unknown as Record<string, unknown>;
  for (const [prop, channel] of props) {
    const key = _key(resolveSharedChannel(channel, page), prop);
    if (store.has(key)) {
      bag[prop] = _clone(store.get(key));
    } else {
      store.set(key, _clone(bag[prop])); // seed with the current default
    }
  }
}

/**
 * Capture the current `@shared` prop values (as stable JSON) so a later
 * {@link commitShared} can detect which ones an action changed.
 */
export function snapshotSharedValues(page: Component): Map<string, string> {
  const props = getSharedProps(page);
  const before = new Map<string, string>();
  if (props.size === 0) return before;
  const bag = page as unknown as Record<string, unknown>;
  for (const prop of props.keys()) before.set(prop, JSON.stringify(bag[prop]));
  return before;
}

/**
 * Write back every `@shared` prop whose value changed since `before`, then broadcast the
 * change to its channel so other subscribers re-read and converge. Returns the names of
 * the props that changed. No broadcast is sent when broadcasting isn't installed (the
 * store is still updated, so same-process round-trips converge).
 */
export async function commitShared(
  page: Component,
  before: Map<string, string>,
): Promise<string[]> {
  const props = getSharedProps(page);
  if (props.size === 0) return [];
  const store = _store;
  const bag = page as unknown as Record<string, unknown>;

  // Group changed props by channel so one channel broadcasts a single event.
  const changedByChannel = new Map<string, string[]>();
  const changed: string[] = [];
  for (const [prop, channel] of props) {
    const now = JSON.stringify(bag[prop]);
    if (now === before.get(prop)) continue;
    const name = resolveSharedChannel(channel, page);
    store.set(_key(name, prop), _clone(bag[prop]));
    changed.push(prop);
    (changedByChannel.get(name) ?? changedByChannel.set(name, []).get(name)!).push(prop);
  }
  if (changed.length === 0) return [];

  const Broadcast = await _resolveBroadcast();
  if (Broadcast) {
    for (const [channel, propsForChannel] of changedByChannel) {
      try {
        Broadcast.presence(channel)
          .as(SHARED_EVENT)
          .with({ props: propsForChannel })
          .toOthers()
          .send();
      } catch {
        /* broadcasting misconfigured — the store is still authoritative for new GETs */
      }
    }
  }
  return changed;
}
