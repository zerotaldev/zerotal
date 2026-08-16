// ── Time-travel devtools (client, dev-only) ───────────────────────────────────
//
// The engine already signs and delta-encodes the full component state on every round-trip,
// and the client already receives + reconstructs that snapshot for each patch. This module
// RECORDS that stream — one frame per applied patch (plus the initial mount) — into a capped
// ring buffer, and lets a dev scrub back to any frame: "jump" re-applies a held snapshot + its
// HTML to the live component (client-only, no server), so state and DOM restore exactly.
//
// It is intentionally DOM-free and dependency-free (types only) so the core is unit-testable.
// The one DOM-touching step — applying a frame to a live component — is an APPLIER function the
// bridge injects via setTimelineApplier(); everything else is pure data.

import type { Snapshot, SnapshotData } from "../types.ts";

/** One recorded step in the timeline: the component's state (and DOM) after a patch. */
export interface TimelineFrame {
  /** Monotonic global sequence number (ordering across all components). */
  seq: number;
  compId: string;
  compName: string;
  /** The action that produced this frame — a method name, `"$set"`, or `"mount"`. */
  action: string;
  /** The full signed snapshot at this frame (restored verbatim on a jump). */
  snapshot: Snapshot;
  /** Snapshot-data field names that changed since this component's previous frame. */
  changed: string[];
  /** The component's outer HTML at this frame, for DOM restore on a jump. */
  html: string | null;
  ts: number;
  /**
   * What the browser sent to produce this frame — absent for a mount, and for a
   * frame produced by anything other than a dispatched action.
   *
   * Kept so the panel can answer "what did this click actually send" without the
   * developer reading the socket. `updates` is the batch of client-side writes
   * flushed alongside the call, which is why a field can differ between frames
   * without appearing in `args`.
   */
  sent?: { args: unknown[]; updates?: Record<string, unknown> };
}

const MAX_FRAMES = 250;

let _enabled = false;
let _seq = 0;
const _frames: TimelineFrame[] = [];
const _lastDataByComp = new Map<string, SnapshotData>();
const _currentByComp = new Map<string, number>(); // compId → seq currently displayed (live = latest)
const _subs = new Set<() => void>();

/** DOM applier injected by the bridge; restores a frame's snapshot + HTML into the live component. */
type Applier = (frame: TimelineFrame) => void;
let _apply: Applier | null = null;

export function setTimelineEnabled(on: boolean): void {
  _enabled = on;
}
export function isTimelineEnabled(): boolean {
  return _enabled;
}
export function setTimelineApplier(fn: Applier): void {
  _apply = fn;
}

/** Subscribe to timeline changes (a new frame, or a jump) — used to re-render the panel. */
export function onTimelineChange(fn: () => void): void {
  _subs.add(fn);
}
function _notify(): void {
  for (const fn of _subs) {
    try {
      fn();
    } catch {
      /* a panel render error must not break recording */
    }
  }
}

/** Field names that differ between two snapshot-data maps (added, removed, or changed value). */
export function computeChanged(prev: SnapshotData | undefined, next: SnapshotData): string[] {
  const changed: string[] = [];
  for (const [k, v] of Object.entries(next)) {
    const before = prev?.[k];
    if (before === undefined || JSON.stringify(before) !== JSON.stringify(v)) changed.push(k);
  }
  if (prev) for (const k of Object.keys(prev)) if (!(k in next)) changed.push(k);
  return changed;
}

/**
 * Record a frame for a just-applied patch (or the initial mount). No-op unless enabled.
 * Computes the changed fields vs this component's previous frame and appends to the ring buffer.
 */
export function recordFrame(input: {
  compId: string;
  compName: string;
  action: string;
  snapshot: Snapshot;
  html: string | null;
  sent?: { args: unknown[]; updates?: Record<string, unknown> };
}): TimelineFrame | null {
  if (!_enabled) return null;
  const changed = computeChanged(_lastDataByComp.get(input.compId), input.snapshot.data);
  _lastDataByComp.set(input.compId, input.snapshot.data);
  const frame: TimelineFrame = {
    seq: _seq++,
    compId: input.compId,
    compName: input.compName,
    action: input.action,
    snapshot: input.snapshot,
    changed,
    html: input.html,
    ts: Date.now(),
    ...(input.sent ? { sent: input.sent } : {}),
  };
  _frames.push(frame);
  if (_frames.length > MAX_FRAMES) _frames.shift();
  _currentByComp.set(frame.compId, frame.seq); // a live frame → we're at the latest
  _notify();
  return frame;
}

export function getFrames(): readonly TimelineFrame[] {
  return _frames;
}
export function getFramesFor(compId: string): TimelineFrame[] {
  return _frames.filter((f) => f.compId === compId);
}
export function frameBySeq(seq: number): TimelineFrame | undefined {
  return _frames.find((f) => f.seq === seq);
}
export function latestFrameFor(compId: string): TimelineFrame | undefined {
  for (let i = _frames.length - 1; i >= 0; i--)
    if (_frames[i]!.compId === compId) return _frames[i];
  return undefined;
}
/** The seq currently displayed for a component (its latest frame unless the user jumped back). */
export function currentSeq(compId: string): number | undefined {
  return _currentByComp.get(compId);
}
/** True when the component is showing its most recent frame (not rewound). */
export function isLive(compId: string): boolean {
  const latest = latestFrameFor(compId);
  return !latest || _currentByComp.get(compId) === latest.seq;
}

/** Restore the component to the frame with this seq (client-only). Returns false if unavailable. */
export function jumpTo(seq: number): boolean {
  const f = frameBySeq(seq);
  if (!f || !_apply) return false;
  _apply(f);
  _currentByComp.set(f.compId, seq);
  _notify();
  return true;
}

/** Return a rewound component to its most recent frame. */
export function resumeLive(compId: string): boolean {
  const f = latestFrameFor(compId);
  return f ? jumpTo(f.seq) : false;
}

/** @internal Test hook — clear all recorded state. */
export function _resetTimeline(): void {
  _seq = 0;
  _frames.length = 0;
  _lastDataByComp.clear();
  _currentByComp.clear();
  _subs.clear();
  _apply = null;
  _enabled = false;
}
