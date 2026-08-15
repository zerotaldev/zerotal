/**
 * Asking a dev worker to stop, on a platform where a signal cannot.
 *
 * Windows has no POSIX signals. `child.kill("SIGTERM")` there is
 * `TerminateProcess`: the worker dies mid-instruction, so no provider drains, no
 * open response is finished, and no database handle is closed — on every save,
 * because that is how `serve --dev` restarts. The visible symptom is a browser
 * console full of `ERR_INCOMPLETE_CHUNKED_ENCODING` from the devtools event
 * stream, which is simply what a chunked response looks like when the process
 * writing it stops existing.
 *
 * The supervisor therefore asks over the IPC channel first and kills only when
 * the request goes unanswered. POSIX behaviour is unchanged in substance — the
 * worker runs the same {@link Application.stop} either way — and Windows gains
 * the orderly shutdown it never had.
 *
 * @module
 */

/** The message a supervisor sends to ask a worker to shut itself down. */
export const DEV_SHUTDOWN_MESSAGE = "zerotal:dev:shutdown";

/** How long a supervisor waits for the worker to go on its own, in ms. */
export const DEV_SHUTDOWN_GRACE_MS = 1_000;

/** The part of a spawned child this module needs. */
export interface StoppableChild {
  send?: (message: unknown) => void;
  exited: Promise<number>;
}

/**
 * Ask a child to shut itself down, and wait for it to actually go.
 *
 * @param child - The spawned worker. Must have been spawned with an `ipc`
 *   handler, or there is no channel to ask over and this returns `false`.
 * @param graceMs - How long to wait before giving up on the request.
 * @returns `true` if the child exited on its own, `false` if the caller still
 *   has to kill it. Never throws: a dead channel is a `false`, not an error,
 *   because the caller's next move is the same either way.
 *
 * @example
 * if (!(await requestGracefulStop(child))) child.kill("SIGTERM");
 */
export async function requestGracefulStop(
  child: StoppableChild,
  graceMs: number = DEV_SHUTDOWN_GRACE_MS,
): Promise<boolean> {
  if (typeof child.send !== "function") return false;

  try {
    child.send(DEV_SHUTDOWN_MESSAGE);
  } catch {
    // The channel is already gone, which means so is the chance of a polite
    // exit. The caller kills.
    return false;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      child.exited.then(() => "exited" as const),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), graceMs);
      }),
    ]);
    return outcome === "exited";
  } catch {
    // `exited` rejecting means the child is gone by some other route.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run `stop` when a supervisor asks this process to shut down.
 *
 * Installed by {@link Application} alongside its signal handlers. Harmless in a
 * process with no IPC channel — the message never arrives — so it needs no
 * environment check to stay out of production's way.
 *
 * @param stop - What to run. Called at most once per request.
 */
export function onGracefulStopRequest(stop: () => void): void {
  process.on("message", (message: unknown) => {
    if (message === DEV_SHUTDOWN_MESSAGE) stop();
  });
}
