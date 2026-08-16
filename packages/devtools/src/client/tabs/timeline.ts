/**
 * Everything the request did, on one waterfall.
 *
 * Every entry already carries an offset from the request start; the waterfall is
 * what makes "what was waiting on what" legible instead of a column of numbers
 * you have to order in your head.
 */
import { esc, fmt } from "../ui/format.ts";
import type { ClientMetric } from "../metrics.ts";
import type { TabView } from "./types.ts";

/**
 * What the browser measured, above what the server did.
 *
 * Kept visibly separate rather than merged into the waterfall: these describe
 * the *page*, not this request, and drawing them on the same track would claim a
 * relationship that is not there. Shown anyway, because server duration reported
 * as if it were the user's experience is the panel's most misleading number.
 */
function clientStrip(metrics: ClientMetric[]): string {
  if (!metrics.length) return "";
  return (
    `<div class="stats">` +
    metrics
      .map(
        (m) =>
          `<div class="stat" title="${esc(m.detail)}">` +
          `<div class="slbl">${esc(m.label)}</div>` +
          `<div class="sval">${fmt(m.value)}</div></div>`,
      )
      .join("") +
    `</div>` +
    `<div class="dim" style="font-size:10px;padding:4px 12px">` +
    `Measured in the browser, for this page load — not for this request.</div>`
  );
}

interface Span {
  at: number;
  dur: number;
  kind: string;
  text: string;
}

const KEY: Array<[string, string]> = [
  ["query", "Queries"],
  ["cache", "Cache"],
  ["mail", "Mail"],
  ["job", "Jobs"],
  ["chan", "Channels"],
  ["log", "Logs"],
  ["warn", "Warnings"],
];

export const timelineTab: TabView = {
  id: "timeline",
  label: "Timeline",

  render(host, { trace, store }) {
    const t = trace!;
    const spans: Span[] = [];

    for (const q of t.queries) {
      spans.push({
        at: Math.max(0, q.startMs - t.startMs),
        dur: q.durationMs,
        kind: "query",
        text: q.sql,
      });
    }
    for (const c of t.cache ?? []) {
      spans.push({ at: c.offsetMs, dur: c.durationMs, kind: "cache", text: `${c.op} ${c.key}` });
    }
    for (const m of t.mail ?? []) {
      spans.push({ at: m.offsetMs, dur: m.durationMs, kind: "mail", text: m.subject });
    }
    for (const j of t.jobs ?? []) {
      spans.push({ at: j.offsetMs, dur: j.durationMs, kind: "job", text: j.className });
    }
    for (const l of t.logs ?? []) {
      spans.push({
        at: l.offsetMs,
        dur: 0,
        kind: l.level === "error" || l.level === "warn" ? "warn" : "log",
        text: l.args.join(" "),
      });
    }
    for (const [id, rows] of Object.entries(t.channels ?? {})) {
      const desc = store.channels.find((c) => c.id === id);
      for (const r of rows) {
        const titleKey = desc?.title ?? desc?.badge;
        spans.push({
          at: r.offsetMs,
          dur: typeof r["durationMs"] === "number" ? (r["durationMs"] as number) : 0,
          kind: "chan",
          text: `${desc?.label ?? id}: ${titleKey ? String(r[titleKey] ?? "") : ""}`,
        });
      }
    }

    const client = clientStrip(store.clientMetrics);

    if (!spans.length) {
      host.innerHTML =
        client + '<p class="empty">Nothing recorded on the timeline for this request</p>';
      return;
    }

    spans.sort((a, b) => a.at - b.at);
    const total = Math.max(1, t.durationMs);

    host.innerHTML =
      client +
      `<div class="tkey">` +
      KEY.map(([k, lbl]) => `<span><i class="tmark ${k}"></i>${lbl}</span>`).join("") +
      `</div><div>` +
      spans
        .map((s) => {
          const left = Math.min(99, (s.at / total) * 100);
          const width = Math.max(0.6, Math.min(100 - left, (s.dur / total) * 100));
          return (
            `<div class="trow">` +
            `<span class="tlbl dim">+${s.at}ms</span>` +
            `<span class="ttrack"><span class="tmark ${s.kind}" style="left:${left}%;width:${width}%"></span></span>` +
            `<span class="ttxt dim" title="${esc(s.text)}">${esc(s.text)}</span>` +
            `</div>`
          );
        })
        .join("") +
      `</div>`;
  },
};
