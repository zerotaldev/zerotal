// `@locked({ monotonic: true })`: a snapshot that has been acted on cannot be acted on again.
//
// A snapshot is signed, bound to its user and good for twelve hours, so a browser may send back
// any snapshot it was given in that time. For most state that is harmless: the server re-checks
// whatever matters inside the action. For a value the page itself treats as the truth (a balance,
// a step that only moves forward, a count of attempts left) it is a rewind: save the snapshot from
// before an action, run the action, then send the old snapshot back and act on it again.
//
// A component that declares a monotonic field carries one more locked value in its snapshot:
// `"<epoch>:<sequence>:<mount>:<componentId>"`. The first render issues sequence 1. A frame is accepted
// only when its sequence is the next one after the last accepted for that component, and
// accepting it is one compare-and-set in the store, so of two frames sent at once carrying the
// same snapshot, one runs and the other is refused. The snapshot the action sends back carries
// the sequence after it. A call refused before any of the page's code ran (no field written,
// no built-in, no action body) gives its claim back, so the snapshot the browser still holds
// stays good; otherwise the claim is kept, and a refusal sends the page's snapshot back.
//
// The counters are kept in a store on the server, not in the session: a cookie session is held
// by the browser, which could send an older one back with the older snapshot. The default store
// is in this process. Its epoch is new on every start, so a snapshot issued before a restart is
// refused. Where more than one process serves Flow, install a shared store with
// `setMonotonicStore()`.
import { ZerotalError } from "@zerotal/core";
import type { Snapshot } from "./types.ts";

/** The snapshot field carrying `"<epoch>:<sequence>:<mount>:<componentId>"`. Server-issued, locked, signed. */
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
  /**
   * Names this mount of the component. A child's id is the same each time its parent renders it,
   * so a child removed and added again would meet its old counter; each mount has its own.
   */
  _flowMonotonicMount?: string | undefined;
  /** Set while a running `@task` streams a partial snapshot, whose sequence cannot be claimed. */
  _flowMonotonicPartial?: boolean | undefined;
  /** Set once the action body has started: from then on the claim is kept, whatever happens. */
  _flowMonotonicRan?: boolean | undefined;
}

/** The tokens of snapshots sent back to a browser in a patch, until their frame is settled. */
const _sent = new Set<string>();

/**
 * The value the monotonic field carries in the snapshot being built: the sequence after the one
 * this instance was accepted with (`1` on a first render). Reading it twice gives the same value.
 * A partial snapshot a running `@task` streams carries sequence `0`, which is never accepted, so
 * only the task's final snapshot can be acted on.
 *
 * @internal
 */
export function _issueMonotonicSeq(component: MonotonicState): string {
  component._flowMonotonicMount ??= crypto.randomUUID().slice(0, 8);
  const next =
    component._flowMonotonicPartial === true ? 0 : (component._flowMonotonicAccepted ?? 0) + 1;
  return `${_store.epoch}:${next}:${component._flowMonotonicMount}:${component._flowId}`;
}

/**
 * Run `build` with `page` marked as streaming a partial snapshot. See {@link _issueMonotonicSeq}.
 *
 * @internal
 */
export function _asPartialSnapshot<T>(page: object, build: () => T): T {
  Reflect.set(page, "_flowMonotonicPartial", true);
  try {
    return build();
  } finally {
    Reflect.set(page, "_flowMonotonicPartial", false);
  }
}

/**
 * Mark `page`'s action body as started: its claim is kept from now on, so a snapshot whose
 * action ran cannot be sent back to run it again, even when something after it throws.
 *
 * @internal
 */
export function _markActionRan(page: object): void {
  Reflect.set(page, "_flowMonotonicRan", true);
}

/**
 * Record that `snapshot` went back to the browser in a patch, so the claim of the frame that
 * built it is kept even when the frame then failed.
 *
 * @internal
 */
export function _noteSnapshotSent(snapshot: Snapshot): void {
  const value: unknown = snapshot.data[MONOTONIC_FIELD]?.[0];
  if (typeof value === "string") _sent.add(value);
}

/**
 * A frame's accepted claim on its component's counter. {@link MonotonicClaim.settle} keeps it,
 * except for a frame that failed before its action body started and sent no snapshot back (a
 * refused call): that claim is given back, so the snapshot the browser still holds can be acted
 * on again. Once the action body has started, the claim is kept, a redirect and a later error
 * included, so its snapshot cannot be replayed to run the action twice.
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
 *   one again, sent at the same moment as another carrying it, a `@task`'s partial one, issued
 *   under another epoch, or carrying no sequence.
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
  const [epoch, seqText, mount, ...rest] = value.split(":");
  const id = rest.join(":");
  const seq = Number(seqText);
  if (
    epoch !== _store.epoch ||
    !Number.isSafeInteger(seq) ||
    seq < 1 ||
    !mount ||
    id !== snapshot.memo.id
  ) {
    throw new FlowSnapshotReplayError();
  }

  const key = `flow:monotonic:${id}:${mount}`;
  const accepted = (await _store.get(key)) ?? 0;
  if (seq !== accepted + 1) throw new FlowSnapshotReplayError();
  const previous = accepted === 0 ? undefined : accepted;
  if (!(await _store.compareAndSet(key, previous, seq, COUNTER_TTL_MS))) {
    throw new FlowSnapshotReplayError(); // another frame claimed it first
  }

  page._flowMonotonicAccepted = seq;
  page._flowMonotonicMount = mount;
  page._flowMonotonicRan = false;
  const reply = `${epoch}:${seq + 1}:${mount}:${id}`;
  let settled = false;
  return {
    async settle(built, failed) {
      if (settled) return;
      settled = true;
      const sentBack = _sent.delete(reply);
      if (!failed || sentBack || built?._flowMonotonicRan === true) return;
      // Refused before the action ran, and nothing sent back: give the claim back, unless
      // something has moved it since.
      await _store.compareAndSet(key, seq, previous, COUNTER_TTL_MS);
    },
  };
}

/** @internal Exported for tests: put back the default in-process store. */
export function _resetMonotonicStore(): void {
  _store = new MemoryMonotonicStore();
  _sent.clear();
}

/**
 * Give `page`, rebuilt from `snapshot` outside a frame, the monotonic state that snapshot was
 * issued with, so a snapshot built from it again carries the same sequence and mount. A test
 * harness that changes a field as setup re-signs the snapshot this way; without it the new
 * snapshot would start a fresh count the store has never seen, and every later action would
 * be refused as a replay.
 *
 * @internal
 */
export function _carryMonotonic(snapshot: Snapshot, page: object): void {
  const value: unknown = snapshot.data[MONOTONIC_FIELD]?.[0];
  if (typeof value !== "string") return;
  const [, seqText, mount] = value.split(":");
  const seq = Number(seqText);
  if (!mount || !Number.isSafeInteger(seq) || seq < 1) return;
  Reflect.set(page, "_flowMonotonicMount", mount);
  Reflect.set(page, "_flowMonotonicAccepted", seq - 1);
}
