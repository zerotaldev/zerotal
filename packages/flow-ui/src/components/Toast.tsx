/** @jsxImportSource @zerotal/flow */
// ── <Toaster> ───────────────────────────────────────────────────────────────
//
// The host for transient messages — "Saved", "3 products deleted", "Import
// failed". Mount it once, near the end of your layout, and every `page.flash()`
// on the server lands in it.
//
// It listens to the same `flow:flash` window event Flow's own flash host does,
// so nothing about how a message is sent changes. What changes is the rendering:
// the built-in host writes literal hex colours into inline styles, which cannot
// be re-themed by wrapping it. This builds the surface from theme tokens instead,
// so toasts match the rest of the panel in light and dark alike.
//
// Tokens are read once at mount and written into inline styles, because the
// toast markup is created by a script at runtime and never passes through
// Tailwind — a class name here would be purged from the stylesheet.
//
//   <Toaster />
//   <Toaster position="top-center" duration={6000} />

import type { HtmlNode } from "@zerotal/flow";

export type ToastPosition =
  "top-right" | "top-left" | "top-center" | "bottom-right" | "bottom-left" | "bottom-center";

export interface ToasterProps {
  position?: ToastPosition;
  /** How long a toast stays, in milliseconds. */
  duration?: number;
  /** Most toasts on screen at once; older ones drop off the end. */
  max?: number;
  [key: string]: unknown;
}

const POSITION: Record<ToastPosition, string> = {
  "top-right": "top:1rem;right:1rem;align-items:flex-end",
  "top-left": "top:1rem;left:1rem;align-items:flex-start",
  "top-center": "top:1rem;left:50%;transform:translateX(-50%);align-items:center",
  "bottom-right": "bottom:1rem;right:1rem;align-items:flex-end",
  "bottom-left": "bottom:1rem;left:1rem;align-items:flex-start",
  "bottom-center": "bottom:1rem;left:50%;transform:translateX(-50%);align-items:center",
};

/**
 * The runtime that draws a toast.
 *
 * Deliberately dependency-free and self-contained: it is injected once, guards
 * against a second mount, and reads its theme from CSS custom properties on
 * `:root` so a theme switch is picked up without this knowing any colours.
 */
function toasterScript(max: number): string {
  return `(function(){
  if (window.__flowUiToaster) return; window.__flowUiToaster = 1;
  var root = document.getElementById('flow-ui-toaster');
  if (!root) return;
  var MAX = ${max};
  var defDur = Number(root.getAttribute('data-duration')) || 4000;

  // Resolved from the stylesheet, so the toast follows the panel's theme —
  // including a dark-mode toggle, which re-runs this on the next toast.
  function token(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  var ICONS = {
    success: '<path d="M20 6 9 17l-5-5"/>',
    error: '<path d="M18 6 6 18M6 6l12 12"/>',
    warning: '<path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>',
    info: '<path d="M12 16v-4M12 8h.01"/><circle cx="12" cy="12" r="10"/>'
  };
  var ACCENT = {
    success: function(){ return token('--flow-toast-success', '#16a34a'); },
    error: function(){ return token('--destructive', '#dc2626'); },
    warning: function(){ return token('--flow-toast-warning', '#d97706'); },
    info: function(){ return token('--primary', '#2563eb'); }
  };

  function dismiss(el) {
    if (el.__gone) return; el.__gone = 1;
    el.style.opacity = '0';
    el.style.transform = 'translateY(4px) scale(.98)';
    setTimeout(function(){ el.remove(); }, 180);
  }

  function toast(detail) {
    var level = String(detail.level || detail.type || 'info').toLowerCase();
    if (level === 'danger') level = 'error';
    if (!ICONS[level]) level = 'info';
    var accent = ACCENT[level]();

    var el = document.createElement('div');
    el.setAttribute('role', level === 'error' ? 'alert' : 'status');
    el.style.cssText = [
      'pointer-events:auto', 'display:flex', 'gap:10px', 'align-items:flex-start',
      'min-width:280px', 'max-width:min(90vw,420px)', 'padding:12px 14px',
      'border-radius:calc(' + token('--radius','0.5rem') + ')',
      'border:1px solid ' + token('--border','#e5e7eb'),
      'background:' + token('--popover', token('--background','#fff')),
      'color:' + token('--popover-foreground', token('--foreground','#111')),
      'box-shadow:0 8px 24px -8px rgb(0 0 0 / .25)',
      'font:500 14px/1.4 ' + token('--font-sans','system-ui,-apple-system,Segoe UI,Roboto,sans-serif'),
      'opacity:0', 'transform:translateY(4px) scale(.98)',
      'transition:opacity .18s ease, transform .18s ease'
    ].join(';');

    var svg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="' + accent +
      '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex:none;margin-top:1px">' +
      ICONS[level] + '</svg>';

    var body = document.createElement('div');
    body.style.cssText = 'flex:1;min-width:0';
    var title = document.createElement('div');
    title.textContent = String(detail.message || detail.title || '');
    title.style.cssText = 'word-break:break-word';
    body.appendChild(title);
    if (detail.description) {
      var desc = document.createElement('div');
      desc.textContent = String(detail.description);
      desc.style.cssText = 'margin-top:2px;font-weight:400;opacity:.7;font-size:13px';
      body.appendChild(desc);
    }

    var icon = document.createElement('span');
    icon.innerHTML = svg;
    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    close.style.cssText = 'flex:none;opacity:.5;background:none;border:0;cursor:pointer;color:inherit;padding:2px';
    close.addEventListener('click', function(){ dismiss(el); });

    el.appendChild(icon); el.appendChild(body); el.appendChild(close);
    root.appendChild(el);

    // Oldest first, so a burst of messages does not fill the screen.
    while (root.children.length > MAX) dismiss(root.children[0]);

    requestAnimationFrame(function(){
      el.style.opacity = '1';
      el.style.transform = 'none';
    });

    var ms = Number(detail.duration) || defDur;
    // A message that needs acknowledging should not vanish on its own.
    if (ms > 0 && level !== 'error') setTimeout(function(){ dismiss(el); }, ms);
  }

  window.addEventListener('flow:flash', function(e){ toast((e && e.detail) || {}); });
})();`;
}

export function Toaster(props: ToasterProps = {}): HtmlNode {
  const { position = "bottom-right", duration = 4000, max = 4, ...rest } = props;
  return (
    <div
      id="flow-ui-toaster"
      data-duration={duration}
      aria-live="polite"
      aria-atomic="false"
      style={`position:fixed;z-index:60;display:flex;flex-direction:column;gap:8px;pointer-events:none;${POSITION[position]}`}
      {...rest}
    >
      <script dangerouslySetInnerHTML={{ __html: toasterScript(max) }} />
    </div>
  );
}
