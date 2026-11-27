/**
 * Runs the dev processes and keeps them running.
 *
 * The supervisor owns lifetimes, not presentation: it spawns, watches, restarts,
 * gives up, and reports — every line of output and every state change goes out
 * through callbacks. The deck draws them; the stream writer prefixes them. Neither
 * is imported here, which is what lets the whole thing be tested with a fake
 * spawner and no terminal at all.
 *
 * ## One rule above the others
 *
 * A dev process dying must never take the server down. That is the whole
 * difference from the build hook, where a failure aborts the reload on purpose.
 * Here a crashed type-checker is an annoyance in one tab; if it could stop the
 * server it would be a worse problem than the one the tab was added to solve.
 */
import type { ResolvedDevProcess } from "./DevProcess.ts";
import { RUNTIME_MODE_VAR } from "../support/env.ts";
import { requestGracefulStop } from "./devShutdown.ts";
import { _colorEnv } from "../logger/color.ts";

/**
 * What the supervisor needs back from whatever it spawned.
 *
 * @internal
 */
export interface DevChild {
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly stderr: ReadableStream<Uint8Array> | null;
  readonly exited: Promise<number>;
  kill(signal?: number | NodeJS.Signals): void;
  /**
   * The IPC channel, when the child was spawned with one. A stop asks over it first, so the
   * process can finish what it is doing; see `devShutdown.ts`.
   */
  send?: ((message: unknown) => void) | undefined;
}

/**
 * How the supervisor starts a child. Injected so tests need no real processes.
 *
 * @internal
 */
export type DevSpawnFn = (
  argv: string[],
  options: {
    cwd: string;
    env: Record<string, string | undefined>;
    /** Open an IPC channel, for a `zt` command that can be asked to stop. */
    ipc?: boolean | undefined;
  },
) => DevChild;

/**
 * Where a process is in its life.
 *
 * @internal
 */
export type DevProcessState = "starting" | "running" | "restarting" | "exited" | "parked";

/**
 * A process as the deck sees it.
 *
 * @internal
 */
export interface DevProcessStatus {
  name: string;
  label: string;
  color: ResolvedDevProcess["color"];
  state: DevProcessState;
  /** Exit code of the last run, when it has exited. */
  exitCode?: number;
  /** Consecutive failed starts. Reset once a run stays up. */
  attempts: number;
}

/** How the supervisor reports what is happening. */
export interface DevSupervisorHooks {
  /** One line of a process's output. `stream` distinguishes stderr for colouring. */
  onLine?: (name: string, line: string, stream: "stdout" | "stderr") => void;
  /** A process changed state — repaint the tab. */
  onState?: (status: DevProcessStatus) => void;
}

/** @internal */
export interface DevSupervisorOptions extends DevSupervisorHooks {
  cwd: string;
  /**
   * The environment each process starts with, or a function giving it, called on every spawn
   * so a restart picks up an edited `.env`. Defaults to {@link _childEnv}.
   */
  env?: Record<string, string | undefined> | (() => Record<string, string | undefined>) | undefined;
  /** Defaults to `Bun.spawn` with output piped and **stdin ignored**. */
  spawn?: DevSpawnFn | undefined;
  /**
   * Backoff before each retry, in ms. Overridable for the same reason `spawn`
   * is: a test of the restart policy should assert the policy, not spend three
   * seconds proving that `setTimeout` works.
   */
  backoffMs?: number[] | undefined;
  /** How long a run must last to be considered healthy. See {@link HEALTHY_AFTER_MS}. */
  healthyAfterMs?: number | undefined;
  /** How long a process asked to stop gets to finish before it is killed. See {@link STOP_GRACE_MS}. */
  stopGraceMs?: number | undefined;
}

/** Give up after this many consecutive failed starts. */
const MAX_ATTEMPTS = 3;
/** Backoff before retry N, in ms. */
const BACKOFF_MS = [300, 900, 2_400];
/**
 * A run that stays up this long is treated as healthy, and the attempt counter
 * resets. Without it a process that crashes once an hour eventually parks itself
 * for a reason that has nothing to do with the current failure.
 */
const HEALTHY_AFTER_MS = 10_000;
/**
 * How long a `zt` process asked to stop has to finish on its own: a queue worker completing
 * the job in hand, a scheduler letting a running task end. Longer than the server's grace,
 * because a job does real work; short enough that quitting still feels immediate.
 */
const STOP_GRACE_MS = 3_000;

/** One supervised process's mutable state. */
interface Entry {
  definition: ResolvedDevProcess;
  status: DevProcessStatus;
  child?: DevChild | undefined;
  abort?: AbortController | undefined;
  /** Set while a deliberate stop or restart is in flight, so the exit is not "unexpected". */
  stopping: boolean;
  /** Cleared on stop so a parked retry cannot fire after shutdown. */
  retryTimer?: ReturnType<typeof setTimeout> | undefined;
  healthyTimer?: ReturnType<typeof setTimeout> | undefined;
}

/** @internal */
export class DevSupervisor {
  private readonly _entries = new Map<string, Entry>();
  private readonly _cwd: string;
  private readonly _env: () => Record<string, string | undefined>;
  private readonly _spawn: DevSpawnFn;
  private readonly _hooks: DevSupervisorHooks;
  private readonly _backoff: number[];
  private readonly _healthyAfter: number;
  private readonly _stopGrace: number;
  private _stopped = false;

  constructor(options: DevSupervisorOptions) {
    this._cwd = options.cwd;
    const env = options.env ?? _childEnv();
    this._env = typeof env === "function" ? env : (): Record<string, string | undefined> => env;
    this._spawn = options.spawn ?? _bunSpawn;
    this._backoff = options.backoffMs ?? BACKOFF_MS;
    this._healthyAfter = options.healthyAfterMs ?? HEALTHY_AFTER_MS;
    this._stopGrace = options.stopGraceMs ?? STOP_GRACE_MS;
    this._hooks = {
      ...(options.onLine && { onLine: options.onLine }),
      ...(options.onState && { onState: options.onState }),
    };
  }

  /** Every process currently known, in registration order. */
  statuses(): DevProcessStatus[] {
    return [...this._entries.values()].map((entry) => ({ ...entry.status }));
  }

  /** The definitions this supervisor was given, in registration order. */
  definitions(): ResolvedDevProcess[] {
    return [...this._entries.values()].map((entry) => entry.definition);
  }

  /**
   * Start every process in `definitions`.
   *
   * Called twice by the orchestrator — once with the `after: "none"` set beside
   * the first server spawn, once with `after: "server"` after it binds — so a
   * process that talks to the server is not started against a closed port.
   */
  start(definitions: ResolvedDevProcess[]): void {
    for (const definition of definitions) {
      if (this._entries.has(definition.name)) continue;
      const entry: Entry = {
        definition,
        status: {
          name: definition.name,
          label: definition.label,
          color: definition.color,
          state: "starting",
          attempts: 0,
        },
        stopping: false,
      };
      this._entries.set(definition.name, entry);
      this._launch(entry);
    }
  }

  /**
   * Restart one process by name, whatever state it is in.
   *
   * This is also the way out of `parked`: the attempt counter resets, because a
   * developer asking for a restart has usually just fixed the thing that broke.
   */
  async restart(name: string): Promise<void> {
    const entry = this._entries.get(name);
    if (!entry || this._stopped) return;

    entry.status.attempts = 0;
    this._setState(entry, "restarting");
    await this._stopEntry(entry);
    if (this._stopped) return;
    this._launch(entry);
  }

  /**
   * Restart every process that set `restartOnChange`, for a server restart.
   *
   * A process that loads the app's own files — a scheduler reading
   * `app/schedules/` — would otherwise keep running the code it booted with
   * while the server picked up the change.
   */
  async restartWithServer(): Promise<void> {
    const following = [...this._entries.values()].filter(
      (entry) => entry.definition.restartOnChange,
    );
    await Promise.all(following.map((entry) => this.restart(entry.definition.name)));
  }

  /** Stop everything and stay stopped. Safe to call twice. */
  async stopAll(): Promise<void> {
    this._stopped = true;
    await Promise.all([...this._entries.values()].map((entry) => this._stopEntry(entry)));
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private _launch(entry: Entry): void {
    if (this._stopped) return;
    entry.stopping = false;
    this._setState(entry, "starting");

    const startedAt = Date.now();
    entry.healthyTimer = setTimeout(() => {
      entry.status.attempts = 0;
    }, this._healthyAfter);

    if (entry.definition.run) {
      const abort = new AbortController();
      entry.abort = abort;
      this._setState(entry, "running");
      void entry.definition
        .run(abort.signal)
        .then(() => this._onExit(entry, 0, startedAt))
        .catch((error: unknown) => {
          if (!abort.signal.aborted) this._emit(entry, _errorText(error), "stderr");
          this._onExit(entry, abort.signal.aborted ? 0 : 1, startedAt);
        });
      return;
    }

    let child: DevChild;
    try {
      const argv = entry.definition.argv!;
      child = this._spawn(argv, { cwd: this._cwd, env: this._env(), ipc: _isZtCommand(argv) });
    } catch (error) {
      // A missing binary is the usual cause, and it fails every attempt
      // identically — report it as output so the tab explains itself.
      this._emit(entry, _errorText(error), "stderr");
      this._onExit(entry, 1, startedAt);
      return;
    }

    entry.child = child;
    this._setState(entry, "running");
    void this._pump(entry, child.stdout, "stdout");
    void this._pump(entry, child.stderr, "stderr");
    void child.exited.then((code) => this._onExit(entry, code, startedAt));
  }

  /**
   * Decide what happens after a process ends.
   *
   * A deliberate stop reports nothing and schedules nothing — `restart()` and
   * `stopAll()` own what comes next.
   */
  private _onExit(entry: Entry, code: number, startedAt: number): void {
    if (entry.healthyTimer) clearTimeout(entry.healthyTimer);
    entry.child = undefined;
    entry.abort = undefined;
    entry.status.exitCode = code;

    if (entry.stopping || this._stopped) return;

    // A run that lasted counts as healthy even if it then failed: the attempt
    // budget is for start-up failure loops, not for every crash forever.
    if (Date.now() - startedAt >= this._healthyAfter) entry.status.attempts = 0;

    const policy = entry.definition.restart;
    const shouldRestart = policy === "always" || (policy === "on-failure" && code !== 0);

    if (!shouldRestart) {
      this._setState(entry, "exited");
      return;
    }

    // A process that restarts with the server loads the app's own files, so when it fails to
    // start the cause is usually a file being edited — a page with a syntax error stops it the
    // same way it stops the server. Retrying the same files three times only printed the same
    // failure three times and parked it; it starts again on the next save, as the server does.
    if (entry.definition.restartOnChange && Date.now() - startedAt < this._healthyAfter) {
      this._setState(entry, "parked");
      this._emit(
        entry,
        `[zerotal:dev] "${entry.definition.name}" stopped (exit ${code}). It starts again when ` +
          `you save a change, or press r with this tab focused.`,
        "stderr",
      );
      return;
    }

    entry.status.attempts += 1;
    if (entry.status.attempts >= MAX_ATTEMPTS) {
      this._setState(entry, "parked");
      this._emit(
        entry,
        `[zerotal:dev] "${entry.definition.name}" failed ${MAX_ATTEMPTS} times — parked. ` +
          `Press r with this tab focused to retry, or run \`bun zt dev --only=${entry.definition.name}\`.`,
        "stderr",
      );
      return;
    }

    const delay = this._backoff[entry.status.attempts - 1] ?? this._backoff.at(-1)!;
    this._setState(entry, "restarting");
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = undefined;
      this._launch(entry);
    }, delay);
  }

  /** Stop one process and wait for it to actually be gone. */
  private async _stopEntry(entry: Entry): Promise<void> {
    entry.stopping = true;
    if (entry.retryTimer) {
      clearTimeout(entry.retryTimer);
      entry.retryTimer = undefined;
    }
    if (entry.healthyTimer) clearTimeout(entry.healthyTimer);

    entry.abort?.abort();

    const child = entry.child;
    // Asked first, over IPC, when the child is a `zt` command: a signal stops a process where
    // it stands — on Windows it cannot be caught at all — and a queue worker killed mid-job
    // leaves the job reserved until its lease runs out.
    if (child && (await requestGracefulStop(child, this._stopGrace))) {
      entry.child = undefined;
      entry.abort = undefined;
      return;
    }
    if (child) {
      child.kill("SIGTERM");
      // A child ignoring SIGTERM would otherwise hold the whole quit open, and a
      // developer pressing q expects their shell back.
      const force = setTimeout(() => child.kill("SIGKILL"), 1_500);
      try {
        await child.exited;
      } catch {
        // Already gone.
      } finally {
        clearTimeout(force);
      }
    }

    entry.child = undefined;
    entry.abort = undefined;
  }

  /** Split a piped stream into lines and hand each one to the hook. */
  private async _pump(
    entry: Entry,
    stream: ReadableStream<Uint8Array> | null,
    kind: "stdout" | "stderr",
  ): Promise<void> {
    if (!stream) return;
    const decoder = new TextDecoder();
    // A reader rather than `for await`: async iteration on a ReadableStream is a
    // runtime extension Bun has and the DOM types do not, and reaching for a cast
    // to paper over that would hide a real portability question.
    const reader = stream.getReader();
    let buffered = "";

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        // The last element is whatever came after the final newline — a partial
        // line that must wait for the next chunk rather than being emitted as a
        // short one, which is how progress bars end up shredded across tabs.
        buffered = lines.pop() ?? "";
        for (const line of lines) this._emit(entry, line.replace(/\r$/, ""), kind);
      }
    } catch {
      // The stream closes under us when the process is killed; that is the
      // normal end of a pump, not a failure worth reporting.
    }

    if (buffered) this._emit(entry, buffered, kind);
  }

  private _emit(entry: Entry, line: string, kind: "stdout" | "stderr"): void {
    this._hooks.onLine?.(entry.definition.name, line, kind);
  }

  private _setState(entry: Entry, state: DevProcessState): void {
    entry.status.state = state;
    this._hooks.onState?.({ ...entry.status });
  }
}

/**
 * The real spawner.
 *
 * `stdin: "ignore"` is not a detail. The dev worker reads stdin for reload
 * signals from the orchestrator, and a second process holding a claim on the
 * same terminal input makes that behaviour undebuggable — the reload silently
 * goes to whoever won.
 */
function _bunSpawn(
  argv: string[],
  options: { cwd: string; env: Record<string, string | undefined>; ipc?: boolean | undefined },
): DevChild {
  return Bun.spawn(argv, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    cwd: options.cwd,
    env: options.env,
    // The channel `_stopEntry` asks over. Bun only gives the parent a `send` when a handler is
    // present; nothing is read from it.
    ...(options.ipc ? { ipc: () => {} } : {}),
  });
}

/**
 * Whether an argv runs one of the app's own `zt` commands, which can be asked to stop over IPC.
 *
 * A bare-string `command` is settled into `["bun", Bun.main, …]`. Anything else is another
 * program, which would not answer on the channel and has no use for one.
 *
 * @internal
 */
export function _isZtCommand(argv: readonly string[], main: string = Bun.main): boolean {
  return argv[0] === "bun" && argv[1] === main;
}

/**
 * The environment a dev process starts with: this one, minus the runtime mode.
 *
 * `zt dev` sets `APP_TYPE=web` for itself, and an explicit `APP_TYPE` wins over
 * the command name. Passed on, it booted every dev process as a web process:
 * `queue:work` ran without the `worker` conventions, and a scheduler skipped
 * `app/schedules/` entirely. Leaving it out lets each child pick its mode from
 * its own command, the way it does when run by hand.
 *
 * @internal
 */
export function _childEnv(
  from: Record<string, string | undefined> = Bun.env,
): Record<string, string | undefined> {
  const env = { ..._colorEnv(from) };
  delete env[RUNTIME_MODE_VAR];
  return env;
}

function _errorText(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
