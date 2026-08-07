/**
 * Manages the set of active SSE connections for the dev auto-reload feature.
 *
 * Used by ServeCommand (--dev-worker mode):
 *   - handleSSE()     — returns a streaming Response for GET /__dev/events
 *   - broadcast(msg)  — pushes a message to every connected browser tab
 *
 * The Application registers the /__dev/events route before starting only when
 * withDevReload() is called. Zero code runs in production.
 */

const _encoder = new TextEncoder();

// Set of live stream controllers — one per connected browser tab.
const _clients = new Set<ReadableStreamDefaultController<Uint8Array>>();

let _pingTimer: ReturnType<typeof setInterval> | null = null;

function _startPing(): void {
  if (_pingTimer) return;
  _pingTimer = setInterval(() => broadcast("ping"), 25_000);
}

function _stopPing(): void {
  if (_pingTimer) {
    clearInterval(_pingTimer);
    _pingTimer = null;
  }
}

/**
 * Return a Server-Sent Events streaming Response.
 * Pass this as the handler for GET /__dev/events.
 */
export function handleSSE(): Response {
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      _clients.add(controller);
      _startPing();
      // Handshake event — confirms the connection is live.
      controller.enqueue(_encoder.encode("data: connected\n\n"));
    },
    // `cancel(reason)` receives the cancellation reason, not the controller.
    // Use the captured controller reference so we remove the correct entry.
    cancel() {
      if (streamController) {
        _clients.delete(streamController);
        streamController = null;
      }
      if (_clients.size === 0) _stopPing();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering for SSE
    },
  });
}

/**
 * Push a message to all connected browser tabs.
 * Stale controllers (closed tabs) are silently pruned.
 */
export function broadcast(message: string): void {
  const payload = _encoder.encode(`data: ${message}\n\n`);
  const staleControllers: ReadableStreamDefaultController<Uint8Array>[] = [];

  for (const controller of _clients) {
    try {
      controller.enqueue(payload);
    } catch {
      staleControllers.push(controller);
    }
  }

  for (const controller of staleControllers) _clients.delete(controller);
  if (_clients.size === 0) _stopPing();
}
