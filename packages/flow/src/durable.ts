// ── Durable / resumable snapshots ─────────────────────────────────────────────
//
// A component opts in with `static durable = true` (or `{ ttl, scope }`). Its signed
// snapshot is then persisted server-side after every request, keyed by user (or session)
// + route + component. On a fresh GET the stored snapshot is restored — skipping onMount —
// so the user resumes exactly across a tab close/reopen, a device switch, or a reconnect
// after the held client snapshot is gone. With a persistent store (see setDurableStore),
// it also survives a server redeploy.
//
// The snapshot is HMAC-signed, so a tampered or stale-key entry fails verification and
// falls back to a fresh mount; keying by user/session id isolates one user from another.

import type { Component } from "./Component.ts";
import type { Snapshot } from "./types.ts";
import type { HttpContext } from "@zerotal/core";
import { verifySnapshot, applySnapshotData, stripPendingSecrets } from "./dehydrate.ts";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * A component's durable-snapshot opt-in, set as `static durable` on the component.
 *
 * - `true` — enable with defaults (24h TTL, `"user"` scope).
 * - `{ ttl, scope }` — enable with a custom lifetime and keying:
 *   - `ttl` — a duration string like `"30s"`, `"15m"`, `"2h"`, `"7d"` (defaults to 24h if omitted/unparseable).
 *   - `scope` — `"user"` keys by authenticated user (falling back to session when
 *     anonymous); `"session"` always keys by session, for per-device durability
 *     even while logged in.
 *
 * @remarks
 * When enabled, the component's signed snapshot is persisted after every request
 * and restored on a fresh GET (skipping `onMount`), so a user resumes across a tab
 * close/reopen, a device switch, or a reconnect. With a persistent store (see
 * {@link setDurableStore}) it also survives a server redeploy.
 *
 * @example
 * ```ts
 * class Wizard extends Component {
 *   static durable = { ttl: "2h", scope: "session" } satisfies DurableOption;
 *   // ...on the final step:
 *   @expose finish() { this.clearDurable(); } // drop stored state on completion
 * }
 * ```
 */
export type DurableOption = boolean | { ttl?: string; scope?: "user" | "session" };

interface DurableConfig {
  ttlMs: number;
  /** `"user"` keys by the authenticated user (falling back to session when anonymous);
   *  `"session"` always keys by session (per-device durability even when logged in). */
  scope: "user" | "session";
}

// ── Store ───────────────────────────────────────────────────────────────────────
// Default is an in-process TTL Map — survives reconnect/tab-close/device-switch within
// the process lifetime. Swap a persistent backend (e.g. @zerotal/cache/Redis) via
// setDurableStore() to also survive a server redeploy.

/**
 * Pluggable backing store for durable component snapshots.
 *
 * @remarks
 * The default {@link MemoryDurableStore} keeps entries in-process with TTL
 * eviction — durable across reconnect/tab-close/device-switch within the process
 * lifetime, but lost on redeploy. Swap a persistent backend (e.g.
 * `@zerotal/cache`/Redis) via {@link setDurableStore} to also survive redeploys.
 * Methods may be sync or async; a swapped store is responsible for its own TTL
 * eviction (the `ttlMs` hint is passed to {@link DurableStore.set | set}).
 */
export interface DurableStore {
  /** Fetch a stored snapshot by key, or `undefined` if absent/expired. */
  get(key: string): Promise<Snapshot | undefined> | Snapshot | undefined;
  /** Store a snapshot under `key`, expiring after `ttlMs` if supported. */
  set(key: string, value: Snapshot, ttlMs?: number): Promise<void> | void;
  /** Remove a stored snapshot (used on flow completion via `clearDurable()`). */
  delete(key: string): Promise<void> | void;
}

class MemoryDurableStore implements DurableStore {
  private _map = new Map<string, { snap: Snapshot; expiresAt: number }>();
  get(key: string): Snapshot | undefined {
    const e = this._map.get(key);
    if (!e) return undefined;
    if (e.expiresAt < Date.now()) {
      this._map.delete(key);
      return undefined;
    }
    return e.snap;
  }
  set(key: string, value: Snapshot, ttlMs = DEFAULT_TTL_MS): void {
    this._map.set(key, { snap: value, expiresAt: Date.now() + ttlMs });
  }
  delete(key: string): void {
    this._map.delete(key);
  }
  /** @internal Evict expired entries so the map doesn't grow unbounded. */
  _sweep(): void {
    const now = Date.now();
    for (const [k, e] of this._map) if (e.expiresAt < now) this._map.delete(k);
  }
}

let _store: DurableStore = new MemoryDurableStore();

// Bound the default store's memory; a swapped store manages its own eviction (TTL).
setInterval(() => {
  if (_store instanceof MemoryDurableStore) _store._sweep();
}, 60 * 60_000).unref?.();

/**
 * Replace the process-wide durable-snapshot store. Call once at boot to move
 * durability off the default in-process map onto a persistent backend so resumable
 * state survives a server redeploy (and is shared across instances).
 *
 * @param store - The store implementation to install.
 *
 * @example
 * ```ts
 * // boot: persist durable snapshots in Redis so they outlive redeploys.
 * setDurableStore(new CacheDurableStore(cache));
 * ```
 */
export function setDurableStore(store: DurableStore): void {
  _store = store;
}

/**
 * Get the active durable-snapshot store (the in-process default, or whatever was
 * installed via {@link setDurableStore}). Mainly useful for tests or tooling that
 * inspects persisted snapshots directly.
 *
 * @returns The current {@link DurableStore}.
 */
export function getDurableStore(): DurableStore {
  return _store;
}

/** @internal Test hook — reset to a fresh in-process store between tests. */
export function _resetDurableStore(): void {
  _store = new MemoryDurableStore();
}

// ── Config ────────────────────────────────────────────────────────────────────

/** Parse a duration like `"30s"`, `"15m"`, `"2h"`, `"7d"` into milliseconds. */
function _parseDuration(ttl: string): number {
  const m = /^(\d+)\s*(s|m|h|d)$/.exec(ttl.trim());
  if (!m) return DEFAULT_TTL_MS;
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as "s" | "m" | "h" | "d"];
  return n * unit;
}

/** Resolve a component's `static durable` opt-in into a normalized config, or null when off. */
export function getDurableConfig(page: Component): DurableConfig | null {
  const raw = (page.constructor as { durable?: DurableOption }).durable;
  if (!raw) return null;
  if (raw === true) return { ttlMs: DEFAULT_TTL_MS, scope: "user" };
  return {
    ttlMs: raw.ttl ? _parseDuration(raw.ttl) : DEFAULT_TTL_MS,
    scope: raw.scope ?? "user",
  };
}

// ── Keying ──────────────────────────────────────────────────────────────────────

type SessionLike = { get(k: string): unknown; set(k: string, v: unknown): void };
const _SID_KEY = "flow:durable:sid";

function _session(ctx: HttpContext): SessionLike | undefined {
  return (ctx as unknown as { session?: SessionLike }).session;
}

function _randomSid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  ).replace(/-/g, "");
}

/**
 * Resolve the store key for this component + visitor, or null when no stable identity is
 * available (user-scoped but anonymous with no session). Session-scoped keys mint and persist
 * a stable id in the session on first use.
 */
function _resolveKey(page: Component, ctx: HttpContext, scope: "user" | "session"): string | null {
  const comp = page.constructor.name;
  const routePath = page._flowPath || "/";
  const userId = (ctx as unknown as { user?: { id?: unknown } }).user?.id;

  if (scope === "user" && userId != null) {
    return `flow:durable:u:${String(userId)}:${routePath}:${comp}`;
  }
  // Session id (user scope with no user → fall back here; or explicit session scope).
  const session = _session(ctx);
  if (!session) return null;
  let sid = session.get(_SID_KEY) as string | undefined;
  if (!sid) {
    sid = _randomSid();
    session.set(_SID_KEY, sid);
  }
  return `flow:durable:s:${sid}:${routePath}:${comp}`;
}

// ── Persist / restore ─────────────────────────────────────────────────────────

/**
 * Persist a durable component's snapshot after a request (both the initial GET and every WS
 * action). A no-op unless the component opts in and a key resolves. When the action called
 * `this.clearDurable()`, the stored entry is deleted instead (flow completion).
 */
export async function persistDurable(
  page: Component,
  ctx: HttpContext,
  snapshot: Snapshot,
): Promise<void> {
  const cfg = getDurableConfig(page);
  if (!cfg) return;
  const key = _resolveKey(page, ctx, cfg.scope);
  if (!key) return;
  if (page._clearDurable) {
    await _store.delete(key);
    return;
  }
  // Never persist a hidden field the client is part-way through typing — see
  // `stripPendingSecrets`. The wire may carry it back to the browser that produced it; a
  // server-side store, possibly Redis, may not hold it.
  await _store.set(key, stripPendingSecrets(snapshot), cfg.ttlMs);
}

/**
 * On a fresh GET, restore a durable component from its stored snapshot into `page` (which has
 * already run onBoot). Returns true when it resumed — the caller then runs onHydrate and skips
 * onMount. A missing entry, a tampered snapshot, or a rotated APP_KEY (verify fails) returns
 * false, so the caller mounts fresh.
 */
export async function restoreDurable(page: Component, ctx: HttpContext): Promise<boolean> {
  const cfg = getDurableConfig(page);
  if (!cfg) return false;
  const key = _resolveKey(page, ctx, cfg.scope);
  if (!key) return false;
  const stored = await _store.get(key);
  if (!stored || !verifySnapshot(stored)) return false;
  // Returning `true` is what skips the mount: the caller branches on it and runs
  // `onHydrate()` instead. Nothing is marked on the page.
  await applySnapshotData(page, stored);
  return true;
}
