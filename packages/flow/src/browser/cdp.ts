/**
 * A minimal Chrome DevTools Protocol client, with no dependencies.
 *
 * Flow's failure mode has always been silence: a button that renders correctly,
 * type-checks, compiles, and does nothing when clicked. Every such bug in two
 * rounds of field reports lived in the WebSocket bridge — the layer between a
 * real DOM event and the server action it should dispatch — and `FlowTest`
 * cannot reach it, because it calls actions directly instead of letting the
 * browser do it. The suite was deep and shaped away from where the bugs were.
 *
 * This is the missing layer: a real browser, a real socket, a real click.
 *
 * It speaks CDP over Bun's built-in WebSocket and drives a headless Chrome the
 * runtime already has, rather than pulling in Puppeteer or Playwright — the same
 * zero-dependency posture as the telemetry tracer and the media image driver.
 * The protocol surface needed is small: enable two domains, navigate, evaluate.
 */
import { rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Where Chrome lives, per platform. First hit wins. */
const CHROME_PATHS: Record<string, string[]> = {
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
};

/**
 * The browser binary to drive, or `null` when none is installed.
 *
 * `CHROME_PATH` overrides the search, which is how CI pins a specific build.
 * Returning `null` rather than throwing lets a suite skip itself on a machine
 * without a browser instead of failing — a browser test that cannot run is not
 * the same as one that failed.
 */
export function findChrome(): string | null {
  const override = Bun.env["CHROME_PATH"];
  if (override) return override;
  for (const candidate of CHROME_PATHS[process.platform] ?? []) {
    try {
      if (Bun.file(candidate).size > 0) return candidate;
    } catch {
      /* not here — keep looking */
    }
  }
  return null;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
}

/**
 * One CDP connection to one page target.
 *
 * Requests are correlated by the `id` field the protocol echoes back, so several
 * can be in flight; events (no `id`) are dispatched to listeners.
 */
export class CdpSession {
  private _nextId = 1;
  private readonly _pending = new Map<
    number,
    { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }
  >();
  private readonly _listeners = new Map<string, Array<(params: Record<string, unknown>) => void>>();

  private constructor(private readonly _ws: WebSocket) {}

  static async connect(wsUrl: string, timeoutMs = 10_000): Promise<CdpSession> {
    const ws = new WebSocket(wsUrl);
    const session = new CdpSession(ws);

    ws.addEventListener("message", (event: MessageEvent) => {
      let msg: CdpMessage;
      try {
        msg = JSON.parse(String(event.data)) as CdpMessage;
      } catch {
        return;
      }
      if (typeof msg.id === "number") {
        const pending = session._pending.get(msg.id);
        if (!pending) return;
        session._pending.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error.message));
        else pending.resolve(msg.result ?? {});
        return;
      }
      if (msg.method) {
        for (const fn of session._listeners.get(msg.method) ?? []) fn(msg.params ?? {});
      }
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP connect timed out")), timeoutMs);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("CDP socket error"));
      });
    });

    return session;
  }

  /** Issue a command and await its result. */
  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this._ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Subscribe to a protocol event. */
  on(method: string, fn: (params: Record<string, unknown>) => void): void {
    const list = this._listeners.get(method) ?? [];
    list.push(fn);
    this._listeners.set(method, list);
  }

  /** Resolve once `method` fires, or reject on timeout. */
  once(method: string, timeoutMs = 10_000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for ${method}`)),
        timeoutMs,
      );
      this.on(method, (params) => {
        clearTimeout(timer);
        resolve(params);
      });
    });
  }

  close(): void {
    try {
      this._ws.close();
    } catch {
      /* already gone */
    }
  }
}

/** A launched browser process plus the endpoint to talk to it. */
export interface LaunchedBrowser {
  session: CdpSession;
  close(): Promise<void>;
}

/** Poll `fn` until it returns a value, or throw after `timeoutMs`. */
async function poll<T>(fn: () => Promise<T | null>, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== null) return value;
    await Bun.sleep(50);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/**
 * Launch headless Chrome and attach to its first page target.
 *
 * Port 0 lets the OS pick, and Chrome writes the chosen port into
 * `DevToolsActivePort` in the profile directory — polling that file is more
 * reliable than parsing stderr, which differs between Chrome and Edge builds.
 */
export async function launchBrowser(chromePath: string): Promise<LaunchedBrowser> {
  const profile = join(tmpdir(), `zt-flow-cdp-${Math.random().toString(36).slice(2)}`);
  const proc = Bun.spawn(
    [
      chromePath,
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      // A sandboxed renderer cannot start as root in most CI images.
      "--no-sandbox",
      "about:blank",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );

  const cleanup = async (): Promise<void> => {
    try {
      proc.kill();
      await proc.exited;
    } catch {
      /* already dead */
    }

    // `proc.exited` resolving does not mean Windows has released the profile
    // directory: Chrome's child processes linger briefly with open handles, and
    // `rm` on a locked directory throws EBUSY. That surfaced as a browser test
    // failing roughly half the time, in cleanup, long after the assertions had
    // passed. Retry, then give up — a leftover directory under the OS temp path
    // is not worth failing a closed session over.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
      /* still locked — the OS reclaims it with the rest of temp */
    }
  };

  try {
    const port = await poll(
      async () => {
        try {
          const text = await readFile(join(profile, "DevToolsActivePort"), "utf8");
          const first = text.split("\n")[0]?.trim();
          return first && /^\d+$/.test(first) ? first : null;
        } catch {
          return null;
        }
      },
      60_000,
      "Chrome to report its debugging port",
    );

    // The first page target is the `about:blank` tab we asked for.
    const wsUrl = await poll(
      async () => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/json/list`);
          const targets = (await res.json()) as Array<{
            type: string;
            webSocketDebuggerUrl?: string;
          }>;
          return targets.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
        } catch {
          return null;
        }
      },
      60_000,
      "a page target",
    );

    const session = await CdpSession.connect(wsUrl);
    await session.send("Page.enable");
    await session.send("Runtime.enable");

    return {
      session,
      close: async () => {
        session.close();
        await cleanup();
      },
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
