/**
 * What `bun zt dev` and `bun zt serve --dev` both run.
 *
 * One entry point on purpose. The two commands differ only in their flags —
 * `dev` adds the deck controls — and a second copy of this wiring is how they
 * would quietly stop agreeing about what dev mode consists of.
 *
 * The pieces it joins up:
 *
 * - `collectDevProcesses` asks the booted app what to run.
 * - {@link DevSupervisor} runs it and keeps it running.
 * - `createDeck` draws it, in tabs or as a prefixed stream.
 * - {@link DevOrchestrator} owns the server and the file watcher, as before.
 *
 * The server is a card in the deck like any other, which is what makes
 * `--only=server` mean something and lets its tab show `restarting` on a save.
 */
import { DevOrchestrator, type DevWatchPaths } from "./DevOrchestrator.ts";
import { DevSupervisor, _childEnv } from "./DevSupervisor.ts";
import { _DevEnv } from "./devEnv.ts";
import type { DevProcessStatus } from "./DevSupervisor.ts";
import { createDeck } from "./DevDeck.ts";
import type { ResolvedDevProcess } from "./DevProcess.ts";
import type { BuildHookFn } from "./DevBuildHook.ts";
import type { OutputWriter } from "../command/OutputWriter.ts";

export interface StartDevModeOptions {
  port: number;
  cwd: string;
  /**
   * The asset build. Absent for an app with nothing to build — an API — which gets
   * the same supervised server, deck and startup-error page without one, and for a
   * run with no server, where the orchestrator that would call it never starts.
   */
  build?: BuildHookFn | undefined;
  /** The interface the server binds; `127.0.0.1` when absent. */
  host?: string | undefined;
  /** Extra paths that restart the server or rebuild assets (`app.dev.watch`). */
  watch?: DevWatchPaths | undefined;
  /** Everything the providers and the app contributed, already filtered. */
  processes: ResolvedDevProcess[];
  writer: OutputWriter;
  /** Force a renderer; omitted means tabs on a TTY, stream otherwise. */
  deckMode?: "tabs" | "stream" | undefined;
}

/**
 * The server's card. Named so `--only=server` and `--without=server` read naturally.
 *
 * @internal
 */
export const SERVER_PROCESS_NAME = "server";

/**
 * Run dev mode until the process is signalled.
 *
 * Never returns: the orchestrator parks on an unresolved promise and the exit
 * happens in its signal handlers, after the deck has restored the terminal.
 *
 * @internal
 */
export async function startDevMode(options: StartDevModeOptions): Promise<void> {
  const supervised = options.processes.filter((entry) => entry.name !== SERVER_PROCESS_NAME);
  const wantsServer = options.processes.some((entry) => entry.name === SERVER_PROCESS_NAME);

  // The server's card is synthesised rather than registered, because the
  // orchestrator — not the supervisor — owns its lifetime. It still gets a tab,
  // a colour and a state, so from the deck's side it is one of the crowd.
  const serverStatus: DevProcessStatus = {
    name: SERVER_PROCESS_NAME,
    label: SERVER_PROCESS_NAME,
    color: "green",
    state: "starting",
    attempts: 0,
  };

  // Declared before the three objects that reference each other in a cycle: the
  // deck's key handlers call the supervisor, the supervisor's output callbacks
  // call the deck. Every one of them fires from a later turn of the event loop,
  // by which point all three are assigned.
  // eslint-disable-next-line prefer-const -- assigned below; the deck closes over both
  let supervisor: DevSupervisor;
  // eslint-disable-next-line prefer-const -- assigned below; the deck closes over both
  let orchestrator: DevOrchestrator;

  const deck = createDeck({
    writer: options.writer,
    ...(options.deckMode ? { mode: options.deckMode } : {}),
    onRestart: (name) => {
      // The server restarts through the orchestrator, which also rebuilds
      // assets — restarting it any other way would leave the browser holding
      // bundles from before whatever the developer just fixed.
      if (name === SERVER_PROCESS_NAME) void orchestrator.restartServer();
      else void supervisor.restart(name);
    },
    onQuit: () => void orchestrator.shutdown(),
  });

  // One source for every process's environment, read again on each spawn, so an edit to
  // `.env` reaches the restarted server and the processes that restart with it.
  const env = new _DevEnv(options.cwd);

  supervisor = new DevSupervisor({
    cwd: options.cwd,
    env: () => _childEnv(env.current()),
    onLine: (name, line, stream) => deck.line(name, line, stream),
    onState: (status) => deck.state(status),
  });

  orchestrator = new DevOrchestrator(
    options.port,
    options.cwd,
    options.build ?? null,
    {
      ...(wantsServer
        ? {
            onServerLine: (line, stream) => deck.line(SERVER_PROCESS_NAME, line, stream),
            onServerState: (state) => {
              serverStatus.state = state;
              deck.state({ ...serverStatus });
            },
          }
        : {}),
      onNotice: (text) => deck.notice(text.trim()),
      onServerReady: () => {
        supervisor.start(supervised.filter((entry) => entry.after === "server"));
      },
      onServerRestart: () => void supervisor.restartWithServer(),
      onCleanup: async () => {
        await supervisor.stopAll();
        deck.stop();
      },
    },
    {
      host: options.host,
      watch: options.watch,
      env: () => env.current(),
    },
  );

  try {
    // Cards exist before anything can write to them, so early output has a tab to
    // land in rather than being dropped for want of one.
    deck.start([...(wantsServer ? [serverStatus] : []), ...supervised.map(_toStatus)]);

    // Started before the server rather than after it: these declared they do not
    // depend on it, and making them wait for a build they have nothing to do with
    // is dead time on every boot.
    supervisor.start(supervised.filter((entry) => entry.after === "none"));

    if (!wantsServer) {
      // `--only=queue`, say — supervised and drawn, with no server underneath.
      // Still parks forever: quitting goes through the deck like everywhere else.
      await new Promise<never>(() => {});
      return;
    }

    await orchestrator.start();
  } catch (error) {
    // Give the terminal back *before* saying what went wrong.
    //
    // The deck draws in the alternate screen buffer, and leaving it restores the
    // shell's screen — discarding everything written while it was up. So a dev
    // run that failed printed its reason into a buffer that was then thrown
    // away, and the developer was left with the startup banner and
    // `error: script "zt" exited with code 1`. Nothing about the failure
    // survived, on the one path where knowing the reason matters most.
    //
    // Reported here rather than left to the caller for the same reason: by the
    // time an error reaches the command runner the deck may or may not have been
    // stopped, and "may or may not" decides whether the message is visible.
    deck.stop();
    throw error;
  }
}

/** The card a process starts life with, before the supervisor has run it. */
function _toStatus(process: ResolvedDevProcess): DevProcessStatus {
  return {
    name: process.name,
    label: process.label,
    color: process.color,
    state: "starting",
    attempts: 0,
  };
}
