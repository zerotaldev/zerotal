/**
 * Durable schedule run history.
 *
 * A cron task that quietly stopped firing looks identical to one with nothing to
 * do, and the in-memory `lastRunAt` on each task dies with the process — so
 * "did the retention sweep run last night?" had no answer after a restart. Every
 * run (success or failure) is appended to a capped JSONL file under `storage/`,
 * the same storage-root convention the framework's own log trail uses: durable
 * across restarts, no database dependency, greppable in an emergency.
 *
 * Reading it: `bun zt schedule:runs`, the monitor panel's scheduled-tasks
 * section, or {@link ScheduleRunStore.recent} in code. Swap the store by
 * rebinding `scheduler.runs` in the container.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { FrameworkEvents } from "@zerotal/core";
import type { Application } from "@zerotal/core";
import { TaskRan, TaskFailed } from "./events.ts";

/** One completed execution of a scheduled task. */
export interface ScheduleRunRecord {
  /** Task name, as shown by `schedule:list`. */
  name: string;
  /** When the run started (ISO 8601). */
  startedAt: string;
  /** When the run finished (ISO 8601). */
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  /** The thrown error's message, present only when `ok` is false. */
  error?: string;
}

/** Where completed runs are recorded and read back. Rebind `scheduler.runs` to replace. */
export interface ScheduleRunStore {
  record(run: ScheduleRunRecord): void;
  /** Most recent runs, newest first, optionally filtered to one task name. */
  recent(limit?: number, name?: string): ScheduleRunRecord[];
  /** The most recent run of one task, or undefined if none is on record. */
  lastFor(name: string): ScheduleRunRecord | undefined;
}

// The binding is declared here, next to its type, so every consumer resolves it typed.
declare module "@zerotal/core" {
  interface ContainerBindings {
    "scheduler.runs": ScheduleRunStore;
  }
}

/** `scheduler.runLog` config (read from `config/scheduler.ts` when present). */
export interface RunLogConfig {
  /** Default: on, except under `APP_ENV=test` (mirroring the file log trail). */
  enabled: boolean;
  /** JSONL file path, relative to the app root. */
  path: string;
  /** Records kept after compaction; the file is compacted at 2× this. */
  keep: number;
}

/** @internal */
export const DEFAULT_RUN_LOG_PATH = "storage/framework/schedule-runs.jsonl";
/** @internal */
export const DEFAULT_RUN_LOG_KEEP = 500;

/**
 * Resolve `scheduler.runLog` config with defaults, tolerating an absent config binding.
 *
 * @internal
 */
export function resolveRunLogConfig(app: Application): RunLogConfig {
  let raw: { enabled?: boolean; path?: string; keep?: number } = {};
  try {
    const config = app.container.makeSync("config") as { get(key: string): unknown };
    raw = (config.get("scheduler.runLog") ?? {}) as typeof raw;
  } catch {
    /* config not resolvable — use the defaults */
  }
  return {
    // eslint-disable-next-line no-restricted-syntax -- asks about the test runtime mode, not the deployment
    enabled: raw.enabled ?? Bun.env["APP_ENV"] !== "test",
    path: raw.path ?? DEFAULT_RUN_LOG_PATH,
    keep: Math.max(1, raw.keep ?? DEFAULT_RUN_LOG_KEEP),
  };
}

/**
 * JSONL-backed run store. Appends are synchronous — runs happen at cron cadence,
 * not request cadence, and a record that survives a crash is the whole point.
 *
 * @internal
 */
export class FileScheduleRunStore implements ScheduleRunStore {
  constructor(
    private readonly _path: string,
    private readonly _keep: number = DEFAULT_RUN_LOG_KEEP,
  ) {}

  record(run: ScheduleRunRecord): void {
    mkdirSync(dirname(this._path), { recursive: true });
    // Read-before-append: the file is capped and appends happen at cron cadence,
    // so the read is cheap — and it repairs a torn tail every time. A crash
    // mid-append (this process or a sibling) leaves no trailing newline, and
    // appending straight on would merge this record into the torn line and lose
    // them both.
    let text = "";
    try {
      text = readFileSync(this._path, "utf8");
    } catch {
      /* no file yet */
    }
    const prefix = text.length > 0 && !text.endsWith("\n") ? "\n" : "";
    appendFileSync(this._path, prefix + JSON.stringify(run) + "\n");
    // Compact at 2× the cap so the rewrite cost is amortised, not per-append.
    if (FileScheduleRunStore._parse(text).length + 1 >= this._keep * 2) this._compact();
  }

  recent(limit = 50, name?: string): ScheduleRunRecord[] {
    let runs = this._readAll();
    if (name !== undefined) runs = runs.filter((r) => r.name === name);
    return runs.slice(-Math.max(1, limit)).reverse();
  }

  lastFor(name: string): ScheduleRunRecord | undefined {
    return this.recent(1, name)[0];
  }

  private _readAll(): ScheduleRunRecord[] {
    let text: string;
    try {
      text = readFileSync(this._path, "utf8");
    } catch {
      return []; // no file yet
    }
    return FileScheduleRunStore._parse(text);
  }

  private static _parse(text: string): ScheduleRunRecord[] {
    const runs: ScheduleRunRecord[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        runs.push(JSON.parse(line) as ScheduleRunRecord);
      } catch {
        /* a torn line (crash mid-append) is dropped, not fatal */
      }
    }
    return runs;
  }

  private _compact(): void {
    const keep = this._readAll().slice(-this._keep);
    writeFileSync(this._path, keep.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
}

/**
 * Subscribe the run store to the scheduler's completion events. `TaskRan` fires on
 * success and `TaskFailed` on a throw, so together they are exactly one record per
 * completed execution (skips are deliberate non-runs and are not recorded). Returns
 * a disposer, or undefined when the run log is disabled.
 *
 * @internal
 */
export function installScheduleRunLog(app: Application): (() => void) | undefined {
  const config = resolveRunLogConfig(app);
  if (!config.enabled) return undefined;

  const store = app.container.tryMake("scheduler.runs");
  if (!store) return undefined; // no SchedulerProvider — nothing to subscribe
  const toRecord = (name: string, durationMs: number, ok: boolean, error?: string) => {
    const finished = Date.now();
    const record: ScheduleRunRecord = {
      name,
      startedAt: new Date(finished - durationMs).toISOString(),
      finishedAt: new Date(finished).toISOString(),
      durationMs: Math.round(durationMs),
      ok,
      ...(error !== undefined ? { error } : {}),
    };
    try {
      store.record(record);
    } catch (err) {
      // A full disk must not take the scheduler down with it.
      console.warn(`[Zerotal scheduler] failed to record run of "${name}":`, err);
    }
  };

  const unsubs = [
    FrameworkEvents.on(TaskRan, (e) => toRecord(e.name, e.durationMs, e.ok)),
    FrameworkEvents.on(TaskFailed, (e) => toRecord(e.name, e.durationMs, false, e.error)),
  ];
  return () => {
    for (const unsub of unsubs) unsub();
  };
}
