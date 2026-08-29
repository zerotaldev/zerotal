import { AsyncLocalStorage } from "node:async_hooks";
import { config, FrameworkEvents } from "@zerotal/core";
import { deployEnv } from "@zerotal/core";
import { TaskRan, TaskFailed, TaskSkipped } from "./events.ts";
import type { LockManager, ManagedLock } from "@zerotal/core/lock";
import { CronExpression, isValidTimeZone } from "./CronExpression.ts";
import { UnknownTimeZoneError } from "./errors.ts";
import { frameworkLog } from "@zerotal/core/logger";

/**
 * The tick a timezoned task rides on.
 *
 * `Bun.cron` evaluates a schedule in the system zone and offers no way to change
 * that, so a task with its own zone registers this instead and does the matching
 * itself. Minute granularity is not a compromise: five fields is all `Bun.cron`
 * accepts, so a minute is the finest a Zerotal schedule can express anyway.
 */
const EVERY_MINUTE = "* * * * *";

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

  /**
   * **How long after a crash before another host may take the task over**, in
   * minutes. Default: 5.
   *
   * This used to mean "how long the task might possibly run", which is why it
   * defaulted to a day: the lock could not be extended, so the TTL had to cover
   * the worst case, and a scheduler that died mid-run blocked that task until
   * the next afternoon. The lock is now heartbeated while the task runs, so the
   * TTL only has to outlive one missed heartbeat — and the number you are
   * choosing is a recovery time rather than a guess about duration.
   *
   * A long-running task no longer needs a long value here. Set one only if you
   * want a crash to be *slower* to recover from, which is rarely what anyone
   * wants.
   */
  expiresAfterMinutes?: number;

  /**
   * Heartbeat the lock for as long as the task runs. Default: `true`.
   *
   * Turning it off restores the old behaviour, where the task must finish
   * inside {@link expiresAfterMinutes} or lose its lock — and where you must
   * therefore size that value for the worst case.
   */
  refresh?: boolean;
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
  /**
   * Minutes, not a day. The lock is heartbeated while the task runs, so this is
   * the window in which a crashed scheduler still holds the key — not a bound on
   * how long the task may take.
   */
  private _lockTtlMs: number = 5 * 60 * 1000;
  private _lockRefresh: boolean = true;
  private _lockHandle: ManagedLock | undefined = undefined;
  private _lockHeartbeat: ReturnType<typeof setInterval> | undefined = undefined;

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

  /**
   * Evaluate this task's schedule in `tz` rather than the server's zone.
   *
   * @param tz - An IANA zone name, e.g. `"Africa/Johannesburg"`.
   * @throws {@link UnknownTimeZoneError} At {@link start}, when the runtime does not
   *   know the zone — named there rather than here so a schedule declared as data
   *   fails where the failure can name the task.
   */
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
    this._lockRefresh = options?.refresh ?? true;
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
  /**
   * Next scheduled fire time from `from` (null if the expression never matches).
   *
   * Read in the task's own timezone when it has one, so `schedule:list` and the
   * monitor agree with when the task will actually run rather than with when the
   * same expression would fire in the server's zone.
   */
  nextRunAt(from: Date = new Date()): Date | null {
    const timezone = this._effectiveTimezone();
    return timezone
      ? CronExpression.nextRunAfterIn(this._schedule, from, timezone)
      : new CronExpression(this._schedule).nextRun(from);
  }
  /** Run the task body immediately, bypassing schedule/time-window guards. */
  async runNow(): Promise<void> {
    await this._execute();
  }

  private _currentEnv(): string {
    // `deployEnv()`: reading APP_ENV returned the runtime mode, so a task scoped
    // with `.environments(["production"])` never matched and silently never ran.
    return deployEnv() || Bun.env["NODE_ENV"] || "development";
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
    if (!acquired) return false;

    this._lockHandle = handle;
    if (this._lockRefresh) this._startHeartbeat(handle, ttlSeconds);
    return true;
  }

  /**
   * Keep the overlap lock alive while the task runs.
   *
   * A third of the TTL, so one missed beat is survivable. A failed refresh is
   * *not* escalated: the run is already in flight, and killing a half-finished
   * task because another host may now also be running it does not make the
   * overlap un-happen — it just adds a second failure. It is logged, the handle
   * is dropped so the release cannot touch a lock we no longer own, and the task
   * is left to finish.
   */
  private _startHeartbeat(handle: ManagedLock, ttlSeconds: number): void {
    // A third of the TTL, floored only low enough to stop a pathological TTL
    // spinning. The floor must never approach the interval itself: at 1000ms it
    // made every TTL of three seconds or less refresh at the moment of expiry —
    // a heartbeat that reliably lost the race it existed to win.
    const everyMs = Math.max(50, Math.floor((ttlSeconds * 1000) / 3));
    const timer = setInterval(() => {
      void handle.refresh().then(
        (ok) => {
          if (ok) return;
          frameworkLog("scheduler").warn(
            `Lost the overlap lock for "${this._name}" — another host may now run it too.`,
            { task: this._name },
          );
          this._stopHeartbeat();
          this._lockHandle = undefined;
        },
        () => {
          /* transient driver error — the next beat tries again */
        },
      );
    }, everyMs);
    // The scheduler outlives any one task, but a CLI or a dev-mode process that
    // stops mid-run must still be able to exit.
    timer.unref?.();
    this._lockHeartbeat = timer;
  }

  private _stopHeartbeat(): void {
    if (this._lockHeartbeat) {
      clearInterval(this._lockHeartbeat);
      this._lockHeartbeat = undefined;
    }
  }

  private async _releaseLock(): Promise<void> {
    // Stopped first and unconditionally: a beat that fires after the release
    // would re-acquire the key this task has just finished with.
    this._stopHeartbeat();
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

  /**
   * The zone this task's schedule is read in: its own, else `scheduler.timezone`.
   *
   * `undefined` when that resolves to the zone the process is already in, because
   * `Bun.cron` evaluates a schedule in the system zone and its own tick is both
   * cheaper and better tested than a minute tick with a match on top.
   *
   * @returns The zone to evaluate in, or `undefined` to let `Bun.cron` do it.
   */
  private _effectiveTimezone(): string | undefined {
    const timezone = this._timezone ?? config.safe("scheduler.timezone", "");
    if (!timezone) return undefined;
    return timezone === Intl.DateTimeFormat().resolvedOptions().timeZone ? undefined : timezone;
  }

  start(): void {
    if (this._handle) return;
    const handler = this._buildHandler();
    const timezone = this._effectiveTimezone();

    if (!timezone) {
      this._handle = Bun.cron(this._schedule, handler);
      return;
    }

    if (!isValidTimeZone(timezone)) {
      throw new UnknownTimeZoneError(this._name, timezone);
    }

    // `Bun.cron` takes `(schedule, handler)` and nothing else. The croner options
    // form — `(schedule, { run, timezone })` — throws, and it throws during
    // *registration*, so one task with a timezone took every other task in the app
    // with it and the worker restart-looped. Setting a timezone is the obvious
    // thing to do for a business that operates in one country and is not on UTC,
    // which is most of them.
    //
    // So the schedule is evaluated here rather than by Bun. Bun ticks once a
    // minute — the finest granularity it has, so nothing is given up — and the task
    // runs on the ticks where the expression matches the wall clock in its own
    // zone. Comparing against the zone's local time rather than an offset computed
    // at registration is also what keeps it right across a DST change.
    //
    // A wall clock that skips an hour skips the schedules inside it, and one that
    // repeats an hour runs them twice. That is what every cron does, and the
    // alternative — inventing a firing time the clock never showed — is worse.
    const expression = new CronExpression(this._schedule);

    this._handle = Bun.cron(EVERY_MINUTE, async () => {
      if (!expression.matchesIn(new Date(), timezone)) return;
      await handler();
    });
  }

  stop(): void {
    this._handle?.stop();
    this._handle = undefined;
  }
}
