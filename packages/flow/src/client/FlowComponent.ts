// ── Client-side component state model ────────────────────────────────────────
//
// Mirrors Livewire v3's three-copy state model:
//   canonical  — last confirmed server state (used for diffing)
//   ephemeral  — current local state (may have unsent mutations from flow:model)
//   reactive   — Alpine.reactive(ephemeral) — what DOM expressions read
//
// When a server patch arrives, we diff canonical vs. new to determine what
// changed and patch reactive in-place — preserving Alpine reactivity subscriptions
// instead of wholesale replacement.

import type { Snapshot, SnapshotData } from "../types.ts";

export type ReactiveProxy = Record<string, unknown>;

/** Extract plain JS values from snapshot data (strip synth meta). */
function extractValues(data: SnapshotData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, [val]] of Object.entries(data)) {
    result[key] = val;
  }
  return result;
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Recursively diff old/new and patch reactive in-place. */
function diffAndPatch(
  oldVal: Record<string, unknown>,
  newVal: Record<string, unknown>,
  reactive: Record<string, unknown>,
): void {
  for (const [k, next] of Object.entries(newVal)) {
    if (JSON.stringify(oldVal[k]) !== JSON.stringify(next)) {
      // Deep-clone objects so that reactive mutations (from user input via flow:model)
      // do not alias back into canonical/snapshot, which share the same references
      // via extractValues. Without cloning, typing in a flow:model input would corrupt
      // comp.snapshot.data causing the HMAC to fail on the next server call.
      reactive[k] = typeof next === "object" && next !== null ? deepClone(next) : next;
    }
  }
  // Remove keys that no longer exist
  for (const k of Object.keys(oldVal)) {
    if (!(k in newVal)) {
      delete reactive[k];
    }
  }
}

export class FlowComponent {
  readonly id: string;
  readonly name: string;
  readonly rootEl: HTMLElement;

  canonical: Record<string, unknown>;
  ephemeral: Record<string, unknown>;
  reactive: ReactiveProxy;

  snapshot: Snapshot;

  constructor(rootEl: HTMLElement, snapshot: Snapshot) {
    this.id = snapshot.memo.id;
    this.name = snapshot.memo.name;
    this.rootEl = rootEl;
    this.snapshot = snapshot;

    this.canonical = extractValues(snapshot.data);
    this.ephemeral = deepClone(this.canonical);

    // Alpine.reactive is available globally once Alpine starts
    this.reactive = (
      window as unknown as { Alpine: { reactive(o: object): ReactiveProxy } }
    ).Alpine.reactive(this.ephemeral);
  }

  /** Apply a server patch: update snapshot, diff-patch reactive, update script tag. */
  mergeServerPatch(newSnapshot: Snapshot): void {
    const newCanonical = extractValues(newSnapshot.data);
    // Compare the current reactive state (not just canonical) so that lazy
    // flow:model fields that diverged during typing are corrected when the
    // server returns the authoritative value (e.g., clearing draft after add()).
    // Using a plain-object snapshot avoids mutating the comparison source
    // while diffAndPatch iterates it for key-removal.
    const reactiveSnapshot = { ...this.reactive } as Record<string, unknown>;
    diffAndPatch(reactiveSnapshot, newCanonical, this.reactive);
    this.canonical = newCanonical;
    this.ephemeral = deepClone(newCanonical);
    this.snapshot = newSnapshot;

    // Keep the embedded <script id="flow-state-*"> in sync
    const script = document.getElementById(`flow-state-${this.id}`);
    if (script) script.textContent = JSON.stringify(newSnapshot);
  }
}
