// `@locked({ monotonic: true })`: a snapshot that has been acted on cannot be acted on again.
//
// A snapshot is signed, bound to its user and good for twelve hours, so a browser may send back
// any snapshot it was given in that time. For most state that is harmless: the server re-checks
// whatever matters inside the action. For a value the page itself treats as the truth (a balance,
// a step that only moves forward, a count of attempts left) it is a rewind: save the snapshot from
// before an action, run the action, then send the old snapshot back and act on it again.
//
// A component that declares a monotonic field carries one more locked value in its snapshot:
// `"<epoch>:<sequence>:<componentId>"`. The first render issues sequence 1. A frame is accepted
// only when its sequence is the next one after the last accepted for that component, and
// accepting it is one compare-and-set in the store, so of two frames sent at once carrying the
// same snapshot, one runs and the other is refused. The snapshot the action sends back carries
// the sequence after it. An action that fails without sending a snapshot back gives its claim
// back, so the snapshot the browser still holds stays good.
//
// The counters are kept in a store on the server, not in the session: a cookie session is held
// by the browser, which could send an older one back with the older snapshot. The default store
// is in this process. Its epoch is new on every start, so a snapshot issued before a restart is
// refused. Where more than one process serves Flow, install a shared store with
// `setMonotonicStore()`.
import { ZerotalError } from "@zerotal/core";
import type { Snapshot } from "./types.ts";

/** The snapshot field carrying `"<epoch>:<sequence>:<componentId>"`. Server-issued, locked, signed. */
export const MONOTONIC_FIELD = "__flowMonotonic";

/** How long a component's counter is kept: longer than a snapshot stays valid (12 h). */
const COUNTER_TTL_MS = 13 * 60 * 60 * 1000;

/**
 * Where `@locked({ monotonic: true })` keeps each component's last accepted sequence.
 *
 * @remarks
 * `compareAndSet` must be atomic across every process that serves Flow: it is what stops two
 * frames carrying the same snapshot from both running. `epoch` names the store's contents: a
 * store whose counters can be lost (an in-process map, a cache that was flushed) must change it
 * when they are, so a snapshot issued before is refused rather than taken for a first one.
 *
 * @category Security
 */
export interface MonotonicStore {
  /** Names this store's contents; a snapshot issued under another epoch is refused. */
  readonly epoch: string;
  /** The last sequence accepted for `key`, or `undefined` when none has been. */
  get(key: string): Promise<number | undefined> | number | undefined;
  /**
   * Set `key` to `next` only if it still holds `expected` (`undefined`: absent), atomically.
   * `next` of `undefined` deletes it. Resolves whether it was set.
   */
  compareAndSet(
    key: string,
    expected: number | undefined,
    next: number | undefined,
    ttlMs: number,
  ): Promise<boolean> | boolean;
}

/** The default store: a map in this process, with a new epoch on every start. */
class MemoryMonotonicStore implements MonotonicStore {
  readonly epoch = crypto.randomUUID().slice(0, 8);
  private readonly _map = new Map<string, { value: number; expiresAt: number }>();

  get(key: string): number | undefined {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this._map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  compareAndSet(
    key: string,
    expected: number | undefined,
    next: number | undefined,
    ttlMs: number,
  ): boolean {
    if (this.get(key) !== expected) return false;
    if (next === undefined) this._map.delete(key);
    else this._map.set(key, { value: next, expiresAt: Date.now() + ttlMs });
    return true;
  }

  /** Evict expired counters so the map does not grow without bound. */
  _sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this._map) if (entry.expiresAt < now) this._map.delete(key);
  }
}

let _store: MonotonicStore = new MemoryMonotonicStore();

setInterval(() => {
  if (_store instanceof MemoryMonotonicStore) _store._sweep();
}, 60 * 60_000).unref?.();

/**
 * Replace the store `@locked({ monotonic: true })` keeps its counters in. Call it once at boot
 * when more than one process serves Flow, with a store they share; see {@link MonotonicStore}.
 *
 * @category Security
 */
export function setMonotonicStore(store: MonotonicStore): void {
  _store = store;
}

/**
 * A snapshot that is genuine and the user's own, but not the newest one for its component:
 * older than one already acted on, the same one twice, or issued before the store's counters
 * were lost.
 *
 * @remarks
 * Thrown only for components with a `@locked({ monotonic: true })` field. The browser is told to
 * reload, which renders a fresh snapshot.
 */
export class FlowSnapshotReplayError extends ZerotalError {
  constructor(msg = "This page has changed since — reload it to continue.") {
    super(msg, "E_PULSE_SNAPSHOT_REPLAY", 409);
  }
}

/** What a monotonic component instance carries between the claim and the snapshot it sends back. */
interface MonotonicState {
  _flowId: string;
  /** The sequence this instance's frame was accepted with; absent on a first render. */
  _flowMonotonicAccepted?: number | undefined;
  /** Set once the instance's next snapshot has been built, so its claim is kept. */
  _flowMonotonicIssued?: boolean | undefined;
}

/**
 * The value the monotonic field carries in the snapshot being built: the sequence after the one
 * this instance was accepted with (`1` on a first render). Reading it twice gives the same value.
 *
 * @internal
 */
export function _issueMonotonicSeq(component: MonotonicState): string {
  component._flowMonotonicIssued = true;
  const next = (component._flowMonotonicAccepted ?? 0) + 1;
  return `${_store.epoch}:${next}:${component._flowId}`;
}

/**
 * A frame's accepted claim on its component's counter. {@link MonotonicClaim.settle} keeps it,
 * except for a frame that failed without the page building a new snapshot (a refused or thrown
 * action): that claim is given back, so the snapshot the browser still holds can be acted on
 * again. An action that succeeded keeps it even with no snapshot sent back (a redirect), so its
 * snapshot cannot be replayed to run it twice.
 *
 * @internal
 */
export interface MonotonicClaim {
  settle(page: MonotonicState | undefined, failed: boolean): Promise<void>;
}

/**
 * Refuse `snapshot` if its page has a monotonic field and the snapshot is not the newest one for
 * its component; otherwise claim its sequence, atomically, and stamp `page` with it so the
 * snapshot it sends back carries the next one.
 *
 * Run after the signature and the subject have been checked, before anything on the page runs.
 *
 * @returns The claim to settle once the frame is answered, or `undefined` for a page without a
 *   monotonic field.
 * @throws {@link FlowSnapshotReplayError} For a snapshot that is not the newest: older, the same
 *   one again, sent at the same moment as another carrying it, issued under another epoch, or
 *   carrying no sequence.
 * @internal
 */
export async function _claimMonotonic(
  snapshot: Snapshot,
  usesMonotonic: boolean,
  page: MonotonicState,
): Promise<MonotonicClaim | undefined> {
  if (!usesMonotonic) return undefined;
  const tuple = snapshot.data[MONOTONIC_FIELD];
  const value: unknown = tuple?.[0];
  if (typeof value !== "string") throw new FlowSnapshotReplayError();
  const [epoch, seqText, ...rest] = value.split(":");
  const id = rest.join(":");
  const seq = Number(seqText);
  if (epoch !== _store.epoch || !Number.isSafeInteger(seq) || seq < 1 || id !== snapshot.memo.id) {
    throw new FlowSnapshotReplayError();
  }

  const key = `flow:monotonic:${id}`;
  const accepted = (await _store.get(key)) ?? 0;
  if (seq !== accepted + 1) throw new FlowSnapshotReplayError();
  const previous = accepted === 0 ? undefined : accepted;
  if (!(await _store.compareAndSet(key, previous, seq, COUNTER_TTL_MS))) {
    throw new FlowSnapshotReplayError(); // another frame claimed it first
  }

  page._flowMonotonicAccepted = seq;
  page._flowMonotonicIssued = false;
  let settled = false;
  return {
    async settle(built, failed) {
      if (settled) return;
      settled = true;
      if (!failed || built?._flowMonotonicIssued === true) return;
      // No new snapshot went back: give the claim back, unless something has moved it since.
      await _store.compareAndSet(key, seq, previous, COUNTER_TTL_MS);
    },
  };
}

/** @internal Exported for tests: put back the default in-process store. */
export function _resetMonotonicStore(): void {
  _store = new MemoryMonotonicStore();
}
