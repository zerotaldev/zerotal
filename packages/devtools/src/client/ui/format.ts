/**
 * The small formatters every tab shares.
 *
 * They were nine closures inside `DevTools.start()`, which meant a tab could not
 * be moved into a file of its own without taking copies of them with it. Nothing
 * here touches the DOM or the store — it is all value-in, string-out.
 */
import { editorUrl, shortLocation, type SourceLocation } from "../../editor.ts";
import type { EditorSettings } from "../state.ts";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * HTML-escape a value for interpolation into markup **or** an attribute.
 *
 * Quotes are escaped as well as angle brackets, which is what makes it safe for
 * `title="…"` and for the mail preview's `srcdoc="…"` — the panel renders text it
 * did not write, on the app's own origin.
 */
export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/** Drop the trailing zeros a fixed-precision number leaves behind: `3.0` → `3`. */
function _trim(text: string): string {
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

/**
 * A duration, at a precision worth reading.
 *
 * Precision scales with magnitude, because the interesting digits move: at 400ms
 * nobody cares about the decimal, and at 0.4ms the decimal is the whole number.
 * Both ends were wrong before. This interpolated the value raw, so anything
 * measured with `performance.now()` printed its full float — the status bar read
 * `3.6370999999926426ms` — while anything a caller had already rounded printed
 * `0ms` for a query that plainly took time.
 */
export function fmt(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms === 0) return "0ms";
  if (ms >= 1000) return `${_trim((ms / 1000).toFixed(2))}s`;
  if (ms >= 100) return `${Math.round(ms)}ms`;
  if (ms >= 1) return `${_trim(ms.toFixed(1))}ms`;
  return `${_trim(ms.toFixed(2))}ms`;
}

/** A byte count as KB or MB. */
export function fmtMem(b: number): string {
  return b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`;
}

/** The colour class for a request duration — empty for "unremarkable". */
export function dCls(ms: number): string {
  return ms > 1000 ? "red" : ms > 300 ? "yellow" : "";
}

/** The colour class for a status code. */
export function scCls(s: number): string {
  return s >= 500 ? "srv" : s >= 400 ? "cli" : s >= 300 ? "redir" : "ok";
}

/** One channel value, as a single line of text. */
export function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v) ?? "";
  return String(v);
}

/**
 * A badge chip, accented by hashing its own text.
 *
 * `partial` and `deferred` need to be tellable apart at a glance, and the only
 * way to do that without devtools holding a list of every value every package
 * might use is to derive the colour from the value itself. Stable per value, so
 * a badge keeps its colour between requests.
 */
export function chipFor(text: string, warn: boolean): string {
  if (warn) return `<span class="chip warn">${esc(text)}</span>`;
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return `<span class="chip a${hash % 6}">${esc(text)}</span>`;
}

/**
 * A copy-to-clipboard button carrying its own payload.
 *
 * The text rides in a data attribute rather than being read back out of the
 * rendered DOM, because what you want on the clipboard is rarely what is on
 * screen — the SQL without its duration bar, the log line without its offset.
 * The shell's delegated handler does the copying; this only marks the target.
 */
export function copyBtn(text: string, label = "Copy"): string {
  if (!text) return "";
  return `<button class="cpy" data-copy="${esc(text)}" title="${esc(label)}">⧉</button>`;
}

/** The table an N+1 warning's SQL reads from, for the suppression call. */
export function tableFrom(sql: string): string {
  return /from\s+[`'"[]?(\w+)/i.exec(sql)?.[1] ?? "table_name";
}

/**
 * A source location, as a link to the editor when there is one to make.
 *
 * The panel renders a location the same way everywhere it appears — a query's
 * call site, a log line's, a stack frame, a prop's render source — because the
 * gesture is the same one every time: this is where it happened, go there.
 *
 * Falls back to plain text when `editor` is null or the location has no file. A
 * location worth showing is still worth showing when it cannot be opened.
 *
 * @param location - Where, or null/undefined for nothing at all.
 * @param editor - The panel's resolved editor settings.
 * @param extraClass - Appended to the element's class, for per-surface spacing.
 */
export function sourceLink(
  location: SourceLocation | null | undefined,
  editor: EditorSettings,
  extraClass = "",
): string {
  if (!location?.file) return "";
  const label = shortLocation(location);
  const title = location.function
    ? `${location.function} — ${location.file}:${location.line}`
    : `${location.file}:${location.line}`;
  const url = editorUrl(location, editor.editor, editor.editorPathMap);
  const cls = `src${extraClass ? ` ${extraClass}` : ""}`;
  if (!url) return `<span class="${cls}" title="${esc(title)}">${esc(label)}</span>`;
  return `<a class="${cls} link" href="${esc(url)}" title="${esc(title)}">${esc(label)}</a>`;
}
