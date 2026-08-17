// The `@zerotal/client/Socket` subpath, not the package root. The root also
// exports `ClientProvider`, which imports `@zerotal/core` and so reaches the CLI
// command modules — one of which does `await import("bun")`. That is a hard
// error in a browser bundle before tree-shaking gets a chance to drop it, so
// importing `Socket` from the root fails the build outright. See T16.
import { Socket } from "@zerotal/client/Socket";

/**
 * The app's one WebSocket connection.
 *
 * A module-level singleton rather than a socket per component: a connection is
 * expensive to open and the server counts them, so two pages mounting at once
 * should share one. Created lazily on first use so importing this module — which
 * every page bundle does transitively — does not itself open a connection.
 *
 * `@zerotal/client`'s `Socket` handles reconnection and re-subscription, and it
 * re-fetches channel authorization on reconnect because the signature is bound
 * to the socket id. None of that has to be repeated here.
 */

let socket: Socket | null = null;

export function getSocket(): Socket {
  socket ??= new Socket();
  return socket;
}

/**
 * The header that makes `toOthers()` work.
 *
 * The server reads `X-Socket-ID` to decide which connection *not* to send a
 * broadcast to. Without it, the client that just posted a comment receives its
 * own comment back over the socket and renders it twice — once from the Inertia
 * response and once from the broadcast.
 *
 * Empty until the connection handshake completes, which is fine: no socket id
 * means nothing to exclude, and the page has no live connection to duplicate
 * onto anyway.
 */
export function socketHeaders(): Record<string, string> {
  const id = socket?.socketId();
  return id ? { "X-Socket-ID": id } : {};
}
