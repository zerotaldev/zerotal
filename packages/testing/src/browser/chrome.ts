/**
 * Getting a headless browser, and saying clearly why you could not.
 *
 * `Bun.WebView` reaches Chrome two ways, and both are first-class here:
 *
 * - **spawn** — `backend: "chrome"`, which launches its own headless instance
 *   over `--remote-debugging-pipe`. Nothing to set up.
 * - **connect** — `backend: { type: "chrome", url }`, against a browser already
 *   running with `--remote-debugging-port`.
 *
 * Connect is not a fallback for tidiness. On Windows, Bun 1.3.14 cannot spawn
 * Chrome at all — it throws `Failed to spawn Chrome` even with `BUN_CHROME_PATH`
 * set and the binary verified present — so connect is the only path a Windows
 * developer has. Set `ZT_BROWSER_CDP_URL` and the harness uses it.
 */

/** How the harness reached a browser, or why it did not. */
export interface BrowserAvailability {
  available: boolean;
  /** `spawn` launched its own; `connect` attached to a running one. */
  mode: "spawn" | "connect" | "none";
  /** Human-facing explanation — printed when a suite skips. */
  reason: string;
}

/** Env var carrying a CDP WebSocket URL, for connect-mode. */
export const CDP_URL_ENV = "ZT_BROWSER_CDP_URL";

let _cached: BrowserAvailability | null = null;

function connectUrl(): string | undefined {
  const url = Bun.env[CDP_URL_ENV];
  return url && url.length > 0 ? url : undefined;
}

/** The backend descriptor for a new view, honouring connect-mode when configured. */
export function backendOption(): "chrome" | { type: "chrome"; url: string } {
  const url = connectUrl();
  return url ? { type: "chrome", url } : "chrome";
}

/**
 * Whether a browser can be reached, cached for the process.
 *
 * Probes by actually opening a view and navigating — a Chrome binary that exists
 * but cannot start is the failure mode worth catching, and it is invisible to a
 * `which chrome`.
 */
export async function browserAvailability(): Promise<BrowserAvailability> {
  if (_cached) return _cached;

  const url = connectUrl();
  try {
    const view = new Bun.WebView({ backend: backendOption() });
    try {
      await view.navigate("about:blank");
      await view.evaluate("1");
    } finally {
      view.close();
    }
    _cached = {
      available: true,
      mode: url ? "connect" : "spawn",
      reason: url ? `connected to ${url}` : "spawned a headless Chrome",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    _cached = {
      available: false,
      mode: "none",
      reason:
        `no headless browser: ${message}\n` +
        `  Install Chrome or Chromium, or start one with --remote-debugging-port ` +
        `and set ${CDP_URL_ENV} to its webSocketDebuggerUrl ` +
        `(read it from http://127.0.0.1:<port>/json/version).`,
    };
  }
  return _cached;
}

/**
 * True when a skipped browser suite is not acceptable.
 *
 * A browser suite that goes quietly green in CI is precisely the failure this
 * harness exists to prevent, so CI treats "no browser" as a failure while a
 * developer's machine treats it as a skip.
 */
export function browserRequired(): boolean {
  return Bun.env["CI"] !== undefined && Bun.env["CI"] !== "" && Bun.env["CI"] !== "false";
}
