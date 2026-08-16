/** Cache operations performed during the request. */
import type { CacheEntry } from "../../RequestTrace.ts";
import { esc, fmt } from "../ui/format.ts";
import type { TabView } from "./types.ts";

function opClass(op: CacheEntry["op"]): string {
  if (op === "hit") return "green";
  if (op === "miss") return "yellow";
  if (op === "write") return "cyan";
  return "dim";
}

export const cacheTab: TabView = {
  id: "cache",
  label: "Cache",
  scope: "request",

  badge: ({ trace }) => (trace ? { count: trace.cache?.length ?? 0 } : undefined),

  render(host, { trace }) {
    const cache = trace!.cache ?? [];
    if (!cache.length) {
      host.innerHTML = '<p class="empty">No cache operations during this request</p>';
      return;
    }
    const hits = cache.filter((c) => c.op === "hit").length;
    const misses = cache.filter((c) => c.op === "miss").length;

    host.innerHTML =
      `<div class="stats">` +
      `<div class="stat"><div class="slbl">Operations</div><div class="sval">${cache.length}</div></div>` +
      `<div class="stat"><div class="slbl">Hits</div><div class="sval green">${hits}</div></div>` +
      `<div class="stat"><div class="slbl">Misses</div><div class="sval yellow">${misses}</div></div>` +
      `</div><div>` +
      cache
        .map(
          (c) =>
            `<div class="qrow">` +
            `<div class="qmeta">` +
            `<span class="qdur ${opClass(c.op)}">${c.op.toUpperCase()}</span>` +
            `<span class="dim" style="flex:1;font-size:11px">${esc(c.key)}</span>` +
            `<span class="dim" style="font-size:10px">${fmt(c.durationMs)}</span>` +
            `</div>` +
            `<div class="dim" style="font-size:10px">${c.ttl != null ? `TTL: ${c.ttl}s · ` : ""}+${c.offsetMs}ms</div>` +
            `</div>`,
        )
        .join("") +
      `</div>`;
  },
};
