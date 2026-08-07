import { AsyncLocalStorage } from "node:async_hooks";
import { FrameworkEvents } from "@zerotal/core";
import { TaskRan, TaskFailed, TaskSkipped } from "./events.ts";
import type { LockManager, ManagedLock } from "@zerotal/core/lock";
import { CronExpression } from "./CronExpression.ts";
import { frameworkLog } from "@zerotal/core/logger";

// ── Output capture (shared, reference-counted) ────────────────────────────────
// A single `console.log` patch is installed while ANY task is capturing, and the
// captured output is routed to the running task's own buffer via AsyncLocalStorage.
// This replaces a per-task save/restore of `console.log`, which corrupted the
// global under overlapping captured tasks: one task restoring while another was
// still patched left a dead wrapper installed permanently, appending every future
// log to an abandoned array.
const _outputSink = new AsyncLocalStorage<string[]>();
let _captureRefs = 0;
let _originalConsoleLog: typeof console.log | undefined;

function _beginOutputCapture(): void {
  _captureRefs++;
  if (_captureRefs === 1) {
    _originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      _outputSink.getStore()?.push(args.map(String).join(" "));
      _originalConsoleLog!(...args);
    };
  }
}

function _endOutputCapture(): void {
  _captureRefs = Math.max(0, _captureRefs - 1);
  if (_captureRefs === 0 && _originalConsoleLog) {
    console.log = _originalConsoleLog;
    _originalConsoleLog = undefined;
  }
}

export type TaskCallback = () => void | Promise<void>;
export type TaskGuard = () => boolean | Promise<boolean>;
export type TaskHook = () => void | Promise<void>;

export type OutputMailer = (email: string, subject: string, body: string) => void | Promise<void>;

export interface OverlapLockOptions {
  /**
   * Take a cross-process lock (via the configured lock driver) in addition to the
   * in-process guard. Default: `true`. Set `false` to guard within this process only.
   */
  crossProcess?: boolean;

  /** Lock TTL safety net, in minutes, so a crashed run can't deadlock the key. Default: 1440 (24h). */
  expiresAfterMinutes?: number;
}

export class ScheduledTask {
  private _name: string;
  private _schedule: string;
  private _callback: TaskCallback;
  private _handle: { stop(): void } | undefined = undefined;
  private _timezone: string | undefined = undefined;
  private _running: boolean = false;
  private _lastRunAt: Date | undefined = undefined;
  private _lastOk: boolean | undefined = undefined;
  private _lastDurationMs: number | undefined = undefined;
  private _skipIfStillRunning: boolean = false;
  private _onSuccess: (() => void | Promise<void>) | undefined = undefined;
  private _onFailure: ((err: Error) => void | Promise<void>) | undefined = undefined;
  private _outputPath: string | undefined = undefined;

  private _environments: string[] | undefined = undefined;
  private _between: [string, string] | undefined = undefined;
  private _unlessBetween: [string, string] | undefined = undefined;
  private _when: TaskGuard | undefined = undefined;
  private _skip: TaskGuard | undefined = undefined;

  private _runInBackground: boolean = false;

  private _onStart: TaskHook | undefined = undefined;
  private _pingBefore: string | undefined = undefined;
  private _pingAfter: string | undefined = undefined;
  private _pingOnSuccess: string | undefined = undefined;
  private _pingOnFailure: string | undefined = undefined;

  private _sendOutputPath: string | undefined = undefined;
  private _emailOutputTo: string | undefined = undefined;

  private _crossProcess: boolean = false;
  private _lockTtlMs: number = 24 * 60 * 60 * 1000;
  private _lockHandle: ManagedLock | undefined = undefined;

  static outputMailer: OutputMailer | undefined = undefined;

  /**
   * Distributed lock manager used for cross-process `withoutOverlapping`. Wired by
   * SchedulerProvider from the container's `lock` binding. When unset, overlap
   * protection falls back to the in-process guard only.
   */
  static lockManager: LockManager | null = null;

  constructor(name: string, schedule: string, callback: TaskCallback) {
    this._name = name;
    this._schedule = schedule;
    this._callback = callback;
  }

  timezone(tz: string): this {
    this._timezone = tz;
    return this;
  }

  at(time: string): this {
    const [h, m] = time.split(":").map(Number);
    const parts = this._schedule.trim().split(/\s+/);
    if (parts.length >= 6) {
      parts[1] = String(m ?? 0);
      parts[2] = String(h ?? 0);
    } else {
      while (parts.length < 5) parts.push("*");
      parts[0] = String(m ?? 0);
      parts[1] = String(h ?? 0);
    }
    this._schedule = parts.join(" ");
    return this;
  }

  withoutOverlapping(options?: OverlapLockOptions): this {
    this._skipIfStillRunning = true;
    this._crossProcess = options?.crossProcess ?? true;
    if (options?.expiresAfterMinutes !== undefined) {
      this._lockTtlMs = Math.max(1, options.expiresAfterMinutes) * 60 * 1000;
    }
    return this;
  }

  environments(envs: string[]): this {
    this._environments = envs;
    return this;
  }
  between(start: string, end: string): this {
    this._between = [start, end];
    return this;
  }
  unlessBetween(start: string, end: string): this {
    this._unlessBetween = [start, end];
    return this;
  }
  when(predicate: TaskGuard): this {
    this._when = predicate;
    return this;
  }
  skip(predicate: TaskGuard): this {
    this._skip = predicate;
    return this;
  }
  runInBackground(): this {
    this._runInBackground = true;
    return this;
  }
  onStart(fn: TaskHook): this {
    this._onStart = fn;
    return this;
  }
  onSuccess(fn: () => void | Promise<void>): this {
    this._onSuccess = fn;
    return this;
  }
  onFailure(fn: (err: Error) => void | Promise<void>): this {
    this._onFailure = fn;
    return this;
  }
  pingBefore(url: string): this {
    this._pingBefore = url;
    return this;
  }
  pingAfter(url: string): this {
    this._pingAfter = url;
    return this;
  }
  pingOnSuccess(url: string): this {
    this._pingOnSuccess = url;
    return this;
  }
  pingOnFailure(url: string): this {
    this._pingOnFailure = url;
    return this;
  }
  appendOutputTo(path: string): this {
    this._outputPath = path;
    return this;
  }
  sendOutputTo(path: string): this {
    this._sendOutputPath = path;
    return this;
  }
  emailOutputTo(email: string): this {
    this._emailOutputTo = email;
    return this;
  }

  get name(): string {
    return this._name;
  }
  get schedule(): string {
    return this._schedule;
  }
  get isRunning(): boolean {
    return this._running;
  }
  /** When the task last ran (undefined if never). */
  get lastRunAt(): Date | undefined {
    return this._lastRunAt;
  }
  /** Whether the last run succeeded. */
  get lastOk(): boolean | undefined {
    return this._lastOk;
  }
  /** Duration of the last run, in milliseconds. */
  get lastDurationMs(): number | undefined {
    return this._lastDurationMs;
  }
  /** Next scheduled fire time from `from` (null if the expression never matches). */
  nextRunAt(from: Date = new Date()): Date | null {
    return new CronExpression(this._schedule).nextRun(from);
  }
  /** Run the task body immediately, bypassing schedule/time-window guards. */
  async runNow(): Promise<void> {
    await this._execute();
  }

  private _currentEnv(): string {
    return Bun.env["APP_ENV"] ?? Bun.env["NODE_ENV"] ?? "development";
  }

  private _passesEnvironment(): boolean {
    if (!this._environments) return true;
    return this._environments.includes(this._currentEnv());
  }

  private static _isWithin(now: Date, start: string, end: string): boolean {
    const cur = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const s = (sh || 0) * 60 + (sm || 0);
    const e = (eh || 0) * 60 + (em || 0);
    return s <= e ? cur >= s && cur <= e : cur >= s || cur <= e;
  }

  private _passesTimeWindow(now: Date): boolean {
    if (this._between && !ScheduledTask._isWithin(now, this._between[0], this._between[1]))
      return false;
    if (
      this._unlessBetween &&
      ScheduledTask._isWithin(now, this._unlessBetween[0], this._unlessBetween[1])
    )
      return false;
    return true;
  }

  private async _ping(url: string): Promise<void> {
    try {
      await fetch(url);
    } catch (err) {
      frameworkLog("scheduler").error(
        `Ping failed for "${this._name}" → ${url}`,
        { task: this._name, url },
        err,
      );
    }
  }

  private async _acquireLock(): Promise<boolean> {
    if (!this._crossProcess) return true;
    const manager = ScheduledTask.lockManager;
    // No distributed lock configured (no LockProvider / memory driver) — the
    // in-process `_running` guard already prevents same-process overlap.
    if (!manager) return true;

    const ttlSeconds = Math.max(1, Math.ceil(this._lockTtlMs / 1000));
    const handle = manager.lock(`schedule:${this._name}`, ttlSeconds);
    const acquired = await handle.acquire();
    if (acquired) this._lockHandle = handle;
    return acquired;
  }

  private async _releaseLock(): Promise<void> {
    if (this._lockHandle) {
      await this._lockHandle.release();
      this._lockHandle = undefined;
    }
  }

  private async _execute(): Promise<void> {
    const capture = !!(this._outputPath || this._sendOutputPath || this._emailOutputTo);
    const lines: string[] = [];
    const _t0 = Date.now();
    const _perf0 = performance.now();
    this._lastRunAt = new Date();
    this._lastOk = true;
    if (capture) _beginOutputCapture();

    const body = async (): Promise<void> => {
      if (this._onStart) await this._onStart();
      if (this._pingBefore) await this._ping(this._pingBefore);
      await this._callback();
      if (this._onSuccess) await this._onSuccess();
      if (this._pingOnSuccess) await this._ping(this._pingOnSuccess);
      FrameworkEvents.emit(new TaskRan(this._name, performance.now() - _perf0, true));
    };

    try {
      // Scope this task's captured output to its own buffer via AsyncLocalStorage,
      // so overlapping captured tasks never cross-contaminate.
      if (capture) await _outputSink.run(lines, body);
      else await body();
    } catch (rawErr) {
      const err = rawErr instanceof Error ? rawErr : new Error(String(rawErr));
      this._lastOk = false;
      frameworkLog("scheduler").error(`Task "${this._name}" failed`, { task: this._name }, err);
      FrameworkEvents.emit(new TaskFailed(this._name, performance.now() - _perf0, err.message));
      if (this._onFailure) await this._onFailure(err);
      if (this._pingOnFailure) await this._ping(this._pingOnFailure);
    } finally {
      this._lastDurationMs = Date.now() - _t0;
      if (this._pingAfter) await this._ping(this._pingAfter);
      if (capture) {
        _endOutputCapture();
        if (lines.length > 0) {
          const timestamp = new Date().toISOString();
          const entry = lines.map((l) => `[${timestamp}] ${l}`).join("\n") + "\n";
          if (this._outputPath) {
            const existing = await Bun.file(this._outputPath)
              .text()
              .catch(() => "");
            await Bun.write(this._outputPath, existing + entry);
          }
          if (this._sendOutputPath) await Bun.write(this._sendOutputPath, entry);
          if (this._emailOutputTo) await this._emailOutput(this._emailOutputTo, lines.join("\n"));
        }
      }
    }
  }

  private async _emailOutput(email: string, body: string): Promise<void> {
    const subject = `[Zerotal Scheduler] Output: ${this._name}`;
    if (ScheduledTask.outputMailer) {
      try {
        await ScheduledTask.outputMailer(email, subject, body);
      } catch (err) {
        frameworkLog("scheduler").error(
          `emailOutputTo failed for "${this._name}"`,
          { task: this._name },
          err,
        );
      }
    } else {
      frameworkLog("scheduler").info(`(no outputMailer set) would email "${email}":\n${body}`, {
        task: this._name,
      });
    }
  }

  protected _buildHandler(): () => Promise<void> {
    return async () => {
      if (!this._passesEnvironment()) {
        FrameworkEvents.emit(new TaskSkipped(this._name, "env"));
        return;
      }
      if (!this._passesTimeWindow(new Date())) {
        FrameworkEvents.emit(new TaskSkipped(this._name, "window"));
        return;
      }
      if (this._when && !(await this._when())) {
        FrameworkEvents.emit(new TaskSkipped(this._name, "when"));
        return;
      }
      if (this._skip && (await this._skip())) {
        FrameworkEvents.emit(new TaskSkipped(this._name, "skip"));
        return;
      }

      if (this._skipIfStillRunning && this._running) {
        frameworkLog("scheduler").info(`Skipping "${this._name}" — previous run still active`, {
          task: this._name,
        });
        FrameworkEvents.emit(new TaskSkipped(this._name, "overlap"));
        return;
      }
      if (!(await this._acquireLock())) {
        frameworkLog("scheduler").info(`Skipping "${this._name}" — lock held by another process`, {
          task: this._name,
        });
        FrameworkEvents.emit(new TaskSkipped(this._name, "lock"));
        return;
      }

      this._running = true;

      if (this._runInBackground) {
        void this._execute().finally(() => {
          this._running = false;
          void this._releaseLock();
        });
        return;
      }

      try {
        await this._execute();
      } finally {
        this._running = false;
        await this._releaseLock();
      }
    };
  }

  start(): void {
    if (this._handle) return;
    const handler = this._buildHandler();
    // Bun.cron supports croner's options form `(schedule, { run, timezone })` at
    // runtime, but @types/bun only types the `(schedule, handler)` overload — cast
    // when passing a timezone.
    const cronWithOptions = Bun.cron as unknown as (
      schedule: string,
      options: { run: () => void | Promise<void>; timezone: string },
    ) => { stop(): void };
    this._handle = this._timezone
      ? cronWithOptions(this._schedule, { run: handler, timezone: this._timezone })
      : Bun.cron(this._schedule, handler);
  }

  stop(): void {
    this._handle?.stop();
    this._handle = undefined;
  }
}
