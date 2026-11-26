/**
 * Dev-reload WebSocket server.
 *
 * Manages the set of browser tabs connected to the /__dev/ws endpoint.
 * When the DevOrchestrator detects a file change it writes "reload\n" to
 * the dev-worker's stdin; ServeCommand reads that line and calls broadcast()
 * here, pushing the message to every connected tab.
 *
 * The browser client (injected by InertiaProvider) reconnects automatically
 * on close, so server restarts never create a reload loop.
 */

/** A connected dev-reload browser socket. */
type DevSocket = {
  data: Record<string, unknown>;
  send(message: string): void;
};

const _clients = new Set<DevSocket>();

/**
 * What the last frontend build said when it failed, or `null` while it is good.
 *
 * Held here, not only broadcast, because the tab that most needs it is the one that opens next:
 * a developer who breaks a page reloads it, and that new tab connects after the push went out.
 */
let _buildError: string[] | null = null;

/** The message that carries a failed build's lines to the browser. */
function _buildErrorMessage(lines: readonly string[]): string {
  return `build-error:${JSON.stringify(lines)}`;
}

/** Register a newly opened dev-reload socket, and tell it about a failed build at once. */
export function open(socket: DevSocket): void {
  _clients.add(socket);
  if (_buildError) {
    try {
      socket.send(_buildErrorMessage(_buildError));
    } catch {
      /* closed between upgrade and open — the tab reconnects and is told then */
    }
  }
}

/**
 * Record the frontend build's outcome and show it in every open tab: its lines when it failed,
 * which `/__dev/reload.js` draws over the page, or `null` when it is good again.
 *
 * @internal Called by the dev worker when the orchestrator reports a build.
 */
export function _setBuildError(lines: readonly string[] | null): void {
  const next = lines && lines.length > 0 ? [...lines] : null;
  if (next === null && _buildError === null) return;
  _buildError = next;
  broadcast(next ? _buildErrorMessage(next) : "build-ok");
}

/** @internal The failed build's lines, if the last build failed (tests). */
export function _currentBuildError(): string[] | null {
  return _buildError;
}

/** Forget a closed dev-reload socket. */
export function close(socket: DevSocket): void {
  _clients.delete(socket);
}

/**
 * Push a message to every connected dev browser tab.
 * Stale sockets (closed tabs) are pruned lazily on send failure.
 */
export function broadcast(message: string): void {
  const staleSockets: DevSocket[] = [];
  for (const socket of _clients) {
    try {
      socket.send(message);
    } catch {
      staleSockets.push(socket);
    }
  }
  for (const socket of staleSockets) _clients.delete(socket);
}
