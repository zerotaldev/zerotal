/**
 * Cache → observer bridges. The cache emits its own `CacheQueried` / `CacheEvicted`
 * framework events on the core `FrameworkEvents` bus; this module forwards them to
 * whichever observer packages are installed.
 *
 * Each observer's write surface is resolved from the container by binding key and
 * typed through a local structural interface, so the cache depends on none of the
 * observer packages — installing or removing an observer requires no change here.
 */
import { FrameworkEvents, RequestContext } from "@zerotal/core";
import type { Application } from "@zerotal/core";
import { CacheQueried, CacheEvicted } from "./events.ts";

/** The subset of the monitor store this bridge calls (bound as `monitor.store`). */
interface MonitorSink {
  recordCache(hit: boolean, key?: string): void;
  recordEvent(e: {
    kind: string;
    label: string;
    status?: "ok" | "warn" | "bad" | "info";
    route?: string | null;
    data?: Record<string, unknown>;
  }): void;
}

/** The subset of the devtools trace sink this bridge calls (bound as `devtools.trace`). */
interface DevtoolsSink {
  bufferCache(
    ctx: object,
    c: {
      op: "has" | "hit" | "miss" | "write" | "forget" | "flush";
      key: string;
      ttl?: number | undefined;
      durationMs: number;
    },
  ): void;
}

/**
 * Subscribe the cache's events to every installed observer. Returns a disposer that
 * removes every subscription; call it from the cache provider's `onStopping()`.
 */
export function installCacheObservability(app: Application): () => void {
  const unsubs: Array<() => void> = [];

  const store = app.container.tryMake("monitor.store" as never) as MonitorSink | undefined;
  if (store) {
    unsubs.push(
      FrameworkEvents.on(CacheQueried, (e) => {
        if (e.op === "hit") store.recordCache(true, e.key);
        else if (e.op === "miss") store.recordCache(false, e.key);
      }),
      FrameworkEvents.on(CacheEvicted, (e) =>
        store.recordEvent({
          kind: "cache_evict",
          label: e.key,
          status: "info",
          route: null,
          data: { detail: e.reason },
        }),
      ),
    );
  }

  const trace = app.container.tryMake("devtools.trace" as never) as DevtoolsSink | undefined;
  if (trace) {
    unsubs.push(
      FrameworkEvents.on(CacheQueried, (e) => {
        const ctx = RequestContext.tryGet();
        if (!ctx) return;
        trace.bufferCache(ctx, { op: e.op, key: e.key, ttl: e.ttl, durationMs: e.durationMs });
      }),
    );
  }

  return () => {
    for (const unsub of unsubs) unsub();
  };
}
