/**
 * Both halves of the exchange: what came in, what went out, and what the session
 * was holding while it happened.
 *
 * Headers are an allowlist, not a denylist, because a trace is persisted —
 * `cookie` and `authorization` are the request's credentials, and a header nobody
 * thought to deny is a header on disk for a day. `devtools.headers` opens up the
 * ones you are actually debugging.
 *
 * The session shows **key names only**. "Is the CSRF token there, did the flash
 * survive the redirect, is the user id set" are all answered by the keys, and the
 * values are the request's real state.
 */
import { copyBtn, esc, scCls } from "../ui/format.ts";
import type { TabView } from "./types.ts";

function kvTable(pairs: Record<string, string>): string {
  const rows = Object.entries(pairs)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join("");
  return `<table class="kv">${rows || `<tr><td colspan="2" class="dim" style="padding:6px 12px">None</td></tr>`}</table>`;
}

/** The whole block as `name: value` lines, which is what you paste into a curl. */
function asText(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function section(title: string, pairs: Record<string, string>): string {
  return (
    `<div class="sec"><div class="stitle">${esc(title)} (${Object.keys(pairs).length})` +
    copyBtn(asText(pairs), `Copy ${title.toLowerCase()}`) +
    `</div>${kvTable(pairs)}</div>`
  );
}

export const requestTab: TabView = {
  id: "request",
  label: "Request",

  render(host, { trace }) {
    const t = trace!;
    const params = t.queryParams ?? {};
    const headers = t.headers ?? {};
    const responseHeaders = t.responseHeaders ?? {};
    const session = t.session ?? [];

    const statusLine =
      `<div class="rcard">` +
      `<span class="meth ${t.method.toLowerCase()}">${esc(t.method)}</span> ` +
      `<b>${esc(t.path)}</b> ` +
      `<span class="sc ${scCls(t.statusCode)}">${t.statusCode || "—"}</span>` +
      `</div>`;

    const sessionKeys = session.length
      ? `<div class="chips">` +
        session.map((k) => `<span class="chip">${esc(k)}</span>`).join("") +
        `</div>`
      : `<p class="dim" style="padding:2px 0 4px">` +
        `No session on this request — or no session middleware installed</p>`;

    host.innerHTML =
      statusLine +
      section("Query Params", params) +
      section("Request Headers", headers) +
      section("Response Headers", responseHeaders) +
      `<div class="sec"><div class="stitle">Session keys (${session.length})` +
      copyBtn(session.join("\n"), "Copy keys") +
      `</div>${sessionKeys}` +
      `<p class="dim" style="font-size:10px;margin-top:6px">` +
      `Names only — the values are this request's real state, and a trace is kept for a day.` +
      `</p></div>`;
  },
};
