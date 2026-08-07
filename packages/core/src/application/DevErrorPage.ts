/**
 * Renders the framework's error pages as standalone HTML: a polished status
 * page for ordinary HTTP errors, and a rich development page with the parsed
 * stack trace, source context, and request details.
 */
import type { HttpContext } from "../pipeline/HttpContext.ts";
import { devSurfacesEnabled } from "../support/env.ts";

// ── HTTP error page (4xx / production 5xx) ────────────────────────────────────

const STATUS_META: Record<number, { title: string; hint: string; color: string; action?: string }> =
  {
    400: {
      title: "Bad Request",
      color: "#f59e0b",
      hint: "The server could not understand the request due to invalid syntax.",
    },
    401: {
      title: "Not Authenticated",
      color: "#f59e0b",
      hint: "You must be logged in to access this resource.",
      action: "/login",
    },
    403: {
      title: "Forbidden",
      color: "#ef4444",
      hint: "You don't have permission to access this resource.",
    },
    404: {
      title: "Not Found",
      color: "#6366f1",
      hint: "The requested URL was not found on this server. Check for typos or try the home page.",
    },
    405: {
      title: "Method Not Allowed",
      color: "#f59e0b",
      hint: "The HTTP method used is not supported for this route.",
    },
    408: {
      title: "Request Timeout",
      color: "#f59e0b",
      hint: "The server timed out waiting for the request.",
    },
    409: {
      title: "Conflict",
      color: "#f59e0b",
      hint: "The request conflicts with the current state of the resource.",
    },
    419: {
      title: "Page Expired",
      color: "#f59e0b",
      hint: "Your session has expired. Reload the page and try again.",
    },
    422: {
      title: "Unprocessable Content",
      color: "#f59e0b",
      hint: "The submitted data failed validation.",
    },
    429: {
      title: "Too Many Requests",
      color: "#ef4444",
      hint: "You have sent too many requests. Please slow down.",
    },
    500: {
      title: "Server Error",
      color: "#dc2626",
      hint: "Something went wrong on our end. Check the server logs for details.",
    },
    503: {
      title: "Service Unavailable",
      color: "#dc2626",
      hint: "The server is temporarily unavailable. Try again in a moment.",
    },
  };

/**
 * Render a styled HTML page for an HTTP status (4xx, or 5xx in production).
 *
 * @param code - Machine-readable error code shown as a badge, when present.
 */
export function renderHttpErrorPage(
  status: number,
  message: string,
  code?: string,
  ctx?: HttpContext,
): Response {
  const meta = STATUS_META[status] ?? { title: "Error", color: "#6b7280", hint: "" };
  const method = ctx?.request.method ?? "";
  const url = ctx ? ctx.url.pathname + (ctx.url.search || "") : "";
  // The same predicate the stack-trace gate uses, so the footer never claims
  // "development" on a page that withheld its stack for being production.
  const isProd = !devSurfacesEnabled();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${status} — ${esc(meta.title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;font-family:system-ui,-apple-system,sans-serif;background:#f8f9fc;color:#1e293b}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:52px 48px;max-width:560px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.06)}
.status{font-size:96px;font-weight:800;line-height:1;color:${meta.color};opacity:.18;letter-spacing:-.04em;margin-bottom:-8px}
.title{font-size:28px;font-weight:700;color:#1e293b;margin-bottom:12px}
.message{font-size:15px;color:#64748b;line-height:1.6;margin-bottom:8px}
.hint{font-size:14px;color:#94a3b8;line-height:1.6;margin-bottom:28px}
.url-pill{display:inline-flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 16px;font-family:monospace;font-size:13px;color:#475569;margin-bottom:28px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.method{font-weight:700;color:${meta.color}}
.actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.btn{padding:9px 20px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;text-decoration:none;border:1px solid}
.btn-primary{background:${meta.color};color:#fff;border-color:${meta.color}}
.btn-ghost{background:#fff;color:#374151;border-color:#e2e8f0}
.code-badge{display:inline-block;background:#f1f5f9;border-radius:4px;padding:2px 8px;font-size:11px;font-family:monospace;color:#94a3b8;margin-top:20px}
.footer{margin-top:28px;font-size:12px;color:#cbd5e1}
${
  !isProd
    ? `.debug{margin-top:28px;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;text-align:left}
.debug h3{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;margin-bottom:8px}
.debug p{font-size:12px;color:#64748b;font-family:monospace}`
    : ""
}
</style>
</head>
<body>
<div class="card">
  <div class="status">${status}</div>
  <h1 class="title">${esc(meta.title)}</h1>
  ${message && message !== meta.title ? `<p class="message">${esc(message)}</p>` : ""}
  <p class="hint">${esc(meta.hint)}</p>
  ${url ? `<div class="url-pill"><span class="method">${esc(method)}</span><span>${esc(url)}</span></div><br/>` : ""}
  <div class="actions">
    <a href="javascript:history.back()" class="btn btn-ghost">← Go back</a>
    <a href="/" class="btn btn-ghost">Home</a>
    ${meta.action ? `<a href="${meta.action}" class="btn btn-primary">${meta.action === "/login" ? "Log in" : "Go"}</a>` : ""}
  </div>
  ${code ? `<div class="code-badge">${esc(code)}</div>` : ""}
  ${!isProd && status >= 500 ? `<div class="debug"><h3>Debug info</h3><p>Check the server console for the full stack trace.</p></div>` : ""}
  <div class="footer">Zerotal Framework${!isProd ? " · development" : ""}</div>
</div>
</body>
</html>`;

  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ── Stack frame parser ────────────────────────────────────────────────────────

interface Frame {
  fn: string;
  file: string;
  line: number;
  col: number;
  isApp: boolean;
}

function parseStack(stack: string): Frame[] {
  return stack
    .split("\n")
    .slice(1)
    .flatMap((raw) => {
      const line = raw.trim();
      // "at fn (file:line:col)" or "at file:line:col"
      const m =
        line.match(/^at (.+?) \((.+):(\d+):(\d+)\)$/) ?? line.match(/^at ()(.+):(\d+):(\d+)$/);
      if (!m) return [];
      const file = (m[2] ?? "").replace(/^file:\/\/\//, "");
      return [
        {
          fn: m[1]?.trim() || "<anonymous>",
          file,
          line: Number(m[3]),
          col: Number(m[4]),
          isApp:
            !file.includes("node_modules") &&
            !file.startsWith("internal:") &&
            !file.startsWith("bun:") &&
            !file.startsWith("node:") &&
            file !== "",
        },
      ];
    });
}

// ── Code context reader ───────────────────────────────────────────────────────

interface CodeLine {
  num: number;
  code: string;
  active: boolean;
}

async function readContext(file: string, errorLine: number, radius = 8): Promise<CodeLine[]> {
  try {
    const text = await Bun.file(file).text();
    const lines = text.split("\n");
    const start = Math.max(0, errorLine - radius - 1);
    const end = Math.min(lines.length, errorLine + radius);
    return lines.slice(start, end).map((code, i) => ({
      num: start + i + 1,
      code,
      active: start + i + 1 === errorLine,
    }));
  } catch {
    return [];
  }
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortPath(full: string): string {
  // Show path relative to packages/ or apps/ root if possible
  const idx = full.replace(/\\/g, "/").lastIndexOf("/packages/");
  if (idx >= 0) return full.slice(idx + 1);
  const idx2 = full.replace(/\\/g, "/").lastIndexOf("/apps/");
  if (idx2 >= 0) return full.slice(idx2 + 1);
  return full;
}

// ── Main render ───────────────────────────────────────────────────────────────

/**
 * Render the interactive development error page for an unhandled exception,
 * with its parsed stack trace, source context, and request details. Never
 * served in production.
 */
export async function renderDevErrorPage(err: unknown, ctx?: HttpContext): Promise<Response> {
  const error = err instanceof Error ? err : new Error(String(err));
  const errClass = error.constructor?.name || "Error";
  const message = error.message || "(no message)";
  const code = (error as { code?: string }).code;
  const frames = parseStack(error.stack ?? "");

  // Read code context for the first N frames that have readable source files
  const ctxFrames = await Promise.all(
    frames.slice(0, 12).map(async (f) => ({
      ...f,
      context: await readContext(f.file, f.line),
    })),
  );

  const method = ctx?.request.method ?? "";
  const url = ctx ? ctx.url.pathname + ctx.url.search : "";
  const headers = ctx
    ? [...ctx.request.headers.entries()]
        .filter(([k]) => !["cookie"].includes(k))
        .map(([k, v]) => ({ k, v }))
    : [];

  const appFrames = ctxFrames.filter((f) => f.isApp);
  const vendorFrames = ctxFrames.filter((f) => !f.isApp);
  const firstApp = appFrames[0] ?? ctxFrames[0];

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(errClass)}: ${esc(message.slice(0, 80))}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;font-size:14px;background:#f8f8f9;color:#1a1a2e;min-height:100vh}

/* ── Header ── */
.header{background:#1e1e2e;padding:28px 32px;border-bottom:3px solid #e05252}
.err-badge{display:inline-block;background:#e05252;color:#fff;font-size:11px;font-weight:700;letter-spacing:.06em;padding:3px 10px;border-radius:4px;text-transform:uppercase;margin-bottom:12px}
.err-msg{color:#f8f8f8;font-size:22px;font-weight:600;line-height:1.4;word-break:break-word;max-width:900px}
.err-meta{margin-top:12px;display:flex;gap:16px;flex-wrap:wrap}
.err-meta span{font-size:12px;color:#888;display:flex;align-items:center;gap:5px}
.badge{background:#2a2a3e;color:#aaa;font-family:monospace;font-size:11px;padding:2px 7px;border-radius:3px}
.badge.code{color:#f9c84a}
.method{color:#6ee7b7;font-weight:700;font-family:monospace}
.path{color:#93c5fd;font-family:monospace}

/* ── Layout ── */
.body{display:grid;grid-template-columns:320px 1fr;min-height:calc(100vh - 200px)}

/* ── Frame list ── */
.frames{background:#16161e;overflow-y:auto;border-right:1px solid #2a2a3e}
.frames-section{padding:8px 0}
.frames-label{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#555;padding:8px 16px 4px}
.frame{padding:10px 16px;cursor:pointer;border-left:3px solid transparent;transition:background .1s}
.frame:hover{background:#1e1e2e}
.frame.active{background:#1e2a3a;border-left-color:#6366f1}
.frame.app .fn{color:#e2e8f0;font-weight:500}
.frame.vendor .fn{color:#555}
.frame .fn{font-size:13px;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.frame .loc{font-size:11px;color:#444;margin-top:2px;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.frame.app .loc{color:#6366f1}

/* ── Code panel ── */
.code-panel{background:#fff;display:flex;flex-direction:column}
.code-header{padding:12px 20px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:8px}
.code-file{font-family:monospace;font-size:13px;color:#334155;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.code-line-num{font-size:11px;background:#6366f1;color:#fff;padding:2px 8px;border-radius:4px;flex-shrink:0}
.code-body{overflow:auto;flex:1}
table.code{border-collapse:collapse;width:100%;font-family:'Fira Code',monospace;font-size:13px;line-height:1.7}
table.code tr td{padding:1px 0;white-space:pre}
table.code tr.active{background:#fef3c7}
table.code tr.active td{color:#92400e}
table.code tr.active .ln{background:#fbbf24;color:#78350f}
.ln{display:inline-block;min-width:48px;padding:0 12px 0 8px;text-align:right;color:#94a3b8;user-select:none;border-right:1px solid #e2e8f0;margin-right:12px;font-size:12px}
table.code tr.active .ln{border-right-color:#fbbf24}
.code-empty{padding:40px;color:#94a3b8;text-align:center;font-size:14px}

/* ── Request panel ── */
.request{border-top:1px solid #e2e8f0;background:#fff}
.tabs{display:flex;border-bottom:1px solid #e2e8f0}
.tab{padding:10px 20px;font-size:13px;font-weight:500;color:#64748b;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.tab.active{color:#6366f1;border-bottom-color:#6366f1}
.tab-body{padding:16px 20px;display:none}
.tab-body.active{display:block}
table.info{border-collapse:collapse;width:100%;font-size:13px}
table.info td{padding:5px 12px;vertical-align:top;border-bottom:1px solid #f1f5f9}
table.info td:first-child{width:200px;color:#64748b;font-weight:500;white-space:nowrap}
table.info td:last-child{font-family:monospace;color:#1e293b;word-break:break-all}

/* ── Footer ── */
.footer{padding:12px 20px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;display:flex;gap:16px}
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px">
    <div style="flex:1;min-width:0">
      <div class="err-badge">${esc(errClass)}</div>
      <div class="err-msg">${esc(message)}</div>
      <div class="err-meta">
        ${code ? `<span><span class="badge code">${esc(code)}</span></span>` : ""}
        ${method ? `<span><span class="badge"><span class="method">${esc(method)}</span> <span class="path">${esc(url)}</span></span></span>` : ""}
        <span><span class="badge">${new Date().toLocaleTimeString()}</span></span>
      </div>
    </div>
    <button id="copyBtn" onclick="copyForAI()" title="Copy error as Markdown for AI assistants"
      style="flex-shrink:0;margin-top:4px;padding:7px 14px;background:#2a2a3e;border:1px solid #3a3a5e;border-radius:6px;color:#aaa;font-size:12px;cursor:pointer;white-space:nowrap;transition:all .15s">
      Copy for AI
    </button>
  </div>
</div>

<!-- Body: frames + code -->
<div class="body">

  <!-- Frame list -->
  <div class="frames" id="frameList">
    ${
      appFrames.length
        ? `
    <div class="frames-section">
      <div class="frames-label">Application</div>
      ${appFrames
        .map(
          (f) => `
      <div class="frame app ${f === firstApp ? "active" : ""}" onclick="showFrame(${ctxFrames.indexOf(f)})" id="fr-${ctxFrames.indexOf(f)}">
        <div class="fn">${esc(f.fn)}</div>
        <div class="loc">${esc(shortPath(f.file))}:${f.line}</div>
      </div>`,
        )
        .join("")}
    </div>`
        : ""
    }
    ${
      vendorFrames.length
        ? `
    <div class="frames-section">
      <div class="frames-label">Framework / Vendor</div>
      ${vendorFrames
        .map(
          (f) => `
      <div class="frame vendor" onclick="showFrame(${ctxFrames.indexOf(f)})" id="fr-${ctxFrames.indexOf(f)}">
        <div class="fn">${esc(f.fn)}</div>
        <div class="loc">${esc(shortPath(f.file))}:${f.line}</div>
      </div>`,
        )
        .join("")}
    </div>`
        : ""
    }
  </div>

  <!-- Code panel -->
  <div class="code-panel" id="codePanel">
    ${ctxFrames
      .map(
        (f, i) => `
    <div id="ctx-${i}" style="display:${f === firstApp ? "flex" : "none"};flex-direction:column;height:100%">
      <div class="code-header">
        <div class="code-file">${esc(shortPath(f.file))}</div>
        <div class="code-line-num">line ${f.line}</div>
      </div>
      <div class="code-body">
        ${
          f.context.length
            ? `
        <table class="code">
          ${f.context
            .map(
              (l) => `
          <tr class="${l.active ? "active" : ""}">
            <td><span class="ln">${l.active ? "►" : ""} ${l.num}</span>${esc(l.code)}</td>
          </tr>`,
            )
            .join("")}
        </table>`
            : `<div class="code-empty">Source not available</div>`
        }
      </div>
    </div>`,
      )
      .join("")}
  </div>

</div>

<!-- Request panel -->
<div class="request">
  <div class="tabs">
    <div class="tab active" onclick="showTab('req')">Request</div>
    <div class="tab" onclick="showTab('hdr')">Headers</div>
    <div class="tab" onclick="showTab('stack')">Raw Stack</div>
  </div>
  <div class="tab-body active" id="tab-req">
    <table class="info">
      <tr><td>Method</td><td>${esc(method || "—")}</td></tr>
      <tr><td>URL</td><td>${esc(url || "—")}</td></tr>
      ${ctx ? `<tr><td>Full URL</td><td>${esc(ctx.url.href)}</td></tr>` : ""}
    </table>
  </div>
  <div class="tab-body" id="tab-hdr">
    <table class="info">
      ${headers.map(({ k, v }) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("") || '<tr><td colspan="2" style="color:#94a3b8">No headers</td></tr>'}
    </table>
  </div>
  <div class="tab-body" id="tab-stack">
    <pre style="font-size:12px;color:#475569;line-height:1.7;overflow:auto;white-space:pre-wrap;word-break:break-all">${esc(error.stack ?? "(no stack)")}</pre>
  </div>
</div>

<div class="footer">
  <span>Zerotal Framework</span>
  <span>Development error page — not shown in production</span>
</div>

<script>
const ctxData = ${JSON.stringify(ctxFrames.map((f) => f.file + ":" + f.line))};

const _errorMd = ${JSON.stringify({
    errClass,
    message,
    code: code ?? null,
    method,
    url,
    stack: error.stack ?? "",
    frames: ctxFrames.map((f) => ({
      fn: f.fn,
      file: shortPath(f.file),
      line: f.line,
      isApp: f.isApp,
      context: f.context.map((l) => ({ num: l.num, code: l.code, active: l.active })),
    })),
  })};

function copyForAI() {
  const d = _errorMd;
  let md = '## ' + d.errClass + '\\n\\n';
  md += d.message + '\\n\\n';
  if (d.code)   md += '**Code:** \`' + d.code + '\`  \\n';
  if (d.method) md += '**Request:** \`' + d.method + ' ' + d.url + '\`  \\n';
  md += '\\n';

  // First app frame with code context
  const appFrame = d.frames.find(f => f.isApp && f.context.length > 0);
  if (appFrame) {
    md += '### Code Context (' + appFrame.file + ':' + appFrame.line + ')\\n\\n';
    md += '\`\`\`\\n';
    appFrame.context.forEach(l => {
      md += (l.active ? '► ' : '  ') + String(l.num).padStart(4) + '  ' + l.code + '\\n';
    });
    md += '\`\`\`\\n\\n';
  }

  // All app frames
  const appFrames = d.frames.filter(f => f.isApp);
  if (appFrames.length) {
    md += '### Application Stack\\n\\n';
    appFrames.forEach(f => { md += '- \`' + f.fn + '\` — ' + f.file + ':' + f.line + '\\n'; });
    md += '\\n';
  }

  md += '### Full Stack Trace\\n\\n\`\`\`\\n' + d.stack + '\\n\`\`\`\\n';

  const btn = document.getElementById('copyBtn');

  function _ok() {
    if (btn) { btn.textContent = 'Copied!'; btn.style.borderColor = '#6ee7b7'; btn.style.color = '#6ee7b7'; }
    setTimeout(function() {
      if (btn) { btn.textContent = 'Copy for AI'; btn.style.borderColor = '#3a3a5e'; btn.style.color = '#aaa'; }
    }, 2000);
  }
  function _fail() {
    if (btn) { btn.textContent = 'Copy failed'; }
  }

  // Chromium bug workaround (issues.chromium.org/issues/414348233):
  // navigator.clipboard.writeText can silently fail in non-HTTPS / dev contexts.
  // Fallback: create an off-screen textarea, select its content, execCommand('copy').
  function _fallback() {
    var el = document.createElement('textarea');
    el.value = md;
    el.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(el);
    el.focus();
    el.select();
    el.setSelectionRange(0, 0x7fffffff);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(el);
    ok ? _ok() : _fail();
  }

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(md).then(_ok).catch(_fallback);
  } else {
    _fallback();
  }
}

function showFrame(idx) {
  document.querySelectorAll('.frame').forEach(el => el.classList.remove('active'));
  const fr = document.getElementById('fr-' + idx);
  if (fr) fr.classList.add('active');
  document.querySelectorAll('[id^="ctx-"]').forEach(el => el.style.display = 'none');
  const ctx = document.getElementById('ctx-' + idx);
  if (ctx) { ctx.style.display = 'flex'; ctx.style.flexDirection = 'column'; ctx.style.height = '100%'; }
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-body').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab[onclick*="' + name + '"]').forEach(el => el.classList.add('active'));
  const tb = document.getElementById('tab-' + name);
  if (tb) tb.classList.add('active');
}
</script>
</body>
</html>`;

  return new Response(html, {
    status: 500,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
