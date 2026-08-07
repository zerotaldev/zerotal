import type { Component } from "./Component.ts";
import type { Snapshot, SnapshotData } from "./types.ts";
import { serializeValue, deserializeValue } from "./synths/index.ts";
import {
  getComputedKeys,
  getTransientKeys,
  getExposedProps,
  getLockedProps,
  getUrlProps,
  getListeners,
  getPresenceProps,
  resolvePresenceChannel,
  getSharedProps,
  resolveSharedChannel,
} from "./decorators.ts";
import { ZerotalError, safeEqual, hmacHex, RequestContext } from "@zerotal/core";

// ── Stable JSON stringify ─────────────────────────────────────────────────────
// Keys are sorted so the HMAC is deterministic regardless of insertion order.

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(value as object).sort()) {
    sorted[k] = (value as Record<string, unknown>)[k];
  }
  return JSON.stringify(sorted, (_key, v: unknown) =>
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );
}

// ── HMAC helpers ──────────────────────────────────────────────────────────────

function _appKey(): string {
  const key = Bun.env["APP_KEY"];
  if (!key) throw new Error("[Flow] APP_KEY is not set. Snapshot signing requires APP_KEY.");
  return key;
}

function _sign(payload: string): string {
  return hmacHex(payload, _appKey());
}

function _verify(payload: string, checksum: string): boolean {
  // Constant-time comparison via the shared helper (its length pre-check is
  // safe here — the digest length is a fixed public constant).
  return safeEqual(_sign(payload), checksum);
}

// ── Identity binding ──────────────────────────────────────────────────────────

/**
 * How long a snapshot stays valid after being issued. 12 hours comfortably outlives any
 * real page session while putting an end to a captured one.
 */
export const SNAPSHOT_MAX_AGE_SECONDS = 12 * 60 * 60;

/**
 * The authenticated user a snapshot is being issued to, or `undefined` for an anonymous
 * request. Read structurally: `@zerotal/flow` does not depend on `@zerotal/auth`.
 * @internal
 */
function currentSubject(): string | undefined {
  const ctx = RequestContext.tryGet() as { user?: { id?: unknown } | null } | undefined;
  const id = ctx?.user?.id;
  return id === undefined || id === null ? undefined : String(id);
}

// ── Signing payload ───────────────────────────────────────────────────────────
// children and listeners are excluded from signing:
//   - children: Livewire pattern — ids are derived server-side, never trusted from client
//   - listeners: server-derived from class decorators, cannot meaningfully be tampered
//     with (@on methods are still validated against @expose allowlist on every call)

function _signingPayload(snapshot: Omit<Snapshot, "checksum">): string {
  const memo = { ...snapshot.memo, children: undefined, listeners: undefined };
  return stableStringify({ data: snapshot.data, memo });
}

// ── Dehydration ───────────────────────────────────────────────────────────────

export function dehydrate(
  page: Component,
  memo: Pick<Snapshot["memo"], "id" | "name" | "path"> & {
    children?: Snapshot["memo"]["children"];
  },
): Snapshot {
  const computedKeys = getComputedKeys(page);
  const transientKeys = getTransientKeys(page);
  const exposedProps = getExposedProps(page);
  const lockedProps = getLockedProps(page);
  const urlProps = getUrlProps(page);
  const data: SnapshotData = {};

  // Only @expose-d and @locked properties cross the network boundary.
  const serializable = new Set([...exposedProps, ...lockedProps]);

  for (const key of serializable) {
    if (computedKeys.has(key)) continue;
    if (transientKeys.has(key)) continue;
    const val = (page as unknown as Record<string, unknown>)[key];
    if (typeof val === "function") continue;

    const [serialized, meta] = serializeValue(val);

    // Mark @locked properties so the client proxy refuses writes to them.
    if (lockedProps.has(key)) {
      meta["locked"] = true;
    }

    // Merge @url metadata into the synth tuple meta so the client knows
    // which props to sync to the URL query string and how.
    const urlOpts = urlProps.get(key);
    if (urlOpts) {
      meta["url"] = { as: urlOpts.as ?? key, history: urlOpts.history ?? "replace" };
    }

    data[key] = [serialized, meta];
  }

  // Collect @on listeners for the client event router.
  // Excluded from HMAC signing (server-derived, can't usefully be tampered with).
  const listenersMap = getListeners(page.constructor as { prototype: object });
  const listeners = listenersMap.size > 0 ? Object.fromEntries(listenersMap) : undefined;

  // Named slot HTML passed down by the parent. Signed (server-generated), and carried
  // so the child can re-render its own actions with the slot content intact.
  const slots = Object.keys(page._flowSlots).length > 0 ? page._flowSlots : undefined;

  // @presence props → resolved channel, so the client subscribes to the right presence
  // channel(s). Signed (server-resolved from the component). Empty when none.
  const presenceMap = getPresenceProps(page);
  const presence =
    presenceMap.size > 0
      ? [...presenceMap].map(([prop, channel]) => ({
          prop,
          channel: resolvePresenceChannel(channel, page),
        }))
      : undefined;

  // @shared props → resolved channel, so the client subscribes and converges on change.
  // Signed (server-resolved from the component). Empty when none.
  const sharedMap = getSharedProps(page);
  const shared =
    sharedMap.size > 0
      ? [...sharedMap].map(([prop, channel]) => ({
          prop,
          channel: resolveSharedChannel(channel, page),
        }))
      : undefined;

  // Children collected during the render that preceded this dehydrate call.
  // Excluded from HMAC (Livewire pattern).
  const snapshotMemo: Snapshot["memo"] = {
    ...memo,
    children: [...page._childIds],
    listeners,
    slots,
    presence,
    shared,
    sub: currentSubject(),
    iat: Math.floor(Date.now() / 1000),
  };
  const partial = { data, memo: snapshotMemo };
  const checksum = _sign(_signingPayload(partial));

  return { data, memo: snapshotMemo, checksum };
}

// ── Hydration ─────────────────────────────────────────────────────────────────

export class FlowIntegrityError extends ZerotalError {
  constructor(msg = "Invalid snapshot checksum") {
    super(msg, "E_PULSE_INTEGRITY", 400);
  }
}

/**
 * A snapshot whose signature is genuine but which does not belong to this requester, or
 * which has aged out. Distinct from {@link FlowIntegrityError} because the cause and the
 * fix are different: nothing was tampered with, the snapshot is simply not yours.
 */
export class FlowSnapshotOwnershipError extends ZerotalError {
  constructor(msg = "Snapshot was not issued to this session") {
    super(msg, "E_PULSE_SNAPSHOT_OWNER", 403);
  }
}

export async function hydrate<T extends Component>(
  snapshot: Snapshot,
  PageClass: new () => T,
): Promise<T> {
  // 1. Verify HMAC (children and listeners excluded from signing).
  if (!verifySnapshot(snapshot)) {
    throw new FlowIntegrityError();
  }

  // 2. Verify the snapshot belongs to whoever is asking, and has not aged out. The HMAC
  //    proves integrity, not ownership — a genuine signature over someone else's state is
  //    still someone else's state.
  assertSnapshotSubject(snapshot);

  // 3. Fresh blank instance — constructor runs but onMount() is skipped.
  const page = new PageClass();
  (page as Record<string, unknown>)["_skipMount"] = true;

  // 4. Restore slots + each property (see applySnapshotData).
  await applySnapshotData(page, snapshot);

  return page;
}

/** Verify a snapshot's HMAC against the current APP_KEY. Public so durable-snapshot
 *  restore can validate a stored snapshot before trusting it (a rotated key → false). */
export function verifySnapshot(snapshot: Snapshot): boolean {
  return _verify(_signingPayload(snapshot), snapshot.checksum);
}

/**
 * Assert that a snapshot was issued to whoever is making the current request, and has not
 * aged out.
 *
 * A signature says the bytes are unmodified. It does not say whose bytes they are — so
 * `@locked accountId = 42`, which the docs describe as tamper-proof server-authoritative
 * state, was replayable by any other authenticated user who came by a snapshot signed for
 * someone else. Middleware re-runs on every frame, so authentication is genuinely
 * re-checked; what it could not catch is that the *state* belonged to a different person.
 *
 * An anonymous-issued snapshot stays usable by anonymous requests only, and vice versa: a
 * snapshot's subject changing means the identity changed, and identity changes are exactly
 * when carried-over state should stop being trusted.
 *
 * @param snapshot - The snapshot about to be hydrated.
 * @throws {@link FlowSnapshotOwnershipError} When the subject does not match or the
 *   snapshot is older than {@link SNAPSHOT_MAX_AGE_SECONDS}.
 */
export function assertSnapshotSubject(snapshot: Snapshot): void {
  if (snapshot.memo.sub !== currentSubject()) {
    throw new FlowSnapshotOwnershipError();
  }
  const iat = snapshot.memo.iat;
  if (typeof iat !== "number" || Math.floor(Date.now() / 1000) - iat > SNAPSHOT_MAX_AGE_SECONDS) {
    throw new FlowSnapshotOwnershipError("Snapshot has expired — reload the page.");
  }
}

/**
 * Restore a snapshot's slots + property values into an EXISTING component instance (the
 * deserialize half of {@link hydrate}, without the fresh-instance/HMAC steps). Used by the
 * durable-snapshot resume path, which restores into a page that already ran onBoot().
 */
export async function applySnapshotData(page: Component, snapshot: Snapshot): Promise<void> {
  // Restore parent-supplied slot HTML so this.slot(name) works. Signed in the memo.
  if (snapshot.memo.slots) page._flowSlots = { ...snapshot.memo.slots };
  // Restore each property through its synthesizer.
  await Promise.all(
    Object.entries(snapshot.data).map(async ([key, [data, meta]]) => {
      (page as unknown as Record<string, unknown>)[key] = await deserializeValue(data, meta);
    }),
  );
}

// ── Snapshot delta encoding ───────────────────────────────────────────────────

/** The wire form of a snapshot delta — only what changed, plus the new identity/checksum. */
export interface SnapshotDelta {
  memo: Snapshot["memo"];
  checksum: string;
  /** Changed (or newly added) `[value, meta]` tuples, keyed by property name. */
  dataDelta: SnapshotData;
  /** Property names present in `prev` but gone from `next`. */
  dataRemoved: string[];
}

/**
 * Diff two snapshots into the minimal set of changes to transmit. `next` is the freshly
 * dehydrated state; `prev` is the client's own snapshot (its `data` is exactly what the
 * client holds), so applying this delta to `prev.data` reproduces `next.data` value-for-
 * value — and the carried `next.checksum` (signed over the full `next.data`) therefore
 * verifies when the client sends the reconstructed snapshot back on its next action.
 */
export function encodeSnapshotDelta(prev: Snapshot, next: Snapshot): SnapshotDelta {
  const dataDelta: SnapshotData = {};
  for (const [key, tuple] of Object.entries(next.data)) {
    const before = prev.data[key];
    if (before === undefined || JSON.stringify(before) !== JSON.stringify(tuple)) {
      dataDelta[key] = tuple;
    }
  }
  const dataRemoved: string[] = [];
  for (const key of Object.keys(prev.data)) {
    if (!(key in next.data)) dataRemoved.push(key);
  }
  return { memo: next.memo, checksum: next.checksum, dataDelta, dataRemoved };
}

/**
 * Rebuild a full snapshot from a prior snapshot and a delta (mirror of
 * {@link encodeSnapshotDelta}). Used on the client, and by tests to prove the
 * reconstruction verifies. Pure — does not mutate `prev`.
 */
export function applySnapshotDelta(prev: Snapshot, delta: SnapshotDelta): Snapshot {
  const data: SnapshotData = { ...prev.data };
  for (const key of delta.dataRemoved) delete data[key];
  Object.assign(data, delta.dataDelta);
  return { data, memo: delta.memo, checksum: delta.checksum };
}

// ── Snapshot size warning (dev mode) ─────────────────────────────────────────

const SNAPSHOT_WARN_BYTES = 100 * 1024; // 100 KB

export function warnIfLarge(snapshot: Snapshot, name: string): void {
  const env = Bun.env["APP_ENV"] ?? "development";
  if (env === "production" || env === "prod") return;

  // Buffer.byteLength is a native call that avoids allocating a typed array.
  const size = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
  if (size > SNAPSHOT_WARN_BYTES) {
    console.warn(
      `\n[Flow] Warning: ${name} snapshot is ${Math.round(size / 1024)} KB.\n` +
        `Large snapshots slow every round trip. Consider:\n` +
        `  → @transient on display-only collections (re-load them inside the action that needs them)\n` +
        `  → Storing only IDs in state; eager-loading records inside individual actions\n` +
        `  → @computed for values derivable from other state\n`,
    );
  }
}
