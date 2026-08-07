/* @zerotal/devtools — browser panel injected by DevtoolsInjectionMiddleware */
(function () {
  "use strict";

  const T = window.__ZT_DT__;
  if (!T) return;

  // ── Styles (shadow DOM — fully isolated from host page) ──────────────────
  const STYLES = `<style>
    :host {
      --bg:     #1a1b26;
      --surf:   #24283b;
      --card:   #2f3452;
      --border: #3b4261;
      --text:   #c0caf5;
      --muted:  #565f89;
      --purple: #7aa2f7;
      --green:  #9ece6a;
      --yellow: #e0af68;
      --red:    #f7768e;
      --orange: #ff9e64;
      --cyan:   #7dcfff;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    #wrap {
      display: flex; flex-direction: column;
      font: 12px/1.5 'JetBrains Mono','Fira Code','SF Mono',ui-monospace,monospace;
      color: var(--text);
    }
    #bar {
      display: flex; align-items: center; gap: 8px;
      height: 32px; padding: 0 12px;
      background: var(--bg); border-top: 1px solid var(--border);
      cursor: pointer; user-select: none; flex-shrink: 0;
    }
    #bar:hover { background: var(--surf); }
    .logo { color: var(--purple); font-weight: 700; }
    .divider { color: var(--border); }
    .flex1 { flex: 1; }
    .dim  { color: var(--muted); }
    .path { color: var(--text); max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .icon-btn {
      background: none; border: none; color: var(--muted);
      cursor: pointer; font: inherit; font-size: 14px; padding: 0 4px; line-height: 1;
    }
    .icon-btn:hover { color: var(--text); }
    .tog { font-size: 10px; }
    .meth {
      font-size: 10px; font-weight: 700; padding: 2px 6px;
      border-radius: 3px; letter-spacing: 0.3px;
    }
    .get             { background: #1d2d50; color: var(--purple); }
    .post            { background: #1e3328; color: var(--green); }
    .put, .patch     { background: #362b18; color: var(--yellow); }
    .delete          { background: #361e22; color: var(--red); }
    .head, .options  { background: var(--card); color: var(--muted); }
    .sc { font-weight: 700; font-size: 12px; }
    .green  { color: var(--green); }
    .yellow { color: var(--yellow); }
    .red    { color: var(--red); }
    .orange { color: var(--orange); }
    .cyan   { color: var(--cyan); }
    .chip-n1 {
      background: #362314; color: var(--orange);
      font-size: 10px; font-weight: 700;
      padding: 1px 6px; border-radius: 10px;
    }
    .chip-user {
      background: var(--card); color: var(--cyan);
      font-size: 10px; padding: 1px 7px; border-radius: 10px;
      max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    #panel {
      flex-direction: column; height: 380px;
      background: var(--bg); border-top: 1px solid var(--border);
    }
    #tabs {
      display: flex; flex-shrink: 0;
      background: var(--surf); border-bottom: 1px solid var(--border);
    }
    .tab {
      background: none; border: none; border-bottom: 2px solid transparent;
      color: var(--muted); cursor: pointer; font: inherit; font-size: 12px;
      padding: 7px 14px;
    }
    .tab:hover { color: var(--text); }
    .tab.active { color: var(--text); border-bottom-color: var(--purple); }
    .tab-badge {
      display: inline-block; background: var(--card); color: var(--muted);
      font-size: 10px; padding: 0 5px; border-radius: 8px; margin-left: 4px;
    }
    .tab-badge.warn { background: #362314; color: var(--orange); }
    #content {
      flex: 1; overflow-y: auto; padding: 12px 16px;
      display: flex; flex-direction: column; gap: 12px;
    }
    .stats { display: flex; flex-wrap: wrap; gap: 16px; }
    .stat  { display: flex; flex-direction: column; gap: 2px; }
    .slbl  { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; }
    .sval  { font-size: 15px; font-weight: 700; }
    .section { display: flex; flex-direction: column; gap: 6px; }
    .sec-title { font-size: 10px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.8px; }
    .route-card {
      background: var(--surf); border: 1px solid var(--border);
      border-radius: 5px; padding: 8px 10px;
      display: flex; flex-direction: column; gap: 3px;
    }
    .route-pattern { color: var(--cyan); font-size: 12px; }
    .route-action  { color: var(--muted); font-size: 11px; }
    .qrow {
      background: var(--surf); border: 1px solid var(--border);
      border-radius: 5px; padding: 8px 10px;
    }
    .qmeta { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
    .qdur  { font-size: 11px; font-weight: 700; min-width: 44px; }
    .qbar  { flex: 1; height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; }
    .qfill { height: 100%; background: var(--purple); border-radius: 2px; }
    .qrc   { font-size: 11px; color: var(--muted); flex-shrink: 0; }
    .qsql  { font-size: 11px; color: var(--text); word-break: break-all; line-height: 1.6; }
    .qbind { font-size: 11px; margin-top: 4px; }
    .bind  { color: var(--orange); }
    .warn-row {
      background: #261b10; border: 1px solid var(--orange);
      border-radius: 5px; padding: 8px 10px;
    }
    .warn-head { font-size: 11px; font-weight: 700; color: var(--orange); margin-bottom: 5px; }
    .warn-fix  { font-size: 11px; color: var(--muted); margin-top: 5px; }
    .warn-fix code { color: var(--cyan); }
    .log-row {
      display: flex; gap: 8px; padding: 4px 0;
      border-bottom: 1px solid var(--border); align-items: flex-start;
    }
    .log-row:last-child { border-bottom: none; }
    .log-time { color: var(--muted); font-size: 11px; flex-shrink: 0; min-width: 42px; }
    .log-lvl  { font-size: 10px; font-weight: 700; flex-shrink: 0; min-width: 36px; text-transform: uppercase; }
    .log-msg  { font-size: 11px; word-break: break-all; flex: 1; line-height: 1.5; }
    .lvl-log   { color: var(--muted); }
    .lvl-debug { color: var(--muted); }
    .lvl-info  { color: var(--cyan); }
    .lvl-warn  { color: var(--yellow); }
    .lvl-error { color: var(--red); }
    .kv-table { width: 100%; border-collapse: collapse; }
    .kv-table tr:nth-child(odd) td { background: var(--surf); }
    .kv-table td { padding: 3px 8px; vertical-align: top; word-break: break-all; }
    .kv-key { color: var(--purple); white-space: nowrap; padding-right: 12px; min-width: 140px; }
    .kv-val { color: var(--text); }
    .hrow {
      display: flex; align-items: center; gap: 8px;
      padding: 5px 8px; border-radius: 4px;
    }
    .hrow:nth-child(odd) { background: var(--surf); }
    .hrow.cur { background: #1d2d50; }
    .hpath { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .empty { color: var(--muted); font-size: 12px; padding: 16px 0; }
    ::-webkit-scrollbar { width: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--muted); }
  </style>`;

  // ── Mount ────────────────────────────────────────────────────────────────
  const host = document.createElement("div");
  host.id = "__zerotal_dt__";
  host.style.cssText =
    "position:fixed;bottom:0;left:0;right:0;z-index:2147483647;pointer-events:none";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML =
    STYLES +
    `
    <div id="wrap" style="pointer-events:auto">
      <div id="panel" style="display:none">
        <div id="tabs">
          <button id="tab-cur"  class="tab active">Queries<span id="badge-q" class="tab-badge"></span></button>
          <button id="tab-logs" class="tab">Logs<span id="badge-l" class="tab-badge"></span></button>
          <button id="tab-req"  class="tab">Request</button>
          <button id="tab-hist" class="tab">History</button>
        </div>
        <div id="content"></div>
      </div>
      <div id="bar"></div>
    </div>`;

  // ── State ────────────────────────────────────────────────────────────────
  let open = false;
  let tab = "cur";
  let hist = null;
  let histErr = false;

  // Populate tab badges once
  q("#badge-q").textContent = T.queries.length;
  if (T.warnings.length) q("#badge-q").classList.add("warn");
  if ((T.logs || []).length) {
    q("#badge-l").textContent = T.logs.length;
    const hasErr = T.logs.some(function (l) {
      return l.level === "error" || l.level === "warn";
    });
    if (hasErr) q("#badge-l").classList.add("warn");
  }

  // ── Wire events ──────────────────────────────────────────────────────────
  q("#bar").addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("#btn-close")) return;
    toggle();
  });
  q("#tab-cur").addEventListener("click", function () {
    setTab("cur");
  });
  q("#tab-logs").addEventListener("click", function () {
    setTab("logs");
  });
  q("#tab-req").addEventListener("click", function () {
    setTab("req");
  });
  q("#tab-hist").addEventListener("click", function () {
    setTab("hist");
  });
  document.addEventListener("keydown", function (e) {
    if ((e.altKey || e.metaKey) && e.key === "d") {
      e.preventDefault();
      toggle();
    }
  });

  // ── Boot ─────────────────────────────────────────────────────────────────
  renderBar();

  // ── Core ─────────────────────────────────────────────────────────────────
  function toggle() {
    open = !open;
    q("#panel").style.display = open ? "flex" : "none";
    if (open) renderPanel();
    renderBar();
  }

  function setTab(t) {
    tab = t;
    q("#tab-cur").classList.toggle("active", t === "cur");
    q("#tab-logs").classList.toggle("active", t === "logs");
    q("#tab-req").classList.toggle("active", t === "req");
    q("#tab-hist").classList.toggle("active", t === "hist");
    if (t === "hist" && hist === null && !histErr) fetchHistory();
    renderPanel();
  }

  // ── Toolbar ───────────────────────────────────────────────────────────────
  function renderBar() {
    const sc = scls(T.statusCode);
    const dc = dcls(T.durationMs);
    const n1 = T.warnings.length ? `<span class="chip-n1">⚠ N+1 ×${T.warnings.length}</span>` : "";
    const mem = T.memory
      ? `<span class="divider">·</span><span class="dim">${fmtMem(T.memory)}</span>`
      : "";
    const user = T.auth
      ? `<span class="chip-user">👤 ${esc(String(T.auth.name || T.auth.email || T.auth.id))}</span>`
      : `<span class="dim" style="font-size:11px">guest</span>`;
    const arr = open ? "▼" : "▲";
    q("#bar").innerHTML = `<span class="logo">⬡ <b>Zerotal</b></span>
       <span class="divider">|</span>
       <span class="meth ${T.method.toLowerCase()}">${esc(T.method)}</span>
       <span class="path">${esc(T.path)}</span>
       <span class="divider">|</span>
       <span class="sc ${sc}">${T.statusCode || "—"}</span>
       <span class="divider">·</span>
       <span class="${dc}">${fmt(T.durationMs)}</span>
       <span class="divider">·</span>
       <span class="dim">${T.queries.length}&thinsp;quer${T.queries.length === 1 ? "y" : "ies"}</span>
       ${mem}
       <span class="divider">·</span>
       ${user}
       ${n1}
       <span class="flex1"></span>
       <button id="btn-close" class="icon-btn" title="Hide (Alt+D)">×</button>
       <button class="icon-btn tog" title="Toggle panel">${arr}</button>`;

    q("#btn-close").addEventListener("click", function (e) {
      e.stopPropagation();
      host.remove();
    });
  }

  // ── Panel ─────────────────────────────────────────────────────────────────
  function renderPanel() {
    if (tab === "cur") renderQueries();
    else if (tab === "logs") renderLogs();
    else if (tab === "req") renderRequest();
    else renderHistory();
  }

  function renderQueries() {
    const total = T.queries.reduce(function (s, q) {
      return s + q.durationMs;
    }, 0);
    const peak = T.queries.reduce(function (m, q) {
      return Math.max(m, q.durationMs);
    }, 1);

    const routeCard = T.route
      ? `<div class="route-card">
           <div class="route-pattern">${esc(T.method)} <strong>${esc(T.route.pattern)}</strong></div>
           <div class="route-action dim">${esc(T.route.controller)}@${esc(T.route.action)}</div>
         </div>`
      : "";

    const authCard = T.auth
      ? `<div class="stat">
           <div class="slbl">User</div>
           <div class="sval cyan" style="font-size:13px">${esc(String(T.auth.name || T.auth.email || T.auth.id))}</div>
           ${T.auth.email ? `<div class="dim" style="font-size:10px">${esc(String(T.auth.email))}</div>` : ""}
         </div>`
      : `<div class="stat"><div class="slbl">User</div><div class="sval dim" style="font-size:13px">Guest</div></div>`;

    const qRows =
      T.queries.length === 0
        ? '<p class="empty">No queries recorded</p>'
        : T.queries
            .map(function (qr) {
              const pct = Math.round((qr.durationMs / peak) * 100);
              const dc = qr.durationMs < 10 ? "green" : qr.durationMs < 100 ? "yellow" : "red";
              const bindings =
                qr.bindings && qr.bindings.length
                  ? `<div class="qbind"><span class="dim">bindings:</span> ${qr.bindings
                      .map(function (v) {
                        return v === null || v === undefined
                          ? '<span class="bind">null</span>'
                          : typeof v === "string"
                            ? `<span class="bind">'${esc(v)}'</span>`
                            : `<span class="bind">${esc(String(v))}</span>`;
                      })
                      .join('<span class="dim">, </span>')}</div>`
                  : "";
              return `<div class="qrow">
            <div class="qmeta">
              <span class="qdur ${dc}">${fmt(qr.durationMs)}</span>
              <div class="qbar"><div class="qfill" style="width:${pct}%"></div></div>
              <span class="qrc">${qr.rowCount}&thinsp;row${qr.rowCount !== 1 ? "s" : ""}</span>
            </div>
            <div class="qsql">${esc(qr.sql)}</div>
            ${bindings}
          </div>`;
            })
            .join("");

    const wRows = T.warnings
      .map(function (w) {
        return `<div class="warn-row">
        <div class="warn-head">⚠ Executed <strong>${w.count}×</strong> in this request — N+1 detected</div>
        <div class="qsql">${esc(w.sql)}</div>
        <div class="warn-fix">Fix: use <code>.with('relation')</code>
          &nbsp;·&nbsp; suppress: <code>DB.allowNPlusOne('${esc(tableFrom(w.sql))}')</code></div>
      </div>`;
      })
      .join("");

    q("#content").innerHTML = `${routeCard ? `<div class="section">${routeCard}</div>` : ""}
       <div class="stats">
         <div class="stat"><div class="slbl">Duration</div>
           <div class="sval ${dcls(T.durationMs)}">${fmt(T.durationMs)}</div></div>
         <div class="stat"><div class="slbl">Queries</div>
           <div class="sval">${T.queries.length}</div></div>
         <div class="stat"><div class="slbl">Query time</div>
           <div class="sval">${fmt(total)}</div></div>
         ${
           T.memory
             ? `<div class="stat"><div class="slbl">Memory</div>
           <div class="sval">${fmtMem(T.memory)}</div></div>`
             : ""
         }
         ${
           T.warnings.length
             ? `<div class="stat"><div class="slbl">N+1</div>
              <div class="sval orange">${T.warnings.length}</div></div>`
             : ""
         }
         ${authCard}
       </div>
       <div class="section">
         <div class="sec-title">Queries (${T.queries.length})</div>${qRows}
       </div>
       ${
         T.warnings.length
           ? `<div class="section"><div class="sec-title">⚠ N+1 Warnings</div>${wRows}</div>`
           : ""
       }`;
  }

  function renderLogs() {
    const logs = T.logs || [];
    if (logs.length === 0) {
      q("#content").innerHTML = '<p class="empty">No console output captured for this request</p>';
      return;
    }
    q("#content").innerHTML = `<div class="section">
         <div class="sec-title">Console (${logs.length})</div>
         <div>${logs
           .map(function (l) {
             return `<div class="log-row">
             <span class="log-time dim">+${l.offsetMs}ms</span>
             <span class="log-lvl lvl-${esc(l.level)}">${esc(l.level)}</span>
             <span class="log-msg">${l.args
               .map(function (a) {
                 return esc(a);
               })
               .join(" ")}</span>
           </div>`;
           })
           .join("")}</div>
       </div>`;
  }

  function renderRequest() {
    const qp = T.queryParams || {};
    const hdrs = T.headers || {};
    const qpKeys = Object.keys(qp);
    const hdrKeys = Object.keys(hdrs);

    const qpRows =
      qpKeys.length === 0
        ? '<tr><td colspan="2" class="dim" style="padding:6px 8px">No query parameters</td></tr>'
        : qpKeys
            .map(function (k) {
              return `<tr><td class="kv-key">${esc(k)}</td><td class="kv-val">${esc(qp[k])}</td></tr>`;
            })
            .join("");

    const hdrRows =
      hdrKeys.length === 0
        ? '<tr><td colspan="2" class="dim" style="padding:6px 8px">—</td></tr>'
        : hdrKeys
            .map(function (k) {
              return `<tr><td class="kv-key">${esc(k)}</td><td class="kv-val">${esc(hdrs[k])}</td></tr>`;
            })
            .join("");

    q("#content").innerHTML = `<div class="section">
         <div class="sec-title">Query Parameters (${qpKeys.length})</div>
         <table class="kv-table">${qpRows}</table>
       </div>
       <div class="section">
         <div class="sec-title">Request Headers</div>
         <table class="kv-table">${hdrRows}</table>
       </div>`;
  }

  function renderHistory() {
    if (hist === null) {
      q("#content").innerHTML = '<p class="empty">Loading…</p>';
      return;
    }
    const rows =
      histErr || !hist.length
        ? `<p class="empty">${histErr ? "Failed to load history" : "No requests recorded yet"}</p>`
        : hist
            .map(function (t) {
              const cur = t.id === T.id ? " cur" : "";
              return `<div class="hrow${cur}">
            <span class="meth ${t.method.toLowerCase()}">${esc(t.method)}</span>
            <span class="hpath">${esc(t.path)}</span>
            <span class="sc ${scls(t.statusCode)}">${t.statusCode || "—"}</span>
            <span class="${dcls(t.durationMs)}">${fmt(t.durationMs)}</span>
            <span class="dim">${t.queries.length}q</span>
            ${t.logs && t.logs.length ? `<span class="dim">${t.logs.length}log</span>` : ""}
            ${t.warnings.length ? '<span class="chip-n1">N+1</span>' : ""}
          </div>`;
            })
            .join("");
    q("#content").innerHTML = rows;
  }

  function fetchHistory() {
    fetch("/__zerotal/devtools/api/traces")
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        hist = data;
        if (tab === "hist") renderPanel();
      })
      .catch(function () {
        histErr = true;
        if (tab === "hist") renderPanel();
      });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function q(sel) {
    return shadow.querySelector(sel);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }
  function fmt(ms) {
    return ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : ms + "ms";
  }
  function fmtMem(bytes) {
    return bytes >= 1048576
      ? (bytes / 1048576).toFixed(1) + " MB"
      : (bytes / 1024).toFixed(0) + " KB";
  }
  function scls(s) {
    return s >= 500 ? "red" : s >= 400 ? "yellow" : s >= 300 ? "cyan" : s ? "green" : "dim";
  }
  function dcls(ms) {
    return ms > 1000 ? "red" : ms > 300 ? "yellow" : "";
  }
  function tableFrom(sql) {
    const m = /from\s+[`'"]?(\w+)[`'"]?/i.exec(sql);
    return m ? m[1] : "table_name";
  }
})();
