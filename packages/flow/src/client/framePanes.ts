/**
 * What a time-travel frame opens into, as a small strip of its own tabs.
 *
 * The same shape a request uses in the devtools list, and for the same reason:
 * the views are alternatives, not a sequence. You are reading the arguments the
 * click sent, *or* the state it moved, *or* the SQL it ran on the server — and
 * stacking them makes you scroll past two to reach the third.
 *
 * Only the views a frame actually has appear, so the strip doubles as the
 * summary: a frame showing `Sent · State 2 · Server · Queries 3` has told you
 * what the action did before you click anything.
 *
 * Pure string-building, with no `window` or `document` at module scope, so the
 * decisions here are testable without a browser — which is the point, since the
 * interesting cases (an action that queried, an action that only logged) depend
 * on a signed-in session that is awkward to drive in a headless one.
 */
import type { TimelineFrame } from "./timeline.ts";

/** What the server did while handling one action, read off its devtools trace. */
export interface FrameServerCost {
  durationMs: number;
  ip: string | null;
  statusCode: number | null;
  queries: Array<{ sql: string; durationMs: number | null; rowCount: number | null }>;
  logs: Array<{ level: string; text: string }>;
  error: string | null;
}

/** One view of an action: a tab in the frame's own strip. */
export interface FramePane {
  id: string;
  label: string;
  /** Shown beside the label when the view counts something. */
  count?: number;
  html: string;
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A value as the panes show it — compact JSON, truncated rather than wrapped. */
export function brief(value: unknown, max = 160): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined || text === null) text = String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The value out of a snapshot entry, which is stored as `[value, meta]`.
 *
 * A developer reading a state diff wants `1 → 2`, not `[1,{}] → [2,{}]`: the
 * second slot is the framework's own bookkeeping and only earns space when it
 * holds something.
 */
export function snapshotValue(entry: unknown): unknown {
  if (!Array.isArray(entry) || entry.length === 0) return entry;
  const [value, meta] = entry as [unknown, unknown];
  const bare =
    meta === undefined || meta === null || (isPlainObject(meta) && !Object.keys(meta).length);
  return bare ? value : { value, meta };
}

/** One `key  before → after` row per field the action changed. */
function stateHtml(frame: TimelineFrame, frames: readonly TimelineFrame[]): string {
  if (!frame.changed.length) return "";
  const prior = frames.filter((f) => f.compId === frame.compId && f.seq < frame.seq).pop();
  const before = prior?.snapshot?.data as Record<string, unknown> | undefined;
  const after = frame.snapshot?.data as Record<string, unknown> | undefined;

  return frame.changed
    .map((key) => {
      const from = before && key in before ? brief(snapshotValue(before[key]), 60) : "—";
      const to = after && key in after ? brief(snapshotValue(after[key]), 60) : "—";
      return (
        `<div style="display:flex;gap:8px;align-items:baseline;padding:1px 0">` +
        `<span style="min-width:120px;color:var(--cyan)">${esc(key)}</span>` +
        `<span class="dim">${esc(from)}</span>` +
        `<span class="dim">→</span>` +
        `<span style="color:var(--green)">${esc(to)}</span>` +
        `</div>`
      );
    })
    .join("");
}

/** The call the browser made: its arguments, and any client writes flushed with it. */
function sentHtml(frame: TimelineFrame): string {
  if (!frame.sent) return "";
  const args = frame.sent.args.length
    ? frame.sent.args.map((a) => brief(a, 80)).join(", ")
    : "no arguments";
  const updates = frame.sent.updates ? Object.entries(frame.sent.updates) : [];
  const updateRows = updates
    .map(
      ([k, v]) =>
        `<div style="display:flex;gap:8px;padding:1px 0">` +
        `<span style="min-width:120px;color:var(--cyan)">${esc(k)}</span>` +
        `<span class="dim">${esc(brief(v, 60))}</span></div>`,
    )
    .join("");
  return (
    `<div><span style="color:var(--purple)">${esc(frame.action)}</span>` +
    `<span class="dim">(${esc(args)})</span></div>` +
    (updateRows
      ? `<div class="dim" style="font-size:10px;margin:4px 0 1px">flushed with the call</div>${updateRows}`
      : "")
  );
}

function serverHtml(s: FrameServerCost): string {
  return (
    `<div style="display:flex;gap:10px;flex-wrap:wrap">` +
    `<span class="dim">${s.durationMs}ms</span>` +
    (s.statusCode ? `<span class="dim">status ${s.statusCode}</span>` : "") +
    (s.ip ? `<span class="dim">from ${esc(s.ip)}</span>` : "") +
    `</div>` +
    (s.error ? `<div class="red" style="margin-top:2px">${esc(s.error)}</div>` : "")
  );
}

function queriesHtml(s: FrameServerCost): string {
  return s.queries
    .map(
      (q) =>
        `<div style="display:flex;gap:8px;align-items:baseline;padding:1px 0">` +
        `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(brief(q.sql, 140))}</span>` +
        `<span class="dim" style="font-size:10px">${q.durationMs ?? "—"}ms` +
        `${q.rowCount === null ? "" : ` · ${q.rowCount} row${q.rowCount === 1 ? "" : "s"}`}</span>` +
        `</div>`,
    )
    .join("");
}

function logsHtml(s: FrameServerCost): string {
  return s.logs
    .map(
      (l) =>
        `<div style="padding:1px 0">` +
        `<span class="dim" style="min-width:44px;display:inline-block">${esc(l.level)}</span>` +
        `${esc(brief(l.text, 140))}</div>`,
    )
    .join("");
}

/**
 * The views a frame has to offer, in reading order.
 *
 * `cost` is null for a frame that never left the browser — a client expression —
 * and that frame says so rather than showing an empty Server pane.
 */
export function framePanes(
  frame: TimelineFrame,
  frames: readonly TimelineFrame[],
  cost: FrameServerCost | null,
): FramePane[] {
  const panes: FramePane[] = [];

  const sent = sentHtml(frame);
  if (sent) panes.push({ id: "sent", label: "Sent", html: sent });

  const state = stateHtml(frame, frames);
  if (state) panes.push({ id: "state", label: "State", count: frame.changed.length, html: state });

  if (!cost) {
    panes.push({
      id: "server",
      label: "Server",
      html: `<div class="dim" style="font-size:11px">Ran in the browser — nothing was sent to the server.</div>`,
    });
    return panes;
  }

  panes.push({ id: "server", label: "Server", html: serverHtml(cost) });
  if (cost.queries.length) {
    panes.push({
      id: "queries",
      label: "Queries",
      count: cost.queries.length,
      html: queriesHtml(cost),
    });
  }
  if (cost.logs.length) {
    panes.push({ id: "logs", label: "Logs", count: cost.logs.length, html: logsHtml(cost) });
  }
  return panes;
}

/**
 * Which pane is showing, given what the reader last picked.
 *
 * One preference across every frame rather than one each: stepping down a list of
 * actions comparing the SQL of one against the next should keep showing SQL, not
 * return you to the arguments at each step. Falls back to the first pane the
 * frame in hand actually has.
 */
export function activePane(preferred: string, panes: FramePane[]): string {
  return panes.some((p) => p.id === preferred) ? preferred : (panes[0]?.id ?? "");
}

/** A frame's panes, as the strip plus the one body that is showing. */
export function renderFramePanes(panes: FramePane[], preferred: string): string {
  if (!panes.length) return "";
  const active = activePane(preferred, panes);
  const strip = panes
    .map(
      (p) =>
        `<button class="dsect${p.id === active ? " on" : ""}" data-fsec="${p.id}">` +
        `${esc(p.label)}` +
        (p.count === undefined ? "" : `<span class="dsec-n">${p.count}</span>`) +
        `</button>`,
    )
    .join("");
  const body = panes.find((p) => p.id === active)?.html ?? "";
  return (
    `<div class="dsecs">${strip}</div>` +
    `<div class="dsec-body" style="padding:6px 12px">${body}</div>`
  );
}
