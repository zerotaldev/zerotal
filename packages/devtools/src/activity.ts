/**
 * What the application did when nobody was making a request.
 *
 * A scheduled task that fails at 03:00 leaves no trace in the tool whose job is
 * to show you what your app did — because every surface in the panel until now
 * hangs off an `HttpContext`, and a console command and a cron tick have none.
 * `CommandRan`, `TaskRan`, `TaskFailed` and `TaskSkipped` were all on the bus and
 * all went nowhere.
 *
 * A small ring of its own rather than a channel, for the reason channels exist:
 * a channel entry belongs to a request. These belong to the process.
 */
import { FrameworkEvents } from "@zerotal/core";
import type { CommandRan } from "@zerotal/core";

/** One thing the app did outside a request. */
export interface ActivityEntry {
  kind: "command" | "task";
  name: string;
  /** `ok`, `failed`, or why a task was skipped. */
  outcome: string;
  durationMs: number;
  /** Unix milliseconds, so the panel can show when rather than only what. */
  at: number;
  failed: boolean;
  detail?: string;
}

/**
 * How many entries to keep.
 *
 * A long-lived dev server running a per-minute schedule produces 1,440 of these
 * a day; the useful window is the last few dozen. Unbounded here would be a
 * memory leak with a friendly name.
 */
const MAX_ENTRIES = 200;

let _entries: ActivityEntry[] = [];

/** Newest first, as the panel draws them. */
export function activityFeed(): ActivityEntry[] {
  return [..._entries].reverse();
}

/** @internal — drop everything (provider teardown, tests). */
export function _resetActivity(): void {
  _entries = [];
}

function push(entry: ActivityEntry): void {
  _entries.push(entry);
  if (_entries.length > MAX_ENTRIES) _entries.shift();
}

/**
 * Subscribe to the non-HTTP lifecycle events.
 *
 * The scheduler's events are subscribed **by kind string** rather than by class:
 * `@zerotal/scheduler` is an optional package, and importing its event classes
 * to name them would make devtools depend on it. The bus supports either door
 * and a string subscription costs nothing when nothing ever emits.
 *
 * @returns A disposer that removes every subscription.
 */
export function startActivityCapture(): () => void {
  const unsubs = [
    FrameworkEvents.on<CommandRan>("CommandRan", (e) => {
      push({
        kind: "command",
        name: e.name,
        outcome: e.ok ? "ok" : `exit ${e.exitCode}`,
        durationMs: e.durationMs,
        at: Date.now(),
        failed: !e.ok,
        ...(e.error ? { detail: e.error } : {}),
      });
    }),
    FrameworkEvents.on<{ name: string; durationMs: number; ok: boolean }>("TaskRan", (e) => {
      push({
        kind: "task",
        name: e.name,
        outcome: e.ok ? "ok" : "failed",
        durationMs: e.durationMs,
        at: Date.now(),
        failed: !e.ok,
      });
    }),
    FrameworkEvents.on<{ name: string; durationMs: number; error: string }>("TaskFailed", (e) => {
      push({
        kind: "task",
        name: e.name,
        outcome: "failed",
        durationMs: e.durationMs,
        at: Date.now(),
        failed: true,
        detail: e.error,
      });
    }),
    FrameworkEvents.on<{ name: string; reason: string }>("TaskSkipped", (e) => {
      push({
        kind: "task",
        name: e.name,
        // Why it skipped is the whole content of the event: "skipped" alone
        // sends you looking for a bug in a task that was told not to run.
        outcome: `skipped · ${e.reason}`,
        durationMs: 0,
        at: Date.now(),
        failed: false,
      });
    }),
  ];

  return () => {
    for (const unsub of unsubs) unsub();
  };
}
