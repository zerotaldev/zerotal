/**
 * Port availability, and the OS lookups behind `serve`'s busy-port prompt.
 *
 * `Bun.serve()` throws a bare `EADDRINUSE` when something already holds the
 * port, which tells a developer nothing about *what* holds it or how to get it
 * back. These helpers answer both questions before the server tries to bind.
 */

/**
 * Environment variable marking a child process that inherits an already-resolved
 * port from its supervisor. Such a process must never prompt: its stdin belongs
 * to the parent (the dev worker reads reload signals on it), so a prompt there
 * would wait forever on input that never arrives.
 *
 * @internal
 */
export const PORT_RESOLVED_ENV_VAR = "ZT_PORT_RESOLVED";

/** A process holding a port: its pid, and its executable name when discoverable. */
export type PortOwner = {
  pid: number;
  /** e.g. `bun.exe`, `node`. Undefined when the platform lookup came up empty. */
  name?: string;
};

/**
 * Whether `port` can be bound right now.
 *
 * Binds and immediately releases, which is the only answer that matches what
 * `Bun.serve()` will do — a connect probe would miss a socket bound to a
 * different interface. The default hostname mirrors `Bun.serve()`'s own, so a
 * port this reports as free is one the server can actually take.
 *
 * @example
 * if (!(await isPortAvailable(3000))) console.log("something is already there");
 */
export async function isPortAvailable(port: number, hostname = "0.0.0.0"): Promise<boolean> {
  try {
    const probe = Bun.listen({ hostname, port, socket: { data(): void {} } });
    probe.stop(true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Poll until `port` frees up, giving up after `timeoutMs`.
 *
 * Returns `true` as soon as the port is bindable, `false` on timeout. This is
 * the restart case: a server that has just been signalled still holds its
 * socket for a moment after the signal is delivered.
 */
export async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await isPortAvailable(port)) return true;
    if (Date.now() >= deadline) return false;
    await Bun.sleep(100);
  }
}

/**
 * The first bindable port at or after `start`, or `undefined` when `attempts`
 * consecutive ports are all taken (or the scan runs past 65535).
 *
 * @example
 * const port = (await findAvailablePort(3001)) ?? 0; // 0 lets the OS choose
 */
export async function findAvailablePort(start: number, attempts = 20): Promise<number | undefined> {
  for (let port = start; port < start + attempts && port <= 65535; port++) {
    if (await isPortAvailable(port)) return port;
  }
  return undefined;
}

/**
 * The process listening on `port`, or `undefined` when it cannot be identified.
 *
 * Identification is best-effort and shells out to the platform's socket table
 * (`netstat` on Windows, `lsof` elsewhere), so it can come up empty on a
 * stripped-down container or for a socket owned by another user. Callers must
 * treat `undefined` as "unknown", not "nothing is listening".
 */
export async function findPortOwner(port: number): Promise<PortOwner | undefined> {
  const pid =
    process.platform === "win32"
      ? _parseNetstat(await _capture(["netstat", "-ano", "-p", "TCP"]), port)
      : _parseFirstPid(await _capture(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]));

  if (pid === undefined) return undefined;
  const name = await _processName(pid);
  return name === undefined ? { pid } : { pid, name };
}

/**
 * End the process `pid`, returning whether it is gone afterwards.
 *
 * Elsewhere this is SIGTERM first, escalating to SIGKILL only if the process is
 * still alive a beat later, so a server gets to run its shutdown hooks. Windows
 * has no signals — `taskkill /F` is the only way to end another process, and it
 * is always abrupt.
 */
export async function stopProcess(pid: number): Promise<boolean> {
  if (process.platform === "win32") {
    try {
      const killer = Bun.spawn(["taskkill", "/PID", String(pid), "/F"], {
        stdout: "ignore",
        stderr: "ignore",
      });
      return (await killer.exited) === 0;
    } catch {
      return false;
    }
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // ESRCH (already gone) counts as success; EPERM does not.
    return !_isAlive(pid);
  }

  for (let waited = 0; waited < 1_500; waited += 50) {
    if (!_isAlive(pid)) return true;
    await Bun.sleep(50);
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return !_isAlive(pid);
  }
  await Bun.sleep(100);
  return !_isAlive(pid);
}

// ── Private ──────────────────────────────────────────────────────────────────

/** Whether the process still exists. Signal 0 checks without delivering anything. */
function _isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Run a command and return its stdout, or "" if it cannot be run at all. */
async function _capture(command: string[]): Promise<string> {
  try {
    const proc = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    return output;
  } catch {
    return "";
  }
}

/**
 * Pull the listening pid for `port` out of `netstat -ano` output, whose rows are
 * `TCP  <local>  <foreign>  <state>  <pid>` with the local address written as
 * `0.0.0.0:3000` or `[::]:3000`.
 */
function _parseNetstat(output: string, port: number): number | undefined {
  for (const line of output.split("\n")) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5) continue;
    const [protocol, local, , state, pid] = columns;
    if (!protocol?.toUpperCase().startsWith("TCP")) continue;
    if (state?.toUpperCase() !== "LISTENING") continue;
    if (!local?.endsWith(`:${port}`)) continue;
    const parsed = Number(pid);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

/** First pid from newline-separated output (`lsof -t` prints one per line). */
function _parseFirstPid(output: string): number | undefined {
  for (const line of output.split("\n")) {
    const parsed = Number(line.trim());
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

/** The executable name for `pid`, so the prompt can say more than a number. */
async function _processName(pid: number): Promise<string | undefined> {
  if (process.platform === "win32") {
    const output = await _capture(["tasklist", "/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"]);
    return /^"([^"]+)"/.exec(output.trim())?.[1];
  }
  return (await _capture(["ps", "-p", String(pid), "-o", "comm="])).trim() || undefined;
}
