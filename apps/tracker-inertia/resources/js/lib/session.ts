/**
 * Telling the other tabs — feature 14.
 *
 * Signing out is a server-side act, and the server has no way to reach a page it
 * already rendered. So tab A goes on showing a board, an issue form with a
 * half-typed description, and an account menu naming someone who is no longer
 * signed in — until the next request, which fails.
 *
 * `BroadcastChannel` closes that gap: the tab that signs out says so, and every
 * other tab on the same origin hears it immediately.
 *
 * The `localStorage` fallback is not decoration. Safari shipped
 * `BroadcastChannel` late and some embedded webviews still lack it, and the
 * `storage` event has been reliable across tabs for a decade. Writing a key and
 * removing it fires that event everywhere *except* the writing tab, which is
 * exactly the audience.
 */

const CHANNEL = "tracker-session";
const STORAGE_PING = "tracker-session-ping";

export type SessionEvent = "signed-out";

/** Announce to every other tab. Safe to call when neither transport exists. */
export function announce(event: SessionEvent): void {
  try {
    if ("BroadcastChannel" in globalThis) {
      const channel = new BroadcastChannel(CHANNEL);
      channel.postMessage(event);
      channel.close();
      return;
    }
  } catch {
    // Fall through — a blocked BroadcastChannel is not worth an exception.
  }

  try {
    // The value must change for the `storage` event to fire, hence the stamp.
    localStorage.setItem(STORAGE_PING, `${event}:${Date.now()}`);
    localStorage.removeItem(STORAGE_PING);
  } catch {
    // Private mode. Other tabs simply find out on their next request.
  }
}

/** Listen for other tabs. Returns an unsubscribe. */
export function subscribe(onEvent: (event: SessionEvent) => void): () => void {
  const stops: Array<() => void> = [];

  try {
    if ("BroadcastChannel" in globalThis) {
      const channel = new BroadcastChannel(CHANNEL);
      const handler = (message: MessageEvent) => onEvent(message.data as SessionEvent);
      channel.addEventListener("message", handler);
      stops.push(() => {
        channel.removeEventListener("message", handler);
        channel.close();
      });
    }
  } catch {
    // No channel — the storage listener below still covers it.
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_PING || !event.newValue) return;
    onEvent(event.newValue.split(":")[0] as SessionEvent);
  };
  window.addEventListener("storage", onStorage);
  stops.push(() => window.removeEventListener("storage", onStorage));

  return () => stops.forEach((stop) => stop());
}
