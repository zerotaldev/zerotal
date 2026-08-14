/**
 * Probe a deployed app's WebSocket transport the way a browser would.
 *
 * Every static check in the doctor runs inside the process, and the expensive production
 * failures are precisely the ones that cannot be seen from there: a reverse proxy that
 * gates the transport path, an origin guard comparing against the loopback address the app
 * bound to, a proxy that never forwards the upgrade. All of them leave the app healthy
 * from the inside — the HTML renders, the logs are quiet, a status-code health check
 * passes — while every action in the browser does nothing.
 *
 * So this probe goes the long way round: out through the public URL, back through the
 * proxy. It sends a real handshake with a real `Origin`, and reads the status the server
 * actually returned.
 *
 * ## Why not curl
 *
 * You can do this by hand, with one caveat that costs an hour the first time: curl over
 * TLS negotiates HTTP/2, where `Connection: Upgrade` is meaningless, and the server answers
 * `404` on a route that is working perfectly. Browsers use HTTP/1.1 for WebSockets, so any
 * hand-run check needs `--http1.1`:
 *
 * ```bash
 * curl -s -o /dev/null -w '%{http_code}\n' --http1.1 \
 *      -H 'Origin: https://your.app' -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
 *      -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
 *      https://your.app/__flow/ws          # expect 101
 * ```
 */

/** The outcome of one handshake attempt. */
export interface TransportProbeResult {
  /** The full URL probed. */
  url: string;
  /** HTTP status returned to the handshake, or null when the request never completed. */
  status: number | null;
  /** Whether the transport is usable from a browser at this origin. */
  ok: boolean;
  /** What the status means here, in one line. */
  message: string;
  /** The change that fixes it, when the diagnosis implies one. */
  fix?: string;
}

/** A WebSocket handshake is an ordinary HTTP request until the server agrees to switch. */
function _handshakeHeaders(origin: string): Record<string, string> {
  return {
    Origin: origin,
    Connection: "Upgrade",
    Upgrade: "websocket",
    "Sec-WebSocket-Version": "13",
    // Any base64 of 16 bytes. The server echoes a derivation of it; nothing here checks
    // that, because the status code is the whole signal.
    "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
  };
}

/** Turn a handshake status into a diagnosis. */
function _diagnose(status: number): Omit<TransportProbeResult, "url" | "status"> {
  if (status === 101) {
    return { ok: true, message: "101 Switching Protocols — a browser can open this socket." };
  }
  if (status === 401 || status === 407) {
    return {
      ok: false,
      message:
        `${status} — something in front of the app is asking for credentials. Browsers do ` +
        `not attach basic-auth credentials to a WebSocket handshake, so any auth gate over ` +
        `this path blocks the transport outright.`,
      fix: "Exempt the transport path at the proxy, e.g. Caddy: `@gated not path /__flow/*`.",
    };
  }
  if (status === 403) {
    return {
      ok: false,
      message:
        "403 — the origin guard refused this Origin. Behind a proxy the app's own origin is " +
        "the loopback address it bound to, so the public origin has to be configured.",
      fix: "Set url in config/app.ts to the public URL (AppConfig fills allowedOrigins from it).",
    };
  }
  if (status === 404) {
    return {
      ok: false,
      message:
        "404 — nothing handled the upgrade. Either the proxy is not forwarding this path, " +
        "or it terminated the request on a protocol where Upgrade has no meaning.",
      fix: "Check the proxy forwards this path to the app, and that it speaks HTTP/1.1 upstream.",
    };
  }
  if (status === 426 || status === 400) {
    return {
      ok: false,
      message:
        `${status} — the upgrade was not negotiated. Usually the request reached the app ` +
        `over a protocol that cannot upgrade (HTTP/2), rather than a fault in the app.`,
      fix: "Ensure the proxy connects to the app over HTTP/1.1 and does not buffer the connection.",
    };
  }
  if (status >= 500) {
    return {
      ok: false,
      message: `${status} — the app errored handling the handshake. Check its logs.`,
    };
  }
  return { ok: false, message: `${status} — unexpected; a working transport answers 101.` };
}

/**
 * Attempt a WebSocket handshake against `url`, declaring `origin`, and report what came back.
 *
 * @param url - The absolute ws/http URL to probe. `http`/`https` are used as-is; the
 *   handshake is an HTTP request.
 * @param origin - The `Origin` to send — the public origin a browser would send.
 * @param timeoutMs - How long to wait before giving up. Default 10s.
 */
export async function probeWebSocket(
  url: string,
  origin: string,
  timeoutMs = 10_000,
): Promise<TransportProbeResult> {
  try {
    const response = await fetch(url, {
      headers: _handshakeHeaders(origin),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    // A 3xx here is a redirect the browser would follow for a page but not for a socket.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") ?? "elsewhere";
      return {
        url,
        status: response.status,
        ok: false,
        message: `${response.status} — redirected to ${location}. A WebSocket handshake is not redirected; probe the final URL.`,
        fix: `Probe ${location} instead, or stop redirecting the transport path.`,
      };
    }
    return { url, status: response.status, ..._diagnose(response.status) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      url,
      status: null,
      ok: false,
      message: `the request never completed: ${reason}`,
      fix: "Check the host resolves, the TLS certificate is valid, and the port is reachable.",
    };
  }
}

/**
 * Probe every WebSocket path an app registered, against its public base URL.
 *
 * @param baseUrl - The public URL the app is served from, as a browser would reach it.
 * @param paths - Registered WS paths, from `app.webSocketPaths()`. Catch-all (`"*"`)
 *   registrations are skipped: there is no single URL that represents them.
 */
export async function probeTransport(
  baseUrl: string,
  paths: string[],
): Promise<TransportProbeResult[]> {
  const base = new URL(baseUrl);
  const results: TransportProbeResult[] = [];
  for (const path of paths) {
    if (path === "*") continue;
    results.push(await probeWebSocket(new URL(path, base).href, base.origin));
  }
  return results;
}
