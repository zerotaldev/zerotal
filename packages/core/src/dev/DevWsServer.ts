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

/** Register a newly opened dev-reload socket. */
export function open(socket: DevSocket): void {
  _clients.add(socket);
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
