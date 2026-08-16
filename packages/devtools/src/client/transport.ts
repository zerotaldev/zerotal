/**
 * The wire: one `EventSource` and three JSON endpoints.
 *
 * Split out because it is the only part of the panel that talks to the server,
 * and keeping it apart is what lets every tab be a pure function of the store.
 * `EventSource` reconnects on its own timer, so there is no retry loop here —
 * only the connection flag the bar's dot reads.
 */
import type { RequestTrace, TraceChannelDescriptor } from "../RequestTrace.ts";
import type { EditorName } from "../editor.ts";
import type { Store } from "./state.ts";

/** What the SSE stream sends. */
type Frame =
  | {
      type: "history";
      data: RequestTrace[];
      channels?: TraceChannelDescriptor[];
      capacity?: number;
      editor?: EditorName | null;
      editorPathMap?: Record<string, string>;
    }
  | { type: "trace"; data: RequestTrace }
  | { type: "clear" };

export interface Transport {
  /** Ask the server to drop its history. The `clear` frame comes back over SSE. */
  clear(): void;
  /** Close the stream. Called when the panel removes itself from the page. */
  close(): void;
}

/**
 * Connect the store to the stream.
 *
 * @param base - The devtools endpoint root, without a trailing slash.
 * @param store - Mutated as frames arrive; it announces its own changes.
 */
export function connect(base: string, store: Store): Transport {
  const sse = new EventSource(`${base}/sse`);

  sse.onopen = () => {
    store.connected = true;
    store.changed();
  };

  sse.onerror = () => {
    store.connected = false;
    store.changed();
  };

  sse.onmessage = (e: MessageEvent<string>) => {
    let frame: Frame;
    try {
      frame = JSON.parse(e.data) as Frame;
    } catch {
      // A truncated frame is the stream's problem, not the panel's; the next one
      // will be whole.
      return;
    }
    if (frame.type === "history") {
      store.loadHistory(frame.data, frame.channels ?? [], frame.capacity, {
        editor: frame.editor ?? null,
        editorPathMap: frame.editorPathMap ?? {},
      });
    } else if (frame.type === "trace") {
      store.addTrace(frame.data);
    } else {
      store.clear();
    }
  };

  return {
    clear() {
      void fetch(`${base}/api/clear`, { method: "POST" });
    },
    close() {
      sse.close();
    },
  };
}
