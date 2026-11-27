// `@locked({ monotonic: true })`: a snapshot that has been acted on cannot be acted on again.
//
// A snapshot is signed, bound to its user and good for twelve hours, so a browser may send back
// any snapshot it was given in that time. For most state that is harmless: the server re-checks
// whatever matters inside the action. For a value the page itself treats as the truth (a balance,
// a step that only moves forward, a count of attempts left) it is a rewind: save the snapshot from
// before an action, run the action, then send the old snapshot back and act on it again.
//
// A component that declares a monotonic field carries one more locked value in its snapshot, a
// sequence number issued from a counter kept in the session. Each component instance has its own
// counter, keyed by its id. A frame is accepted only when its number is higher than the last one
// accepted for that component, so once a newer snapshot has been acted on, no older one (and not
// the same one twice) is accepted again.
import { RequestContext, ZerotalError } from "@zerotal/core";
import type { Snapshot } from "./types.ts";

/** The snapshot field carrying `"<sequence>:<componentId>"`. Server-issued, locked, signed. */
export const MONOTONIC_FIELD = "__flowMonotonic";

/** The session key holding every component's counter. */
const SESSION_KEY = "flow:monotonic";

/** Counters kept per session. The least recently used beyond this are dropped. */
const MAX_TRACKED = 32;

/** `[issued, accepted, touchedAt]` for one component id. */
type Counter = [number, number, number];

type SessionLike = { get(k: string): unknown; set(k: string, v: unknown): void };

/**
 * A snapshot that is genuine and the user's own, but older than one already acted on.
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

function _session(): SessionLike | undefined | null {
  const ctx = RequestContext.tryGet();
  if (!ctx) return null; // no request at all: a unit test rendering a component
  const session: unknown = Reflect.get(ctx, "session");
  if (
    session !== null &&
    typeof session === "object" &&
    typeof Reflect.get(session, "get") === "function" &&
    typeof Reflect.get(session, "set") === "function"
  ) {
    return session as SessionLike;
  }
  return undefined;
}

function _counters(session: SessionLike): Record<string, Counter> {
  const stored = session.get(SESSION_KEY);
  return stored !== null && typeof stored === "object" ? { ...(stored as object) } : {};
}

function _save(session: SessionLike, counters: Record<string, Counter>): void {
  const ids = Object.keys(counters);
  if (ids.length > MAX_TRACKED) {
    ids
      .sort((a, b) => counters[a]![2] - counters[b]![2])
      .slice(0, ids.length - MAX_TRACKED)
      .forEach((id) => delete counters[id]);
  }
  session.set(SESSION_KEY, counters);
}

/**
 * The next sequence number for `component`, as `"<sequence>:<componentId>"`. Read by dehydration
 * through the accessor `@locked({ monotonic: true })` installs, so every snapshot issued carries
 * a higher number than the last.
 *
 * Outside a request (a unit test) the number is `0` and nothing is recorded.
 *
 * @throws When there is a request but no session to keep the counter in.
 * @internal
 */
export function _issueMonotonicSeq(component: { _flowId: string; constructor: unknown }): string {
  const id = component._flowId;
  const session = _session();
  if (session === null) return `0:${id}`;
  if (session === undefined) {
    const name = (component.constructor as { name?: string }).name ?? "A component";
    throw new Error(
      `[Flow] ${name} has a @locked({ monotonic: true }) field, which keeps a counter in the ` +
        `session, and this request has none. Add SessionMiddleware to the route's middleware ` +
        `(and to flow.persistentMiddleware, where it is by default).`,
    );
  }
  const counters = _counters(session);
  const [issued, accepted] = counters[id] ?? [0, 0, 0];
  const next = Math.max(issued, accepted) + 1;
  counters[id] = [next, accepted, Date.now()];
  _save(session, counters);
  return `${next}:${id}`;
}

/**
 * Refuse `snapshot` if `PageClass` has a monotonic field and the snapshot is not newer than the
 * last one accepted for its component. Records it as accepted otherwise.
 *
 * Run after the signature and the subject have been checked, before anything on the page runs.
 *
 * @throws {@link FlowSnapshotReplayError} For an older or repeated snapshot, one carrying no
 *   sequence, one whose counter is gone from the session, or when there is no session.
 * @internal
 */
export function _assertMonotonic(snapshot: Snapshot, usesMonotonic: boolean): void {
  if (!usesMonotonic) return;
  const tuple = snapshot.data[MONOTONIC_FIELD];
  const value: unknown = tuple?.[0];
  if (typeof value !== "string") throw new FlowSnapshotReplayError();
  const colon = value.indexOf(":");
  const seq = Number(value.slice(0, colon));
  const id = value.slice(colon + 1);
  if (colon < 1 || !Number.isSafeInteger(seq) || id !== snapshot.memo.id) {
    throw new FlowSnapshotReplayError();
  }

  const session = _session();
  if (!session) throw new FlowSnapshotReplayError();
  const counters = _counters(session);
  const counter = counters[id];
  // A missing counter is a session that was reset or one that dropped it as least recently
  // used: nothing says this snapshot is the newest, so it is not trusted.
  if (!counter || seq <= counter[1] || seq > counter[0]) throw new FlowSnapshotReplayError();
  counters[id] = [counter[0], seq, Date.now()];
  _save(session, counters);
}
