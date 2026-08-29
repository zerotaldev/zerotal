/**
 * The one place a tool reaches into a booted application.
 *
 * Spawns `bun zt.ts arch:probe <topic>` in the project, reads the JSON the
 * command frames with {@link PROBE_SENTINEL}, and hands it back. Everything the
 * subprocess printed before the sentinel — banners, provider notices, a warning
 * from a package — is discarded; only stderr is kept, and only to explain a
 * failure.
 *
 * ## There is deliberately no cache
 *
 * Booting the app costs a second or so, and a burst of tool calls in one agent
 * turn pays it each time. That is the trade being made on purpose: the caller is
 * an agent that edits routes and models between calls, and an answer cached even
 * for a few seconds can describe code that no longer exists. A slow correct
 * answer is recoverable; a fast wrong one is what sends an agent down a path
 * nothing will contradict.
 */
import { dirname, join } from "node:path";
import { PROBE_SENTINEL } from "../probe/sentinel.ts";
import type { ProbeTopic } from "../probe/topics.ts";

/** How long a probe may run before it is killed. Boot plus a wide margin. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Entry filenames an app may use, in the order `bun zt` would find them. */
const ENTRY_NAMES = ["zt.ts", "zt.js"] as const;

export type ProbeResult = { ok: true; data: unknown } | { ok: false; message: string };

/** The seam tools depend on, so a tool's own tests never boot an application. */
export interface ProbeRunner {
  run(topic: ProbeTopic, signal: AbortSignal): Promise<ProbeResult>;
}

export interface SpawnProbeOptions {
  /** Where to start looking for the app. Defaults to the server's working directory. */
  cwd?: string | undefined;
  timeoutMs?: number | undefined;
}

/**
 * Find the Zerotal app enclosing `start` — the nearest ancestor holding both a
 * `package.json` and a `zt` entry point.
 *
 * Walks upward rather than trusting the working directory outright: an editor or
 * an MCP client may launch the server from a subdirectory, and failing with
 * "no app here" when the app is two levels up is a bad first impression.
 */
export async function findApp(start: string): Promise<{ root: string; entry: string } | undefined> {
  let dir = start;
  for (;;) {
    if (await Bun.file(join(dir, "package.json")).exists()) {
      for (const name of ENTRY_NAMES) {
        if (await Bun.file(join(dir, name)).exists()) return { root: dir, entry: name };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Take the JSON a probe framed, ignoring whatever the app printed around it.
 *
 * The *last* sentinel wins: a log line quoting an earlier one cannot displace
 * the real answer, because the real answer is always written last.
 */
export function extractPayload(stdout: string): ProbeResult {
  const marker = stdout.lastIndexOf(PROBE_SENTINEL);
  if (marker === -1) {
    return {
      ok: false,
      message: "The probe produced no report — the app printed nothing this tool could read.",
    };
  }

  const body = stdout.slice(marker + PROBE_SENTINEL.length).trim();
  if (body.length === 0) {
    return { ok: false, message: "The probe framed an empty report." };
  }

  try {
    return { ok: true, data: JSON.parse(body) as unknown };
  } catch (error) {
    return {
      ok: false,
      message: `The probe's report was not valid JSON: ${describe(error)}`,
    };
  }
}

/** The real runner: spawns the app's CLI and reads one topic out of it. */
export function spawnProbe(options: SpawnProbeOptions = {}): ProbeRunner {
  const startDir = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async run(topic, signal) {
      const app = await findApp(startDir);
      if (!app) {
        return {
          ok: false,
          message:
            `No Zerotal app found at or above ${startDir} — looked for a package.json beside ` +
            `${ENTRY_NAMES.join(" or ")}. Run this server from the project root.`,
        };
      }

      // `process.execPath` rather than "bun": the app must run on the same
      // runtime as this server, and a PATH lookup can find a different one.
      const child = Bun.spawn([process.execPath, app.entry, "arch:probe", topic], {
        cwd: app.root,
        stdout: "pipe",
        stderr: "pipe",
        // The probe reads config and the filesystem; it must not inherit a
        // terminal it could block on.
        stdin: "ignore",
      });

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      const abort = (): void => void child.kill();
      signal.addEventListener("abort", abort, { once: true });

      try {
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);

        if (timedOut) {
          return { ok: false, message: `The app did not boot within ${timeoutMs / 1000}s.` };
        }
        if (signal.aborted) return { ok: false, message: "Cancelled." };

        const payload = extractPayload(stdout);
        if (payload.ok) return payload;

        // The app failed to boot, or the topic threw. Its stderr is the only
        // thing that explains why, and it is exactly what the caller needs.
        const detail = stderr.trim() || stdout.trim();
        return {
          ok: false,
          message:
            `\`bun ${app.entry} arch:probe ${topic}\` exited ${code}.` +
            (detail ? `\n\n${detail}` : ` ${payload.message}`),
        };
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      }
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
