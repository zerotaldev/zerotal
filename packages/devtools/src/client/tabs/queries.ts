/**
 * The default tab: what the request cost, what went wrong, and every statement
 * it ran.
 */
import type { QuerySpan, RequestTrace } from "../../RequestTrace.ts";
import type { EditorSettings } from "../state.ts";
import { copyBtn, dCls, esc, fmt, fmtMem, sourceLink, tableFrom } from "../ui/format.ts";
import type { TabView } from "./types.ts";

/**
 * The error that ended the request, above everything else about it.
 *
 * `RequestFailed` has always carried the message; the trace used to drop it, so a
 * failed request showed as a red status code with nothing to read. It heads this
 * tab rather than getting a tab of its own because on a request that threw, it is
 * the answer — and a tab you have to find first is not.
 */
function exceptionBanner(t: RequestTrace): string {
  if (!t.exception) return "";
  return (
    `<div class="exc">` +
    `<div class="exhead">✗ Request failed · ${t.exception.status}${copyBtn(t.exception.message, "Copy message")}</div>` +
    `<div class="exmsg">${esc(t.exception.message)}</div>` +
    `</div>`
  );
}

function queryRow(q: QuerySpan, peak: number, editor: EditorSettings): string {
  const pct = Math.round((q.durationMs / peak) * 100);
  const dc = q.durationMs < 10 ? "green" : q.durationMs < 100 ? "yellow" : "red";
  const bindings = q.bindings as unknown[] | undefined;
  const binds = bindings?.length
    ? `<div class="qbind"><span class="dim">bindings: </span>` +
      bindings
        .map((v) =>
          v == null
            ? '<span class="bind">null</span>'
            : typeof v === "string"
              ? `<span class="bind">'${esc(v)}'</span>`
              : `<span class="bind">${esc(String(v))}</span>`,
        )
        .join('<span class="dim">, </span>') +
      `</div>`
    : "";
  return (
    `<div class="qrow">` +
    `<div class="qmeta">` +
    `<span class="qdur ${dc}">${fmt(q.durationMs)}</span>` +
    `<div class="qbar"><div class="qfill" style="width:${pct}%"></div></div>` +
    `<span class="dim" style="font-size:10px">${q.rowCount}&thinsp;row${q.rowCount !== 1 ? "s" : ""}</span>` +
    // The line that ran it. "Which of my forty queries is slow" was answerable;
    // this is the other half — where to go and change it.
    sourceLink(q.source, editor) +
    copyBtn(q.sql, "Copy SQL") +
    `</div><div class="qsql">${esc(q.sql)}</div>${binds}</div>`
  );
}

export const queriesTab: TabView = {
  id: "queries",
  label: "Queries",

  badge: ({ trace }) =>
    trace
      ? {
          count: trace.queries.length,
          warn: !!trace.warnings.length || !!trace.exception,
        }
      : undefined,

  render(host, { trace, store }) {
    const t = trace!;
    const dbMs = t.queries.reduce((s, q) => s + q.durationMs, 0);
    const peak = Math.max(1, ...t.queries.map((q) => q.durationMs));

    const route = t.route
      ? `<div class="rcard">` +
        `<span class="meth ${t.method.toLowerCase()}">${esc(t.method)}</span> ` +
        `<b>${esc(t.route.pattern)}</b>` +
        `<span class="dim" style="font-size:10px;margin-left:8px">${esc(t.route.controller)}@${esc(t.route.action)}</span>` +
        `</div>`
      : "";

    const mem = t.memory
      ? `<div class="stat"><div class="slbl">Memory</div><div class="sval">${fmtMem(t.memory)}</div></div>`
      : "";
    const auth = t.auth
      ? `<div class="stat"><div class="slbl">User</div><div class="sval cyan">${esc(String(t.auth.name ?? t.auth.email ?? t.auth.id ?? "?"))}</div></div>`
      : `<div class="stat"><div class="slbl">User</div><div class="sval dim">Guest</div></div>`;

    // A warning that does not say what to do about it is half a feature, so each
    // one carries the eager-load that removes it and the call that suppresses it
    // when the repetition is intended.
    const warns = t.warnings
      .map(
        (w) =>
          `<div class="wrow"><div class="whead">⚠ N+1 · executed <b>${w.count}×</b></div>` +
          `<div class="qsql dim">${esc(w.sql)}</div>` +
          `<div class="wfix">Fix: eager-load with <code>.with('relation')</code>` +
          ` &nbsp;·&nbsp; suppress: <code>DB.allowNPlusOne('${esc(tableFrom(w.sql))}')</code></div>` +
          `</div>`,
      )
      .join("");

    const queries = t.queries.length
      ? t.queries.map((q) => queryRow(q, peak, store.editor)).join("")
      : '<p class="empty">No queries for this request</p>';

    const allSql = t.queries.map((q) => q.sql).join(";\n\n");

    host.innerHTML =
      `${route}${exceptionBanner(t)}<div class="stats">` +
      `<div class="stat"><div class="slbl">Duration</div><div class="sval ${dCls(t.durationMs)}">${fmt(t.durationMs)}</div></div>` +
      `<div class="stat"><div class="slbl">Queries</div><div class="sval">${t.queries.length}</div></div>` +
      `<div class="stat"><div class="slbl">DB time</div><div class="sval">${fmt(dbMs)}</div></div>` +
      `${mem}${auth}</div>` +
      (t.warnings.length
        ? `<div class="sec"><div class="stitle">N+1 Warnings</div>${warns}</div>`
        : "") +
      `<div class="sec"><div class="stitle">Queries (${t.queries.length})` +
      copyBtn(allSql, "Copy every statement") +
      `</div>${queries}</div>`;
  },
};
