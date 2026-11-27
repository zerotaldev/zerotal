// ── Dev-mode error overlay ─────────────────────────────────────────────────────
//
// A full-screen, Vite/Next-style overlay for unexpected errors thrown by a Flow action. The
// server attaches the error's message + stack + action to the error frame ONLY under the dev
// worker (never in production), so the mere presence of a stack means "show the overlay". Purely
// presentational + dismissible; the component's patch still applies underneath, so dismissing
// returns you to a live page.

export interface OverlayError {
  message: string;
  name?: string | undefined;
  stack?: string | undefined;
  action?: string | undefined;
  component?: string | undefined;
  /** The app's source around the throw, which the server reads and sends with the error. */
  frame?:
    | {
        file: string;
        line: number;
        column: number;
        lines: { num: number; code: string; active: boolean }[];
      }
    | undefined;
}

const OVERLAY_ID = "flow-error-overlay";

function _esc(s: unknown): string {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/**
 * The error as plain text: heading, where it was thrown, the code around it, the stack.
 *
 * The overlay draws in a shadow root, which a page-text reader (a coding agent, a screen reader
 * in some modes, `innerText`) does not see, so the same detail is also written into the document
 * as ordinary text. Shared with the server's boot-error page so the two read the same.
 *
 * @internal
 */
export function _errorText(err: OverlayError): string {
  const lines: string[] = [`${err.name ?? "Error"}: ${err.message}`];
  const where = [
    err.action ? `action ${err.action}` : "",
    err.component ? `in ${err.component}` : "",
  ].filter(Boolean);
  if (where.length > 0) lines.push(`During ${where.join(" ")}`);
  if (err.frame) {
    lines.push("", `${err.frame.file}:${err.frame.line}:${err.frame.column}`);
    for (const l of err.frame.lines) lines.push(`${l.active ? ">" : " "} ${l.num} | ${l.code}`);
  }
  if (err.stack) {
    const frames = err.stack
      .split("\n")
      .slice(1)
      .map((l) => l.trim())
      .filter(Boolean);
    if (frames.length > 0) lines.push("", ...frames);
  }
  return lines.join("\n");
}

const TEXT_ID = "flow-error-overlay-text";

/** Render each stack line, dimming framework/node_modules frames so app frames stand out. @internal */
export function _formatStack(stack: string): string {
  return stack
    .split("\n")
    .slice(1) // first line is "Name: message", already shown as the heading
    .map((line) => {
      const dim = /node_modules|node:internal|\/flow\/src\//.test(line);
      return `<div class="flow-eo-frame${dim ? " dim" : ""}">${_esc(line.trim())}</div>`;
    })
    .join("");
}

/** The source lines around the throw, the thrown-from line marked. @internal */
export function _formatFrame(frame: NonNullable<OverlayError["frame"]>): string {
  const rows = frame.lines
    .map(
      (l) =>
        `<div class="flow-eo-line${l.active ? " on" : ""}"><span class="flow-eo-num">${l.num}</span>${_esc(l.code)}</div>`,
    )
    .join("");
  return `<div class="flow-eo-code"><div class="flow-eo-file">${_esc(frame.file)}:${frame.line}:${frame.column}</div>${rows}</div>`;
}

/** Show (or replace) the dev error overlay for `err`. Idempotent — re-showing replaces content. */
export function showErrorOverlay(err: OverlayError): void {
  if (typeof document === "undefined") return;
  hideErrorOverlay();

  const root = document.createElement("div");
  root.id = OVERLAY_ID;
  const shadow = root.attachShadow({ mode: "open" });

  const where = [
    err.action ? `action <b>${_esc(err.action)}</b>` : "",
    err.component ? `in <b>${_esc(err.component)}</b>` : "",
  ]
    .filter(Boolean)
    .join(" ");

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .flow-eo-back {
        position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(10, 12, 20, 0.72); backdrop-filter: blur(3px);
        display: flex; align-items: flex-start; justify-content: center; padding: 6vh 16px;
        font: 13px/1.55 ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace; color: #e5e7eb;
        overflow: auto;
      }
      .flow-eo-card {
        width: min(920px, 100%); background: #14161f;
        border: 1px solid #3b1d24; border-radius: 12px; overflow: hidden;
        box-shadow: 0 20px 60px rgba(0,0,0,.5);
      }
      .flow-eo-head { padding: 16px 20px; background: #1b1013; border-bottom: 1px solid #3b1d24; }
      .flow-eo-badge {
        display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: .4px;
        color: #fecaca; background: #7f1d1d; padding: 2px 8px; border-radius: 999px; text-transform: uppercase;
      }
      .flow-eo-where { margin-top: 8px; font-size: 12px; color: #9aa0b4; }
      .flow-eo-where b { color: #cbd5e1; font-weight: 700; }
      .flow-eo-msg { margin-top: 8px; font-size: 16px; font-weight: 600; color: #fca5a5; white-space: pre-wrap; word-break: break-word; }
      .flow-eo-code { padding: 12px 0 4px; border-bottom: 1px solid #262b3f; overflow-x: auto; }
      .flow-eo-file { padding: 0 20px 8px; font-size: 12px; color: #9aa0b4; word-break: break-all; }
      .flow-eo-line { white-space: pre; padding: 0 20px; color: #a9b1d6; }
      .flow-eo-line.on { background: rgba(127, 29, 29, .45); color: #fecaca; }
      .flow-eo-num { display: inline-block; width: 4ch; margin-right: 12px; text-align: right; color: #565f89; user-select: none; }
      .flow-eo-stack { padding: 12px 20px 18px; max-height: 46vh; overflow: auto; }
      .flow-eo-frame { white-space: pre-wrap; word-break: break-all; color: #cbd5e1; padding: 1px 0; }
      .flow-eo-frame.dim { color: #565f89; }
      .flow-eo-foot { display: flex; align-items: center; gap: 10px; padding: 10px 20px; border-top: 1px solid #262b3f; background: #0f1119; }
      .flow-eo-hint { flex: 1; font-size: 11px; color: #565f89; }
      .flow-eo-btn {
        font: inherit; font-size: 12px; cursor: pointer; padding: 5px 12px; border-radius: 6px;
        background: #262b3f; color: #e5e7eb; border: 1px solid #3b4261;
      }
      .flow-eo-btn:hover { background: #303650; }
    </style>
    <div class="flow-eo-back" part="back">
      <div class="flow-eo-card" role="alertdialog" aria-modal="true">
        <div class="flow-eo-head">
          <span class="flow-eo-badge">${_esc(err.name || "Error")}</span>
          ${where ? `<div class="flow-eo-where">${where}</div>` : ""}
          <div class="flow-eo-msg">${_esc(err.message)}</div>
        </div>
        ${err.frame ? _formatFrame(err.frame) : ""}
        ${err.stack ? `<div class="flow-eo-stack">${_formatStack(err.stack)}</div>` : ""}
        <div class="flow-eo-foot">
          <span class="flow-eo-hint">Flow dev error · fix the action and save, or dismiss (Esc)</span>
          <button class="flow-eo-btn" data-eo-dismiss type="button">Dismiss</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(root);

  // The readable copy: off screen, not hidden, so it stays in the page's text.
  const text = document.createElement("pre");
  text.id = TEXT_ID;
  text.setAttribute("data-flow-error", "");
  text.style.cssText =
    "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;" +
    "clip:rect(0,0,0,0);white-space:pre-wrap;border:0";
  text.textContent = _errorText(err);
  document.body.appendChild(text);

  const back = shadow.querySelector<HTMLElement>(".flow-eo-back")!;
  back.addEventListener("click", (e) => {
    // Dismiss on backdrop click or the Dismiss button; keep clicks inside the card.
    if (e.target === back || (e.target as HTMLElement).closest("[data-eo-dismiss]"))
      hideErrorOverlay();
  });
  document.addEventListener("keydown", _onKey);
}

function _onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") hideErrorOverlay();
}

/** Remove the overlay if present. */
export function hideErrorOverlay(): void {
  if (typeof document === "undefined") return;
  document.getElementById(OVERLAY_ID)?.remove();
  document.getElementById(TEXT_ID)?.remove();
  document.removeEventListener("keydown", _onKey);
}
