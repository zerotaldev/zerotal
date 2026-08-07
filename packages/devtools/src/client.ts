/**
 * @zerotal/devtools — browser client
 *
 * Usage (in your app.js / frontend entry):
 *   import { DevTools } from '@zerotal/devtools/client';
 *   DevTools.start();
 *
 * Connects to the SSE stream served by DevtoolsInjectionMiddleware and renders
 * a live floating panel. No script injection by the server is required.
 */

import type {
  RequestTrace,
  QuerySpan,
  LogEntry,
  MailEntry,
  CacheEntry,
  JobEntry,
  TraceChannelDescriptor,
  TraceChannelEntry,
} from "./RequestTrace.ts";

export interface DevtoolsClientOptions {
  /** Base URL path for the devtools API. Default: '/__zerotal/devtools' */
  endpoint?: string;
  /**
   * How the panel is mounted.
   *
   * `'floating'` (default) pins a collapsible bar to the bottom of the page.
   * `'standalone'` fills the window and drops the collapse/close controls — the
   * inspector dashboard. Both run the same renderers, so a tab added for one
   * exists in the other.
   */
  mode?: "floating" | "standalone";
  /** Element to mount into. Defaults to `document.body`. */
  mount?: HTMLElement;
}

// ── Styles (injected into Shadow DOM) ─────────────────────────────────────────

const CSS = `<style>
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
#wrap {
  --bg: #1a1b26; --surf: #24283b; --card: #2f3452; --bdr: #3b4261;
  --text: #c0caf5; --muted: #565f89; --purple: #7aa2f7;
  --green: #9ece6a; --yellow: #e0af68; --red: #f7768e;
  --cyan: #7dcfff; --orange: #ff9e64;
  font: 12px/1.5 'JetBrains Mono','Fira Code','SF Mono',ui-monospace,monospace;
  color: var(--text);
}
/* ── utility colours ──────────────────────────────────────────────────────── */
.green  { color: var(--green);  }
.yellow { color: var(--yellow); }
.red    { color: var(--red);    }
.cyan   { color: var(--cyan);   }
.dim    { color: var(--muted);  }
/* ── bar ──────────────────────────────────────────────────────────────────── */
#bar {
  height: 32px; background: var(--bg); border-top: 1px solid var(--bdr);
  display: flex; align-items: center; gap: 5px; padding: 0 8px;
  cursor: pointer; user-select: none; overflow: hidden; flex-shrink: 0;
}
.logo { color: var(--purple); font-weight: 700; font-size: 13px; flex-shrink: 0; }
.dot  { font-size: 8px; }
.dot.ok  { color: var(--green); }
.dot.err { color: var(--red); animation: blink 1s step-start infinite; }
@keyframes blink { 50% { opacity: 0.25; } }
.bdiv { color: var(--bdr); flex-shrink: 0; }
.sp   { flex: 1; }
.meth { font-weight: 700; font-size: 11px; flex-shrink: 0; }
.meth.get    { color: var(--green);  }
.meth.post   { color: var(--cyan);   }
.meth.put, .meth.patch { color: var(--yellow); }
.meth.delete { color: var(--red);    }
.bpath { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.sc   { font-weight: 700; font-size: 11px; flex-shrink: 0; }
.sc.ok    { color: var(--green);  }
.sc.redir { color: var(--cyan);   }
.sc.cli   { color: var(--yellow); }
.sc.srv   { color: var(--red);    }
.chip {
  font-size: 10px; padding: 1px 5px; border-radius: 999px;
  background: var(--card); border: 1px solid var(--bdr); white-space: nowrap; flex-shrink: 0;
}
.chip.warn { border-color: var(--yellow); color: var(--yellow); }
.chip.ok   { border-color: var(--green);  color: var(--green);  }
.ibtn {
  height: 22px; padding: 0 6px;
  background: var(--card); border: 1px solid var(--bdr); color: var(--text);
  cursor: pointer; border-radius: 4px; font-size: 11px; font-family: inherit;
  display: flex; align-items: center; gap: 3px; flex-shrink: 0;
}
.ibtn:hover     { background: var(--surf); border-color: var(--purple); }
.ibtn.live-on   { border-color: var(--green); color: var(--green); }
/* ── panel ────────────────────────────────────────────────────────────────── */
#panel {
  height: 380px; background: var(--bg); border-top: 1px solid var(--bdr);
  display: flex; flex-direction: column;
}
#tabs {
  display: flex; gap: 2px; padding: 4px 8px 0;
  background: var(--surf); border-bottom: 1px solid var(--bdr);
  flex-shrink: 0; overflow-x: auto;
}
.tab {
  height: 28px; padding: 0 10px; background: transparent; border: none;
  border-bottom: 2px solid transparent; color: var(--muted); cursor: pointer;
  font: inherit; font-size: 11px; white-space: nowrap;
  display: flex; align-items: center; gap: 4px;
}
.tab:hover  { color: var(--text); }
.tab.active { color: var(--text); border-bottom-color: var(--purple); }
.tbdg {
  font-size: 10px; padding: 0 4px; border-radius: 999px;
  background: var(--card); min-width: 16px; text-align: center;
}
.tbdg.warn { background: transparent; color: var(--yellow); }
.ldot { font-size: 8px; color: var(--green); animation: blink 1.5s step-start infinite; }
#content { flex: 1; overflow-y: auto; overflow-x: hidden; }
/* ── content shared ───────────────────────────────────────────────────────── */
.empty { color: var(--muted); text-align: center; padding: 40px 20px; }
.sec   { padding: 10px 12px; border-bottom: 1px solid var(--bdr); }
.sec:last-child { border-bottom: none; }
.stitle { font-size: 10px; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); margin-bottom: 8px; }
.stats  { display: flex; flex-wrap: wrap; gap: 1px; background: var(--bdr); border-bottom: 1px solid var(--bdr); }
.stat   { flex: 1; min-width: 90px; padding: 8px 12px; background: var(--bg); }
.slbl   { font-size: 10px; color: var(--muted); margin-bottom: 2px; }
.sval   { font-weight: 700; font-size: 13px; }
.rcard  { padding: 8px 12px; border-bottom: 1px solid var(--bdr); background: var(--surf); font-size: 12px; }
/* ── queries ──────────────────────────────────────────────────────────────── */
.qrow  { padding: 8px 12px; border-bottom: 1px solid var(--bdr); }
.qrow:last-child { border-bottom: none; }
.qmeta { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.qdur  { font-weight: 700; font-size: 11px; min-width: 44px; }
.qbar  { flex: 1; height: 4px; background: var(--card); border-radius: 2px; max-width: 120px; }
.qfill { height: 100%; background: var(--purple); border-radius: 2px; }
.qsql  { font-size: 11px; white-space: pre-wrap; word-break: break-all; }
.qbind { font-size: 10px; color: var(--muted); margin-top: 3px; }
.bind  { color: var(--orange); }
.wrow  { padding: 8px 12px; border-bottom: 1px solid var(--bdr); border-left: 3px solid var(--yellow); }
.whead { color: var(--yellow); margin-bottom: 4px; font-size: 12px; }
/* ── logs ─────────────────────────────────────────────────────────────────── */
.lrow  { display: flex; gap: 6px; padding: 4px 12px; border-bottom: 1px solid var(--bdr); }
.ltime { color: var(--muted); min-width: 54px; font-size: 10px; }
.llvl  { min-width: 38px; font-weight: 700; font-size: 11px; }
.llvl.log, .llvl.debug, .llvl.info { color: var(--cyan);   }
.llvl.warn  { color: var(--yellow); }
.llvl.error { color: var(--red);    }
.lmsg  { font-size: 11px; white-space: pre-wrap; word-break: break-all; }
/* ── request kv table ─────────────────────────────────────────────────────── */
.kv    { width: 100%; border-collapse: collapse; font-size: 11px; }
.kv td { padding: 4px 12px; border-bottom: 1px solid var(--bdr); vertical-align: top; }
.kv td:first-child { color: var(--muted); min-width: 160px; font-size: 10px; }
/* ── cards (mail / jobs) ──────────────────────────────────────────────────── */
.card  { padding: 9px 12px; border-bottom: 1px solid var(--bdr); }
/* ── all-requests list ────────────────────────────────────────────────────── */
.hrow {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 12px; border-bottom: 1px solid var(--bdr);
  cursor: pointer; font-size: 11px;
}
.hrow:hover { background: var(--surf); }
.hrow.cur   { background: var(--card); }
.hpath { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* ── filter bar ───────────────────────────────────────────────────────────── */
.fbar { display: flex; gap: 6px; align-items: center; padding: 6px 12px; border-bottom: 1px solid var(--bdr); background: var(--surf); position: sticky; top: 0; z-index: 1; }
.finput {
  flex: 1; height: 24px; padding: 0 8px; font: inherit; font-size: 11px;
  background: var(--bg); border: 1px solid var(--bdr); border-radius: 4px; color: var(--text);
}
.finput:focus { outline: none; border-color: var(--purple); }
.finput::placeholder { color: var(--muted); }
/* ── timeline waterfall ───────────────────────────────────────────────────── */
.trow  { display: flex; align-items: center; gap: 8px; padding: 3px 12px; font-size: 11px; }
.trow:hover { background: var(--surf); }
.tlbl  { min-width: 78px; font-size: 10px; text-align: right; flex-shrink: 0; }
.ttrack { flex: 1; height: 12px; position: relative; background: var(--card); border-radius: 2px; }
.tmark {
  position: absolute; top: 0; height: 12px; min-width: 3px; border-radius: 2px;
  background: var(--purple);
}
.tmark.query { background: var(--purple); }
.tmark.cache { background: var(--cyan);   }
.tmark.mail  { background: var(--green);  }
.tmark.job   { background: var(--orange); }
.tmark.log   { background: var(--muted);  }
.tmark.warn  { background: var(--red);    }
.tmark.chan  { background: var(--yellow); }
.ttxt  { flex: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.tkey  { display: flex; gap: 10px; flex-wrap: wrap; padding: 6px 12px; font-size: 10px; color: var(--muted); }
.tkey i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 3px; vertical-align: middle; font-style: normal; }
/* ── generic channel rows ─────────────────────────────────────────────────── */
.crow  { padding: 7px 12px; border-bottom: 1px solid var(--bdr); }
.crow.warn { border-left: 3px solid var(--yellow); }
.chead { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
.cttl  { font-size: 11px; word-break: break-word; }
.cmeta { font-size: 10px; color: var(--muted); display: flex; gap: 10px; flex-wrap: wrap; }
/* ── standalone dashboard ─────────────────────────────────────────────────── */
#wrap.standalone { display: flex; flex-direction: column; height: 100vh; background: var(--bg); }
#wrap.standalone #panel { flex: 1; height: auto; border-top: none; }
#wrap.standalone #bar { border-top: none; border-bottom: 1px solid var(--bdr); cursor: default; order: -1; }
</style>`;

// ── Extension registry ───────────────────────────────────────────────────────────
//
// Other packages add their own tab to the injected panel — a unified dev tool across the
// framework. They call `window.__zerotalDevtools?.register(panel)` from their own browser code
// (e.g. `@zerotal/flow`'s time-travel timeline); the injected panel renders the extra tab and
// calls `panel.render(el)` when it's shown. `refresh(id)` lets an extension push a live update
// (a new badge count, re-render the open tab). The registry is created lazily by whichever runs
// first (this panel or an extension), so registration is order-independent.

/** A panel another package contributes as a tab in the Zerotal devtools. */
export interface DevtoolsPanelPlugin {
  /** Unique id — the tab is addressed internally as `plugin:<id>`. */
  id: string;
  /** Tab label. */
  title: string;
  /** Optional badge value (e.g. a count); a falsy return hides the badge. */
  badge?: () => number | string | undefined;
  /** Render the panel's content into `el` (the shared, persistent content area). */
  render: (el: HTMLElement) => void;
}

interface DevtoolsRegistry {
  panels: DevtoolsPanelPlugin[];
  /** @internal set by the host panel — called when a panel registers. */
  _emit: ((p: DevtoolsPanelPlugin) => void) | null;
  /** @internal set by the host panel — called on refresh(id). */
  _refresh: ((id?: string) => void) | null;
  register(panel: DevtoolsPanelPlugin): DevtoolsPanelPlugin;
  refresh(id?: string): void;
}

/**
 * Match a trace against the All tab's filter box.
 *
 * Every space-separated term has to match, so `posts 500` narrows twice rather
 * than widening — a filter that ORs its terms gets less useful the more you type.
 * The haystack covers what you would search a request list by: method, path,
 * status, and the route it matched.
 *
 * Exported because it is the only part of the panel that is logic rather than
 * markup, and it is worth testing without a DOM.
 */
export function matchesFilter(trace: RequestTrace, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = [
    trace.method,
    trace.path,
    String(trace.statusCode),
    trace.route?.pattern ?? "",
    trace.route?.controller ?? "",
    trace.route?.action ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** Get-or-create the global devtools extension registry. */
function _ensureRegistry(): DevtoolsRegistry {
  const w = window as unknown as { __zerotalDevtools?: DevtoolsRegistry };
  if (!w.__zerotalDevtools) {
    w.__zerotalDevtools = {
      panels: [],
      _emit: null,
      _refresh: null,
      register(panel: DevtoolsPanelPlugin) {
        this.panels.push(panel);
        this._emit?.(panel);
        return panel;
      },
      refresh(id?: string) {
        this._refresh?.(id);
      },
    };
  }
  return w.__zerotalDevtools;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const DevTools = {
  start(opts: DevtoolsClientOptions = {}): void {
    if (typeof document === "undefined") return;
    if (document.getElementById("__zerotal_dt__")) return;

    const BASE = (opts.endpoint ?? "/__zerotal/devtools").replace(/\/$/, "");
    const standalone = opts.mode === "standalone";
    const registry = _ensureRegistry();

    // ── State ─────────────────────────────────────────────────────────────────
    let traces: RequestTrace[] = [];
    let channels: TraceChannelDescriptor[] = [];
    let selected: RequestTrace | null = null;
    let tab = "queries";
    // The dashboard has nothing to collapse into — it is always open.
    let open = standalone;
    let live = true;
    let connected = false;
    let filter = "";

    // ── DOM ───────────────────────────────────────────────────────────────────
    const host = document.createElement("div");
    host.id = "__zerotal_dt__";
    host.style.cssText = standalone
      ? "position:fixed;inset:0;z-index:2147483647"
      : "position:fixed;bottom:0;left:0;right:0;z-index:2147483647;pointer-events:none";
    (opts.mount ?? document.body).appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML =
      `${CSS}<div id="wrap" class="${standalone ? "standalone" : ""}" style="pointer-events:auto">` +
      `<div id="panel" style="display:${standalone ? "flex" : "none"}">` +
      `<div id="tabs"></div><div id="content"></div></div>` +
      `<div id="bar"></div></div>`;

    function $<T extends HTMLElement = HTMLElement>(sel: string): T {
      return shadow.querySelector<T>(sel)!;
    }

    // ── Permanent event delegation ────────────────────────────────────────────
    //    Listeners on #bar, #tabs, #content survive innerHTML replacement of
    //    their children because they are on the persistent container elements.

    $<HTMLElement>("#bar").addEventListener("click", (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
      if (!btn) {
        togglePanel();
        return;
      }
      switch (btn.dataset["action"]) {
        case "toggle":
          togglePanel();
          break;
        case "live":
          enableLive();
          break;
        case "pin":
          live = false;
          renderBar();
          break;
        case "clear":
          clearTraces();
          break;
        case "dash":
          window.open(BASE, "_blank");
          break;
        case "close":
          sse.close();
          host.remove();
          break;
      }
    });

    $<HTMLElement>("#tabs").addEventListener("click", (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest("[data-tab]") as HTMLElement | null;
      if (btn) {
        tab = btn.dataset["tab"]!;
        renderContent();
      }
    });

    $<HTMLElement>("#content").addEventListener("click", (e: MouseEvent) => {
      const row = (e.target as HTMLElement).closest("[data-idx]") as HTMLElement | null;
      if (row) selectTrace(traces[Number(row.dataset["idx"])]!);
    });

    // The filter input is re-rendered with the list it filters, so the listener
    // lives on the persistent content element and the caret is restored after.
    $<HTMLElement>("#content").addEventListener("input", (e: Event) => {
      const input = e.target as HTMLInputElement;
      if (input.id !== "filter") return;
      filter = input.value;
      renderAll();
      const next = shadow.querySelector<HTMLInputElement>("#filter");
      if (next) {
        next.focus();
        next.setSelectionRange(next.value.length, next.value.length);
      }
    });

    // ── SSE ───────────────────────────────────────────────────────────────────
    const sse = new EventSource(`${BASE}/sse`);

    sse.onopen = () => {
      connected = true;
      renderBar();
    };
    sse.onerror = () => {
      connected = false;
      renderBar();
    };

    sse.onmessage = (e: MessageEvent<string>) => {
      type Msg =
        | { type: "history"; data: RequestTrace[]; channels?: TraceChannelDescriptor[] }
        | { type: "trace"; data: RequestTrace }
        | { type: "clear" };

      const msg = JSON.parse(e.data) as Msg;

      if (msg.type === "history") {
        traces = msg.data;
        // Descriptors arrive with the history so a package's tab is on screen at
        // first paint rather than after that package's next entry.
        channels = msg.channels ?? [];
        if (live || !selected) selected = traces[0] ?? null;
        renderBar();
        if (open) renderContent();
      } else if (msg.type === "trace") {
        traces.unshift(msg.data);
        if (traces.length > 100) traces.length = 100;
        if (live) {
          selected = msg.data;
          renderBar();
          if (open) renderContent();
        } else {
          renderBar();
          if (open && tab === "all") renderAll();
        }
      } else {
        traces = [];
        selected = null;
        renderBar();
        if (open) renderContent();
      }
    };

    // ── Keyboard shortcut ─────────────────────────────────────────────────────
    document.addEventListener("keydown", (e: KeyboardEvent) => {
      if ((e.altKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        togglePanel();
      }
    });

    // ── Extension panels ───────────────────────────────────────────────────────
    // A registered plugin adds a tab; a late registration (e.g. flow enabling its timeline
    // once its WebSocket is ready) refreshes the tab strip if the panel is open.
    registry._emit = () => {
      if (open) renderTabs();
    };
    registry._refresh = (id) => {
      if (!open) return;
      renderTabs(); // update the plugin's badge
      if (tab.indexOf("plugin:") === 0 && (!id || tab === "plugin:" + id)) renderPlugin();
    };

    // ── Initial render ────────────────────────────────────────────────────────
    renderBar();
    if (open) renderContent();

    // ─────────────────────────────────────────────────────────────────────────
    // Function declarations (hoisted — can reference each other freely)
    // ─────────────────────────────────────────────────────────────────────────

    function togglePanel() {
      if (standalone) return; // nothing to collapse into
      open = !open;
      $<HTMLElement>("#panel").style.display = open ? "flex" : "none";
      renderBar();
      if (open) renderContent();
    }

    function selectTrace(t: RequestTrace) {
      selected = t;
      live = false;
      tab = "queries";
      renderBar();
      if (open) renderContent();
    }

    function enableLive() {
      live = true;
      selected = traces[0] ?? null;
      renderBar();
      if (open) renderContent();
    }

    function clearTraces() {
      fetch(`${BASE}/api/clear`, { method: "POST" });
    }

    // ── Bar ───────────────────────────────────────────────────────────────────

    function renderBar() {
      const T = selected;
      const dot = `<span class="dot ${connected ? "ok" : "err"}" title="${connected ? "Connected" : "Disconnected"}">●</span>`;
      const liveBtn = live
        ? `<button class="ibtn live-on" data-action="pin"  title="Live — click to pin">⏵ Live</button>`
        : `<button class="ibtn"         data-action="live" title="Pinned — click to follow newest">⏸ Pinned</button>`;
      const arr = open ? "▼" : "▲";
      // The dashboard has no page to collapse back to and no host page to be
      // removed from, so it drops the toggle, popout, and close controls.
      const chrome = standalone
        ? `<button class="ibtn" data-action="clear" title="Clear traces">🗑</button>`
        : `<button class="ibtn" data-action="clear" title="Clear traces">🗑</button>` +
          `<button class="ibtn" data-action="dash"  title="Open inspector">⤢</button>` +
          `<button class="ibtn" data-action="close" title="Remove devtools">✕</button>` +
          `<button class="ibtn" data-action="toggle" title="Toggle panel (Alt+D)">${arr}</button>`;

      if (!T) {
        $<HTMLElement>("#bar").innerHTML =
          `<span class="logo">⬡ <b>Zerotal</b></span>${dot}<span class="sp"></span>` +
          `${liveBtn}${standalone ? "" : `<button class="ibtn" data-action="toggle" title="Toggle (Alt+D)">${arr}</button>`}`;
        return;
      }

      const n1 = T.warnings.length ? `<span class="chip warn">⚠${T.warnings.length}</span>` : "";
      const user = T.auth
        ? `<span class="chip" title="${esc(String(T.auth.email ?? T.auth.id ?? ""))}">👤</span>`
        : "";
      const mail = T.mail?.length ? `<span class="chip">📧${T.mail.length}</span>` : "";
      const jobs = T.jobs?.length ? `<span class="chip">⚙${T.jobs.length}</span>` : "";
      const ch = T.cache?.length
        ? `<span class="chip">${T.cache.filter((c) => c.op === "hit").length}/${T.cache.length}c</span>`
        : "";

      $<HTMLElement>("#bar").innerHTML =
        `<span class="logo">⬡ <b>Zerotal</b></span>${dot}<span class="bdiv">│</span>` +
        `<span class="meth ${T.method.toLowerCase()}">${esc(T.method)}</span>` +
        `<span class="bpath">${esc(T.path)}</span><span class="bdiv">│</span>` +
        `<span class="sc ${scCls(T.statusCode)}">${T.statusCode || "—"}</span>` +
        `<span class="dim">·</span><span class="${dCls(T.durationMs) || "dim"}">${fmt(T.durationMs)}</span>` +
        `<span class="dim">·</span><span class="dim">${T.queries.length}q</span>` +
        `${n1}${user}${mail}${jobs}${ch}<span class="sp"></span>` +
        `${liveBtn}${chrome}`;
    }

    // ── Content router ────────────────────────────────────────────────────────

    function renderContent() {
      renderTabs();
      // Extension tabs own their content (their own data source) — route before the
      // request-trace "waiting for traffic" guard.
      if (tab.indexOf("plugin:") === 0) {
        renderPlugin();
        return;
      }
      if (!selected && tab !== "all") {
        $<HTMLElement>("#content").innerHTML = '<p class="empty">Waiting for traffic…</p>';
        return;
      }
      // Channel tabs are declared by other packages and rendered from their
      // descriptor, so devtools ships no code per contributing package.
      if (tab.indexOf("channel:") === 0) {
        const ch = channels.find((c) => "channel:" + c.id === tab);
        if (ch) renderChannel(selected!, ch);
        else $<HTMLElement>("#content").innerHTML = '<p class="empty">Channel unavailable</p>';
        return;
      }
      switch (tab) {
        case "queries":
          renderQueries(selected!);
          break;
        case "timeline":
          renderTimeline(selected!);
          break;
        case "logs":
          renderLogs(selected!);
          break;
        case "request":
          renderRequest(selected!);
          break;
        case "mail":
          renderMail(selected!);
          break;
        case "cache":
          renderCache(selected!);
          break;
        case "jobs":
          renderJobs(selected!);
          break;
        case "all":
          renderAll();
          break;
      }
    }

    function renderTabs() {
      const T = selected;
      const TABS = [
        { id: "queries", lbl: "Queries", n: T?.queries.length ?? 0, warn: !!T?.warnings.length },
        { id: "timeline", lbl: "Timeline", n: 0 },
        {
          id: "logs",
          lbl: "Logs",
          n: T?.logs?.length ?? 0,
          warn: T?.logs?.some((l) => l.level === "error" || l.level === "warn") ?? false,
        },
        { id: "request", lbl: "Request", n: 0 },
        { id: "mail", lbl: "Mail", n: T?.mail?.length ?? 0 },
        { id: "cache", lbl: "Cache", n: T?.cache?.length ?? 0 },
        { id: "jobs", lbl: "Jobs", n: T?.jobs?.length ?? 0 },
        { id: "all", lbl: "All", n: traces.length, live: true },
      ];
      const builtin = TABS.map((t) => tabHtml(t.id, t.lbl, t.n, t.warn, t.id === "all")).join("");
      // Channel tabs declared server-side by other packages.
      const chans = channels
        .map((c) => {
          const rows = T?.channels?.[c.id] ?? [];
          const warn = !!c.warn && rows.some((r) => !!r[c.warn!]);
          return tabHtml("channel:" + c.id, c.label, rows.length, warn);
        })
        .join("");
      // Extension tabs contributed by other packages via window.__zerotalDevtools.register().
      const plugins = registry.panels
        .map((p) => tabHtml("plugin:" + p.id, p.title, p.badge?.() ?? 0, false))
        .join("");
      $<HTMLElement>("#tabs").innerHTML = builtin + chans + plugins;
    }

    function tabHtml(
      id: string,
      label: string,
      count: number | string,
      warn?: boolean,
      isLive?: boolean,
    ): string {
      const badge = count
        ? `<span class="tbdg${warn ? " warn" : ""}">${esc(String(count))}</span>`
        : "";
      const ldot = isLive && connected ? '<span class="ldot">●</span>' : "";
      return `<button class="tab${tab === id ? " active" : ""}" data-tab="${esc(id)}">${esc(label)}${badge}${ldot}</button>`;
    }

    // ── Channel tab (generic) ─────────────────────────────────────────────────

    function renderChannel(T: RequestTrace, c: TraceChannelDescriptor) {
      const rows = T.channels?.[c.id] ?? [];
      if (!rows.length) {
        $<HTMLElement>("#content").innerHTML =
          `<p class="empty">No ${esc(c.label.toLowerCase())} activity during this request</p>`;
        return;
      }
      $<HTMLElement>("#content").innerHTML =
        `<div>` +
        rows
          .map((r: TraceChannelEntry) => {
            const isWarn = !!c.warn && !!r[c.warn];
            const badge = c.badge && r[c.badge] != null ? String(r[c.badge]) : "";
            const titleKey = c.title ?? c.badge;
            const title = titleKey && r[titleKey] != null ? String(r[titleKey]) : "";
            const meta = (c.meta ?? [])
              .filter((k) => r[k] != null && r[k] !== "")
              .map((k) => `<span>${esc(k)}: ${esc(String(r[k]))}</span>`)
              .join("");
            return (
              `<div class="crow${isWarn ? " warn" : ""}">` +
              `<div class="chead">` +
              (badge ? `<span class="chip${isWarn ? " warn" : ""}">${esc(badge)}</span>` : "") +
              `<span class="dim" style="font-size:10px">+${r.offsetMs}ms</span>` +
              `</div>` +
              (title && title !== badge ? `<div class="cttl">${esc(title)}</div>` : "") +
              (meta ? `<div class="cmeta">${meta}</div>` : "") +
              `</div>`
            );
          })
          .join("") +
        `</div>`;
    }

    // ── Timeline tab (waterfall) ──────────────────────────────────────────────

    function renderTimeline(T: RequestTrace) {
      // Every entry already carries an offset from the request start; the
      // waterfall is what makes "when did this happen relative to everything
      // else" legible instead of a column of numbers.
      type Span = { at: number; dur: number; kind: string; text: string };
      const spans: Span[] = [];

      for (const q of T.queries) {
        spans.push({
          at: Math.max(0, q.startMs - T.startMs),
          dur: q.durationMs,
          kind: "query",
          text: q.sql,
        });
      }
      for (const c of T.cache ?? []) {
        spans.push({ at: c.offsetMs, dur: c.durationMs, kind: "cache", text: `${c.op} ${c.key}` });
      }
      for (const m of T.mail ?? []) {
        spans.push({ at: m.offsetMs, dur: m.durationMs, kind: "mail", text: m.subject });
      }
      for (const j of T.jobs ?? []) {
        spans.push({ at: j.offsetMs, dur: j.durationMs, kind: "job", text: j.className });
      }
      for (const l of T.logs ?? []) {
        spans.push({
          at: l.offsetMs,
          dur: 0,
          kind: l.level === "error" || l.level === "warn" ? "warn" : "log",
          text: l.args.join(" "),
        });
      }
      for (const [id, rows] of Object.entries(T.channels ?? {})) {
        const desc = channels.find((c) => c.id === id);
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

      if (!spans.length) {
        $<HTMLElement>("#content").innerHTML =
          '<p class="empty">Nothing recorded on the timeline for this request</p>';
        return;
      }

      spans.sort((a, b) => a.at - b.at);
      const total = Math.max(1, T.durationMs);
      const KEY = [
        ["query", "Queries"],
        ["cache", "Cache"],
        ["mail", "Mail"],
        ["job", "Jobs"],
        ["chan", "Channels"],
        ["log", "Logs"],
        ["warn", "Warnings"],
      ];

      $<HTMLElement>("#content").innerHTML =
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
    }

    function renderPlugin() {
      const p = registry.panels.find((x) => "plugin:" + x.id === tab);
      if (!p) {
        $<HTMLElement>("#content").innerHTML = '<p class="empty">Panel unavailable</p>';
        return;
      }
      try {
        p.render($<HTMLElement>("#content"));
      } catch {
        $<HTMLElement>("#content").innerHTML = '<p class="empty">Panel error</p>';
      }
    }

    // ── Queries tab ───────────────────────────────────────────────────────────

    function renderQueries(T: RequestTrace) {
      const dbMs = T.queries.reduce((s, q) => s + q.durationMs, 0);
      const peak = Math.max(1, ...T.queries.map((q) => q.durationMs));

      const route = T.route
        ? `<div class="rcard">` +
          `<span class="meth ${T.method.toLowerCase()}">${esc(T.method)}</span> ` +
          `<b>${esc(T.route.pattern)}</b>` +
          `<span class="dim" style="font-size:10px;margin-left:8px">${esc(T.route.controller)}@${esc(T.route.action)}</span>` +
          `</div>`
        : "";

      const mem = T.memory
        ? `<div class="stat"><div class="slbl">Memory</div><div class="sval">${fmtMem(T.memory)}</div></div>`
        : "";
      const auth = T.auth
        ? `<div class="stat"><div class="slbl">User</div><div class="sval cyan">${esc(String(T.auth.name ?? T.auth.email ?? T.auth.id ?? "?"))}</div></div>`
        : `<div class="stat"><div class="slbl">User</div><div class="sval dim">Guest</div></div>`;

      const warns = T.warnings
        .map(
          (w) =>
            `<div class="wrow"><div class="whead">⚠ N+1 · executed <b>${w.count}×</b></div>` +
            `<div class="qsql dim">${esc(w.sql)}</div></div>`,
        )
        .join("");

      const qs = T.queries.length
        ? T.queries.map((q) => qRow(q, peak)).join("")
        : '<p class="empty">No queries for this request</p>';

      $<HTMLElement>("#content").innerHTML =
        `${route}<div class="stats">` +
        `<div class="stat"><div class="slbl">Duration</div><div class="sval ${dCls(T.durationMs) || ""}">${fmt(T.durationMs)}</div></div>` +
        `<div class="stat"><div class="slbl">Queries</div><div class="sval">${T.queries.length}</div></div>` +
        `<div class="stat"><div class="slbl">DB time</div><div class="sval">${fmt(dbMs)}</div></div>` +
        `${mem}${auth}</div>` +
        (T.warnings.length
          ? `<div class="sec"><div class="stitle">N+1 Warnings</div>${warns}</div>`
          : "") +
        `<div class="sec"><div class="stitle">Queries (${T.queries.length})</div>${qs}</div>`;
    }

    function qRow(qr: QuerySpan, peak: number): string {
      const pct = Math.round((qr.durationMs / peak) * 100);
      const dc = qr.durationMs < 10 ? "green" : qr.durationMs < 100 ? "yellow" : "red";
      const binds = (qr.bindings as unknown[])?.length
        ? `<div class="qbind"><span class="dim">bindings: </span>` +
          (qr.bindings as unknown[])
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
        `<span class="qdur ${dc}">${fmt(qr.durationMs)}</span>` +
        `<div class="qbar"><div class="qfill" style="width:${pct}%"></div></div>` +
        `<span class="dim" style="font-size:10px">${qr.rowCount}&thinsp;row${qr.rowCount !== 1 ? "s" : ""}</span>` +
        `</div><div class="qsql">${esc(qr.sql)}</div>${binds}</div>`
      );
    }

    // ── Logs tab ──────────────────────────────────────────────────────────────

    function renderLogs(T: RequestTrace) {
      const logs = T.logs ?? [];
      if (!logs.length) {
        $<HTMLElement>("#content").innerHTML = '<p class="empty">No console output captured</p>';
        return;
      }
      $<HTMLElement>("#content").innerHTML =
        `<div>` +
        logs
          .map(
            (l: LogEntry) =>
              `<div class="lrow">` +
              `<span class="ltime dim">+${l.offsetMs}ms</span>` +
              `<span class="llvl ${l.level}">${l.level.toUpperCase()}</span>` +
              `<span class="lmsg">${l.args.map(esc).join(" ")}</span>` +
              `</div>`,
          )
          .join("") +
        `</div>`;
    }

    // ── Request tab ───────────────────────────────────────────────────────────

    function renderRequest(T: RequestTrace) {
      const qpRows =
        Object.entries(T.queryParams ?? {})
          .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
          .join("") || `<tr><td colspan="2" class="dim" style="padding:6px 12px">None</td></tr>`;
      const hdRows =
        Object.entries(T.headers ?? {})
          .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
          .join("") || `<tr><td colspan="2" class="dim" style="padding:6px 12px">None</td></tr>`;

      $<HTMLElement>("#content").innerHTML =
        `<div class="sec"><div class="stitle">Query Params</div><table class="kv">${qpRows}</table></div>` +
        `<div class="sec"><div class="stitle">Request Headers</div><table class="kv">${hdRows}</table></div>`;
    }

    // ── Mail tab ──────────────────────────────────────────────────────────────

    function renderMail(T: RequestTrace) {
      const mail = T.mail ?? [];
      if (!mail.length) {
        $<HTMLElement>("#content").innerHTML =
          '<p class="empty">No emails sent during this request</p>';
        return;
      }
      $<HTMLElement>("#content").innerHTML =
        `<div>` +
        mail
          .map(
            (m: MailEntry) =>
              `<div class="card">` +
              `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">` +
              `<span class="chip${m.queued ? "" : " ok"}">${m.queued ? "⏳ Queued" : "✓ Sent"}</span>` +
              `<span class="dim" style="font-size:10px">${esc(m.className)} · ${fmt(m.durationMs)}</span>` +
              `</div>` +
              `<div style="font-weight:700;margin-bottom:2px">${esc(m.subject)}</div>` +
              `<div class="dim" style="font-size:11px">To: ${esc(m.to.join(", "))}</div>` +
              `</div>`,
          )
          .join("") +
        `</div>`;
    }

    // ── Cache tab ─────────────────────────────────────────────────────────────

    function renderCache(T: RequestTrace) {
      const cache = T.cache ?? [];
      if (!cache.length) {
        $<HTMLElement>("#content").innerHTML =
          '<p class="empty">No cache operations during this request</p>';
        return;
      }
      const hits = cache.filter((c: CacheEntry) => c.op === "hit").length;
      const misses = cache.filter((c: CacheEntry) => c.op === "miss").length;

      $<HTMLElement>("#content").innerHTML =
        `<div class="stats">` +
        `<div class="stat"><div class="slbl">Operations</div><div class="sval">${cache.length}</div></div>` +
        `<div class="stat"><div class="slbl">Hits</div><div class="sval green">${hits}</div></div>` +
        `<div class="stat"><div class="slbl">Misses</div><div class="sval yellow">${misses}</div></div>` +
        `</div><div>` +
        cache
          .map((c: CacheEntry) => {
            const oc =
              c.op === "hit"
                ? "green"
                : c.op === "miss"
                  ? "yellow"
                  : c.op === "write"
                    ? "cyan"
                    : "dim";
            return (
              `<div class="qrow">` +
              `<div class="qmeta">` +
              `<span class="qdur ${oc}">${c.op.toUpperCase()}</span>` +
              `<span class="dim" style="flex:1;font-size:11px">${esc(c.key)}</span>` +
              `<span class="dim" style="font-size:10px">${fmt(c.durationMs)}</span>` +
              `</div>` +
              `<div class="dim" style="font-size:10px">${c.ttl != null ? `TTL: ${c.ttl}s · ` : ""}+${c.offsetMs}ms</div>` +
              `</div>`
            );
          })
          .join("") +
        `</div>`;
    }

    // ── Jobs tab ──────────────────────────────────────────────────────────────

    function renderJobs(T: RequestTrace) {
      const jobs = T.jobs ?? [];
      if (!jobs.length) {
        $<HTMLElement>("#content").innerHTML =
          '<p class="empty">No jobs dispatched during this request</p>';
        return;
      }
      $<HTMLElement>("#content").innerHTML =
        `<div>` +
        jobs
          .map((j: JobEntry) => {
            const jc = j.status === "completed" ? "ok" : j.status === "failed" ? "warn" : "";
            const ico = j.status === "dispatched" ? "⚙" : j.status === "completed" ? "✓" : "✗";
            return (
              `<div class="card">` +
              `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">` +
              `<span class="chip ${jc}">${ico} ${j.status}</span>` +
              `<span class="dim" style="font-size:10px">+${j.offsetMs}ms · ${fmt(j.durationMs)}</span>` +
              `</div>` +
              `<div style="font-weight:600;margin-bottom:2px">${esc(j.className)}</div>` +
              `<div class="dim" style="font-size:11px">Queue: ${esc(j.queue)}</div>` +
              (j.error
                ? `<div style="color:var(--red);font-size:11px;margin-top:4px">${esc(j.error)}</div>`
                : "") +
              `</div>`
            );
          })
          .join("") +
        `</div>`;
    }

    // ── All Requests tab ──────────────────────────────────────────────────────

    function renderAll() {
      if (!traces.length) {
        $<HTMLElement>("#content").innerHTML =
          '<p class="empty">No requests recorded yet — make a request to see it here</p>';
        return;
      }

      // `data-idx` indexes into `traces`, not into the filtered view, so clicking
      // a row still selects the right trace once a filter is applied.
      const matches = traces.map((t, i) => ({ t, i })).filter(({ t }) => matchesFilter(t, filter));

      const bar =
        `<div class="fbar">` +
        `<input id="filter" class="finput" type="search" placeholder="Filter by path, method, status, or controller…" value="${esc(filter)}">` +
        `<span class="dim">${matches.length}/${traces.length}</span>` +
        `</div>`;

      const rows = matches.length
        ? matches
            .map(
              ({ t, i }) =>
                `<div class="hrow${t.id === selected?.id ? " cur" : ""}" data-idx="${i}">` +
                `<span class="meth ${t.method.toLowerCase()}">${esc(t.method)}</span>` +
                `<span class="hpath">${esc(t.path)}</span>` +
                `<span class="sc ${scCls(t.statusCode)}">${t.statusCode || "—"}</span>` +
                `<span class="${dCls(t.durationMs) || "dim"}">${fmt(t.durationMs)}</span>` +
                `<span class="dim">${t.queries.length}q</span>` +
                (t.warnings.length ? '<span class="chip warn">N+1</span>' : "") +
                `</div>`,
            )
            .join("")
        : '<p class="empty">No requests match this filter</p>';

      $<HTMLElement>("#content").innerHTML = bar + `<div>${rows}</div>`;
    }

    // ── Pure helpers ──────────────────────────────────────────────────────────

    function esc(s: unknown): string {
      return String(s ?? "").replace(
        /[&<>"']/g,
        (c) =>
          (
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as Record<
              string,
              string
            >
          )[c]!,
      );
    }

    function fmt(ms: number): string {
      return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
    }

    function fmtMem(b: number): string {
      return b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`;
    }

    function dCls(ms: number): string {
      return ms > 1000 ? "red" : ms > 300 ? "yellow" : "";
    }

    function scCls(s: number): string {
      return s >= 500 ? "srv" : s >= 400 ? "cli" : s >= 300 ? "redir" : "ok";
    }
  },
};
