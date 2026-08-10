/**
 * Native Flow components — the built-in library of PascalCase function
 * components used inside a `Component`'s `render()`. Each one compiles to
 * ordinary HTML elements plus Flow/Alpine directives, so you use them like
 * any JSX element:
 *
 * ```tsx
 * <Link href="/posts" hover>Posts</Link>
 * <Head><title>Dashboard</title></Head>
 * <Persist name="player"><audio src={src} controls /></Persist>
 * ```
 */

import { jsx, _resolveReactiveName, _resolveBindName, _injectedBindKey } from "./jsx-runtime.ts";
import type { HtmlNode } from "./jsx-runtime.ts";
import { jsLiteral } from "./utils.ts";

// ── <Link> ────────────────────────────────────────────────────────────────
/** Props for {@link Link}: the target `href` plus SPA-navigation and active-state flags. */
export interface LinkProps {
  href: string;
  hover?: boolean;
  current?: boolean;
  exact?: boolean;
  preserveScroll?: boolean;
  [key: string]: unknown;
}

/**
 * An `<a>` wired for Flow SPA navigation, with automatic URL-based active state
 * that you can override or refine per link.
 *
 * @remarks
 * `hover` prefetches the target on hover; `current` forces (`true`) or suppresses
 * (`false`) the active state instead of deriving it from the URL; `exact` restricts
 * the automatic active state to an exact path match. Any other props pass through to
 * the `<a>`.
 *
 * Following a link lands at the top of the new page, as a full navigation would —
 * or at the fragment, if the href names one. `preserveScroll` leaves the viewport
 * where it is instead, which is what you want for a control the user is looking at
 * partway down a page (a filter, a sort header, a tab strip) rather than a link
 * that takes them somewhere else.
 *
 * @example
 * ```tsx
 * <Link href="/posts" hover>Posts</Link>
 * <Link href="/dashboard" exact>Dashboard</Link>
 * <Link href="/posts?sort=title" preserveScroll>Title</Link>
 * ```
 *
 * @category Navigation & data
 */
export function Link(props: LinkProps & { children?: unknown }): HtmlNode {
  const { href, hover, current, exact, preserveScroll, children, ...rest } = props;
  const out: Record<string, unknown> = { ...rest, href, navigate: true, children };
  if (hover) out["navigateHover"] = true;
  if (preserveScroll) out["navigatePreserveScroll"] = true;
  // `current` overrides the automatic URL-based active state:
  //   false → never active (flow:current.ignore)
  //   true  → always active, and stays active across SPA navigations (flow:current.force).
  //           `data-current` is also set here so the link renders active on first paint,
  //           before the client runtime runs.
  if (current === false) out["flow:current.ignore"] = true;
  if (current === true) {
    out["flow:current.force"] = true;
    out["data-current"] = "";
  }
  // `exact` restricts the automatic active state to an exact path match, so an index
  // link (e.g. /section) isn't marked current on its own sub-pages (/section/child).
  if (exact) out["flow:current.exact"] = true;
  return jsx("a", out);
}

// ── <Head> ────────────────────────────────────────────────────────────────
/**
 * Marks its children as document `<head>` content — they are hoisted into the
 * page head (and reconciled across SPA navigations) rather than rendered inline.
 *
 * @example
 * ```tsx
 * <Head>
 *   <title>Dashboard</title>
 *   <meta name="description" content="Your account overview" />
 * </Head>
 * ```
 *
 * @category Document head
 */
export function Head(props: { children?: unknown }): HtmlNode {
  return jsx("template", { "data-flow-head": true, children: props.children });
}

// ── <Persist> ───────────────────────────────────────────────────────────────
/**
 * Preserves its subtree untouched across SPA navigations and morphs — the element
 * with the given `name` is carried over instead of re-rendered, so media keeps
 * playing and DOM state survives.
 *
 * @remarks
 * The children are also marked `flow:ignore`, so Flow never patches inside them.
 *
 * @example
 * ```tsx
 * <Persist name="player">
 *   <audio src={src} controls />
 * </Persist>
 * ```
 *
 * @category Navigation & data
 */
export function Persist(props: { name: string; children?: unknown }): HtmlNode {
  return jsx("div", {
    "data-flow-persist": props.name,
    "flow:ignore": true,
    children: props.children,
  });
}

// ── <Title> ───────────────────────────────────────────────────────────────────
/**
 * Shorthand for setting the document `<title>` — wraps its children in a `<title>`
 * inside a {@link Head}.
 *
 * @example
 * ```tsx
 * <Title>Dashboard</Title>
 * ```
 *
 * @category Document head
 */
export function Title(props: { children?: unknown }): HtmlNode {
  return Head({ children: jsx("title", { children: props.children }) });
}

// ── <Modal> ───────────────────────────────────────────────────────────────────
/** Props for {@link Modal}: the `show` binding plus title, close behaviour and panel styling. */
export interface ModalProps {
  show?: unknown;
  /** Explicit prop name override — use when auto-resolve is ambiguous (multiple @expose props share the same value). */
  name?: string;
  onClose?: unknown;
  title?: unknown;
  closable?: boolean;
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

/**
 * A centered, backdrop-dimmed dialog whose visibility is driven by a bound `@expose`
 * boolean; backdrop click and the × button close it locally (no server round-trip)
 * and focus is trapped while open.
 *
 * @remarks
 * Bind `show` to a reactive boolean — its name is auto-resolved (override with `name`).
 * `closable` (default `true`) renders the × button, `title` fills the header and wires
 * `aria-labelledby`, and `onClose` replaces the default `$flow.<name> = false` close action.
 *
 * @example
 * ```tsx
 * <Modal show={this.confirming} title="Delete post?">
 *   <p>This can't be undone.</p>
 * </Modal>
 * ```
 *
 * @category Overlays
 */
export function Modal(props: ModalProps): HtmlNode {
  const {
    show,
    name: nameProp,
    onClose,
    title,
    closable = true,
    class: panelClass,
    children,
    ...rest
  } = props;
  const name = nameProp ?? _injectedBindKey(props, "show") ?? _resolveReactiveName(show);
  const open = Boolean(show);

  const closeProps: Record<string, unknown> = onClose
    ? { onClick: onClose }
    : name
      ? { "flow:click": `$flow.${name} = false` }
      : {};

  const backdrop = jsx("div", {
    class: "absolute inset-0 bg-black/50",
    ...closeProps,
  });

  const titleId = name ? `flow-modal-title-${name}` : undefined;
  const header =
    title || closable
      ? jsx("div", {
          class: "flex items-center justify-between gap-4 mb-3",
          children: [
            title
              ? jsx("h2", { id: titleId, class: "text-lg font-semibold", children: title })
              : "",
            closable
              ? jsx("button", {
                  type: "button",
                  "aria-label": "Close",
                  class: "text-gray-400 hover:text-white text-2xl leading-none",
                  children: "×",
                  ...closeProps,
                })
              : "",
          ],
        })
      : "";

  const panel = jsx("div", {
    class:
      "relative z-10 w-full max-w-lg rounded-xl bg-gray-900 border border-gray-800 p-5 shadow-xl text-white " +
      (panelClass ?? ""),
    "flow:transition": true,
    children: [header, children],
  });

  const overlay: Record<string, unknown> = {
    ...rest,
    role: "dialog",
    "aria-modal": "true",
    class: "fixed inset-0 z-50 flex items-center justify-center p-4",
    children: [backdrop, panel],
  };
  if (name) {
    overlay["flow:show"] = name;
    overlay["data-flow-modal"] = name;
    overlay["x-trap"] = `$flow.${name}`; // trap focus while open (@alpinejs/focus)
    if (title) overlay["aria-labelledby"] = titleId;
  }
  if (!open) overlay["style"] = { display: "none" };

  return jsx("div", overlay);
}

// ── <Flash> ───────────────────────────────────────────────────────────────────
/** Props for {@link Flash}: the default toast `position` and auto-dismiss `duration`. */
export interface FlashProps {
  position?:
    "top-right" | "top-left" | "bottom-right" | "bottom-left" | "top-center" | "bottom-center";
  duration?: number;
  [key: string]: unknown;
}

// Container positioning is INLINE (not Tailwind classes): the <Flash> markup lives
// in the flow package, which an app's Tailwind `@source` paths don't scan — so any
// utility classes here get purged and the toast collapses to the page corner. Inline
// styles make the component self-contained and correct in every app.
const _FLASH_POS: Record<string, Record<string, string>> = {
  "top-right": { top: "1rem", right: "1rem", alignItems: "flex-end" },
  "top-left": { top: "1rem", left: "1rem", alignItems: "flex-start" },
  "bottom-right": { bottom: "1rem", right: "1rem", alignItems: "flex-end" },
  "bottom-left": { bottom: "1rem", left: "1rem", alignItems: "flex-start" },
  "top-center": { top: "1rem", left: "50%", transform: "translateX(-50%)", alignItems: "center" },
  "bottom-center": {
    bottom: "1rem",
    left: "50%",
    transform: "translateX(-50%)",
    alignItems: "center",
  },
};

/**
 * The toast host — a single fixed container plus the client runtime that renders
 * flash messages emitted by the server (via `flow:flash` window events) as styled,
 * self-dismissing toasts. Place it once, near the root of your layout.
 *
 * @remarks
 * `position` (default `"bottom-right"`) and `duration` in ms (default `4000`) are the
 * defaults for toasts that don't specify their own; individual toasts can override
 * position, duration, icon, actions and more via the emitted payload.
 *
 * @example
 * ```tsx
 * <Flash position="top-right" duration={6000} />
 * ```
 *
 * @category Feedback
 */
export function Flash(props: FlashProps = {}): HtmlNode {
  const position = props.position ?? "bottom-right";
  const duration = props.duration ?? 4000;
  const pos = _FLASH_POS[position] ?? _FLASH_POS["bottom-right"];

  const script = `(function(){
    if (window.__flowFlash) return; window.__flowFlash = 1;
    var root = document.getElementById('flow-flash');
    if (!root) return;
    var defDur = Number(root.getAttribute('data-duration')) || 4000;
    var defPos = root.getAttribute('data-position') || 'bottom-right';
    var FONT = 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    var COLORS = { success:'#16a34a', error:'#dc2626', danger:'#dc2626', warning:'#d97706', info:'#2563eb' };
    // Inline position styles, mirrored from the server _FLASH_POS map, so per-toast
    // positions get a fixed container even though Tailwind classes here are purged.
    var POS = {
      'top-right':'top:1rem;right:1rem;align-items:flex-end',
      'top-left':'top:1rem;left:1rem;align-items:flex-start',
      'bottom-right':'bottom:1rem;right:1rem;align-items:flex-end',
      'bottom-left':'bottom:1rem;left:1rem;align-items:flex-start',
      'top-center':'top:1rem;left:50%;transform:translateX(-50%);align-items:center',
      'bottom-center':'bottom:1rem;left:50%;transform:translateX(-50%);align-items:center'
    };
    var ICONS = {
      success: '<svg viewBox="0 0 20 20" fill="currentColor" width="22" height="22"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd"/></svg>',
      error: '<svg viewBox="0 0 20 20" fill="currentColor" width="22" height="22"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd"/></svg>',
      warning: '<svg viewBox="0 0 20 20" fill="currentColor" width="22" height="22"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/></svg>',
      info: '<svg viewBox="0 0 20 20" fill="currentColor" width="22" height="22"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clip-rule="evenodd"/></svg>'
    };
    ICONS.danger = ICONS.error;
    var X = '<svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/></svg>';
    function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
    // One fixed container per position. The default position reuses the server-rendered
    // #flow-flash element; others are created lazily and appended to <body>.
    var containers = {};
    function container(pos){
      if (pos === defPos) return root;
      if (containers[pos]) return containers[pos];
      var c = document.createElement('div');
      c.style.cssText = 'position:fixed;z-index:50;display:flex;flex-direction:column;gap:8px;pointer-events:none;'+(POS[pos]||POS[defPos]||'');
      document.body.appendChild(c);
      containers[pos] = c;
      return c;
    }
    // Theme is resolved per-toast so it tracks the live OS/app theme: honour an explicit
    // .dark / .light class on <html> first, else fall back to prefers-color-scheme.
    function theme(){
      var el = document.documentElement;
      var dark = el.classList.contains('dark') ||
        (!el.classList.contains('light') && window.matchMedia &&
         matchMedia('(prefers-color-scheme: dark)').matches);
      return dark
        ? { bg:'#1f2937', ring:'rgba(255,255,255,.1)', title:'#f9fafb', body:'#9ca3af', close:'#6b7280', btnBg:'#374151', btnText:'#e5e7eb' }
        : { bg:'#ffffff', ring:'rgba(0,0,0,.05)', title:'#111827', body:'#6b7280', close:'#9ca3af', btnBg:'#f3f4f6', btnText:'#374151' };
    }
    function toast(opt){
      var level = String(opt.level || 'info');
      var color = COLORS[level] || '#334155';
      var c = theme();
      var dur = (opt.duration != null) ? Number(opt.duration) : defDur;
      var sticky = !(dur > 0);
      var dismissible = (opt.dismissible != null) ? !!opt.dismissible : true;
      if (sticky) dismissible = true; // never trap the user with an unclosable toast
      var pos = opt.position || defPos;
      var host = container(pos);

      // Icon: explicit string = custom (emoji/text); false = hidden; else status SVG.
      var showIcon = opt.icon !== false;
      var iconHtml = '';
      if (showIcon) {
        iconHtml = (typeof opt.icon === 'string' && opt.icon) ? esc(opt.icon) : (ICONS[level] || ICONS.info);
      }

      // Title/body: explicit title wins (message becomes the body); otherwise the
      // first line of the message is the title and the rest is the body.
      var msg = String(opt.message || ''), title, body;
      if (opt.title != null && opt.title !== '') { title = String(opt.title); body = msg; }
      else { var parts = msg.split('\\n'); title = parts.shift() || ''; body = parts.join(' ').trim(); }

      var t = document.createElement('div');
      t.setAttribute('role', level === 'error' || level === 'warning' ? 'alert' : 'status');
      t.style.cssText = 'position:relative;overflow:hidden;pointer-events:auto;display:flex;gap:12px;align-items:flex-start;'+
        'width:24rem;max-width:calc(100vw - 2rem);background:'+c.bg+';border-radius:12px;padding:16px;'+
        'box-shadow:0 10px 25px rgba(0,0,0,.15),0 0 0 1px '+c.ring+';'+
        'opacity:0;transform:translateY(8px);transition:opacity .2s ease, transform .2s ease;';
      // Action buttons — inline-styled from a constrained set (color/variant/uppercase)
      // so they always render, even though runtime toasts can't use Tailwind classes.
      function btnStyle(a){
        var accent = a.color ? (COLORS[a.color] || a.color) : '';
        var variant = a.variant || 'soft';
        var base = 'font:600 13px '+FONT+';padding:6px 12px;border-radius:8px;border:0;cursor:pointer;'+
          (a.uppercase ? 'text-transform:uppercase;letter-spacing:.04em;font-size:12px;' : '');
        if (variant === 'solid') return base+'background:'+(accent||'#4f46e5')+';color:#fff;';
        if (variant === 'ghost') return base+'background:none;padding-left:2px;padding-right:2px;color:'+(accent||c.btnText)+';';
        return base+'background:'+c.btnBg+';color:'+(accent||c.btnText)+';';
      }
      var actions = Array.isArray(opt.actions) ? opt.actions : [];
      var btns = '';
      for (var i=0;i<actions.length;i++){
        var a = actions[i];
        if (!a || !a.label || !a.method) continue;
        btns += '<button type="button" data-flow-action="'+i+'" style="'+btnStyle(a)+'">'+esc(a.label)+'</button>';
      }
      t.innerHTML =
        (showIcon ? '<span style="flex-shrink:0;color:'+color+';line-height:0;font-size:20px">'+iconHtml+'</span>' : '')+
        '<div style="flex:1;min-width:0">'+
          '<p style="margin:0;font:600 14px '+FONT+';color:'+c.title+'">'+esc(title)+'</p>'+
          (body ? '<p style="margin:4px 0 0;font:400 13px '+FONT+';color:'+c.body+';line-height:1.5">'+esc(body)+'</p>' : '')+
          (btns ? '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">'+btns+'</div>' : '')+
        '</div>'+
        (dismissible ? '<button type="button" data-flow-close aria-label="Dismiss" style="flex-shrink:0;margin:-4px -4px 0 0;padding:4px;border:0;background:none;color:'+c.close+';cursor:pointer;line-height:0;border-radius:6px">'+X+'</button>' : '');

      // Countdown progress bar (only meaningful while auto-dismissing).
      if (opt.progressBar && !sticky) {
        var bar = document.createElement('div');
        bar.style.cssText = 'position:absolute;left:0;bottom:0;height:3px;width:100%;background:'+color+';opacity:.5;transition:width '+dur+'ms linear;';
        t.appendChild(bar);
        requestAnimationFrame(function(){ bar.style.width = '0%'; });
      }

      // Invoke a @expose method on the emitting component via the bridge (window event).
      function invoke(spec){
        if (!spec || !spec.method) return;
        window.dispatchEvent(new CustomEvent('flow:invoke', { detail: {
          component: opt.component, method: spec.method, args: spec.args || []
        }}));
      }

      host.appendChild(t);
      requestAnimationFrame(function(){ t.style.opacity='1'; t.style.transform='none'; });
      var done = false;
      function dismiss(){ if(done) return; done=true; invoke(opt.onClose);
        t.style.opacity='0'; t.style.transform='translateY(8px)';
        setTimeout(function(){ t.remove(); }, 200); }
      var closeBtn = t.querySelector('[data-flow-close]');
      if (closeBtn) closeBtn.addEventListener('click', dismiss);
      Array.prototype.forEach.call(t.querySelectorAll('[data-flow-action]'), function(btn){
        var idx = Number(btn.getAttribute('data-flow-action'));
        btn.addEventListener('click', function(){ invoke(actions[idx]); dismiss(); });
      });
      if (!sticky) setTimeout(dismiss, dur);
    }
    window.addEventListener('flow:flash', function(e){
      toast((e && e.detail) || {});
    });
  })();`;

  return jsx("div", {
    id: "flow-flash",
    "data-duration": duration,
    "data-position": position,
    style: {
      position: "fixed",
      zIndex: "50",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      pointerEvents: "none",
      ...pos,
    },
    children: jsx("script", { dangerouslySetInnerHTML: { __html: script } }),
  });
}

// ── <Errors> ──────────────────────────────────────────────────────────────────
/** Props for {@link Errors}: an optional `only` filter limiting which fields' errors show. */
export interface ErrorsProps {
  only?: string | string[];
  class?: string;
  [key: string]: unknown;
}

/**
 * A reactive validation-error summary — a `role="alert"` list that stays hidden until
 * the component has errors, then shows the current messages.
 *
 * @remarks
 * `only` limits the summary to one or more named fields (a string or array of field
 * names); omit it to show every error.
 *
 * @example
 * ```tsx
 * <Errors />
 * <Errors only={["email", "password"]} />
 * ```
 *
 * @category Forms & inputs
 */
export function Errors(props: ErrorsProps = {}): HtmlNode {
  const {
    only,
    class: cls,
    children: _ignore,
    ...rest
  } = props as ErrorsProps & { children?: unknown };
  const out: Record<string, unknown> = {
    ...rest,
    "flow:errors": true,
    role: "alert",
    class: cls ?? "text-sm text-red-400 space-y-1 list-disc pl-5",
    style: { display: "none" },
  };
  if (only) out["flow:errors.only"] = Array.isArray(only) ? only.join(",") : only;
  return jsx("ul", out);
}

// ── <ErrorMessage> ──────────────────────────────────────────────────────────────
/** Props for {@link ErrorMessage}: the target field via `for`. */
export interface ErrorProps {
  /** The field — `this.<field>` (compiled) or `this.errors.<field>` (runtime). */
  for?: unknown;
  class?: string;
  [key: string]: unknown;
}

/**
 * A single field's first validation message as a reactive, self-hiding `<span>`
 * (hidden when the field has no error). Point it at a field with `for`.
 *
 * @remarks
 * In a compiled page the Flow compiler rewrites this to a `<span flow:error flow:show>`;
 * `for={this.email}` (the bound property) resolves to that field's errors. The runtime
 * body here is the fallback and also accepts the `this.errors.<field>` accessor.
 *
 * @example
 * ```tsx
 * <ErrorMessage for={this.email} />
 * ```
 *
 * @category Forms & inputs
 */
export function ErrorMessage(props: ErrorProps): HtmlNode {
  const {
    for: forField,
    class: cls,
    children: _ignore,
    ...rest
  } = props as ErrorProps & { children?: unknown };

  // `error` consumes an ErrorField sentinel (carrying __field) → emits flow:error + flow:show.
  // When `for={this.email}` passes the raw bound VALUE, recover the field name from the
  // render's exposed-key capture / value match and wrap it in a sentinel so binding works.
  let target = forField;
  if (
    target !== undefined &&
    target !== null &&
    !(typeof target === "object" && (target as { __isErrorField?: boolean }).__isErrorField)
  ) {
    try {
      const field = _resolveBindName(target, "for", undefined, true);
      target = { __isErrorField: true, __field: field, __value: "" };
    } catch {
      // Couldn't resolve to a field — leave as-is (renders unbound rather than crashing).
    }
  }

  return jsx("span", {
    ...rest,
    error: target,
    class: cls ?? "text-red-400 text-xs",
  });
}

// ── <Dropdown> ────────────────────────────────────────────────────────────────
/** Props for {@link Dropdown}: the trigger (`label` or custom `trigger`), `align`, and styling. */
export interface DropdownProps {
  label?: unknown;
  trigger?: unknown;
  align?: "left" | "right";
  class?: string;
  panelClass?: string;
  children?: unknown;
  [key: string]: unknown;
}

/**
 * A click-to-open menu (Alpine-driven, client-only) with full keyboard support —
 * arrow keys, Home/End, Escape and click-outside — and correct menu ARIA roles.
 *
 * @remarks
 * Renders a default button labelled by `label` (or `"Menu"`), or your own `trigger`
 * node when provided. `align` (default `"left"`) sets which edge the panel opens from;
 * `children` are the menu items.
 *
 * @example
 * ```tsx
 * <Dropdown label="Account" align="right">
 *   <Link href="/profile">Profile</Link>
 *   <Link href="/logout">Sign out</Link>
 * </Dropdown>
 * ```
 *
 * @category Overlays
 */
export function Dropdown(props: DropdownProps): HtmlNode {
  const { label, trigger, align = "left", class: cls, panelClass, children, ...rest } = props;

  // Trigger carries the menu ARIA + keyboard entry (flowMenu runtime: Down/Up/Enter
  // open and focus the first/last item).
  const triggerCommon = {
    "x-on:click": "toggle()",
    "x-on:keydown": "onButtonKey($event)",
    "aria-haspopup": "menu",
    ":aria-expanded": "open",
  };
  const triggerNode = trigger
    ? jsx("span", {
        ...triggerCommon,
        role: "button",
        tabindex: 0,
        class: "inline-flex cursor-pointer",
        children: trigger,
      })
    : jsx("button", {
        ...triggerCommon,
        type: "button",
        class:
          "inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-gray-800 hover:bg-gray-700 text-gray-200",
        children: [
          label ?? "Menu",
          jsx("span", { "aria-hidden": "true", class: "text-xs", children: "▾" }),
        ],
      });

  // Panel is the menu: arrow/Home/End/Escape handled by the runtime; click-outside
  // closes without stealing focus back to the trigger.
  const panel = jsx("div", {
    role: "menu",
    "x-show": "open",
    "x-cloak": true,
    "x-transition": true,
    "x-on:keydown": "onKey($event)",
    "x-on:click.outside": "close(false)",
    "x-on:keydown.escape.window": "open && close(false)",
    class:
      "absolute mt-2 min-w-44 rounded-lg bg-gray-900 border border-gray-800 shadow-xl p-1 z-50 " +
      (align === "right" ? "right-0" : "left-0") +
      (panelClass ? " " + panelClass : ""),
    children,
  });

  return jsx("div", {
    ...rest,
    "x-data": "flowMenu()",
    class: "relative inline-block" + (cls ? " " + cls : ""),
    children: [triggerNode, panel],
  });
}

// ── <Tabs> ────────────────────────────────────────────────────────────────────
/** A single {@link Tabs} entry: its `label`, panel `content`, and optional stable `name`. */
export interface TabItem {
  label: unknown;
  content: unknown;
  name?: string;
}

/** Props for {@link Tabs}: the array of tab `items` to render. */
export interface TabsProps {
  items: TabItem[];
  class?: string;
  [key: string]: unknown;
}

/**
 * A tabbed panel set built from an `items` array, with a `role="tablist"`, roving
 * arrow-key navigation and correct tab/tabpanel ARIA wiring. Selection is client-only
 * (Alpine); the first item is active initially.
 *
 * @remarks
 * Each item supplies a `label`, its panel `content`, and an optional `name` used as the
 * stable id (defaults to the index).
 *
 * @example
 * ```tsx
 * <Tabs items={[
 *   { label: "Profile", content: <ProfileForm /> },
 *   { label: "Billing", content: <BillingForm /> },
 * ]} />
 * ```
 *
 * @category Overlays
 */
export function Tabs(props: TabsProps): HtmlNode {
  const { items, class: cls, ...rest } = props;
  const names = items.map((it, i) => it.name ?? String(i));
  const first = names[0] ?? "0";

  const bar = jsx("div", {
    role: "tablist",
    "x-on:keydown": "onKey($event)", // roving arrow-key navigation (flowTabs)
    class: "flex gap-1 border-b border-gray-800 mb-3",
    children: items.map((it, i) =>
      jsx("button", {
        type: "button",
        role: "tab",
        id: `flow-tab-${names[i]}`,
        "aria-controls": `flow-tabpanel-${names[i]}`,
        ":aria-selected": `tab === ${jsLiteral(names[i])}`,
        ":tabindex": `tab === ${jsLiteral(names[i])} ? 0 : -1`,
        "x-on:click": `tab = ${jsLiteral(names[i])}`,
        ":class": `tab === ${jsLiteral(names[i])} ? 'border-indigo-500 text-white' : 'border-transparent text-gray-400 hover:text-gray-200'`,
        class: "px-3 py-1.5 text-sm -mb-px border-b-2",
        children: it.label,
      }),
    ),
  });

  const panels = items.map((it, i) =>
    jsx("div", {
      role: "tabpanel",
      id: `flow-tabpanel-${names[i]}`,
      "aria-labelledby": `flow-tab-${names[i]}`,
      tabindex: 0,
      "x-show": `tab === ${jsLiteral(names[i])}`,
      "x-cloak": true,
      children: it.content,
    }),
  );

  return jsx("div", {
    ...rest,
    "x-data": `flowTabs({ tab: ${jsLiteral(first)} })`,
    class: cls ?? "",
    children: [bar, ...panels],
  });
}

// ── <InfiniteScroll> ──────────────────────────────────────────────────────────
/** Props for {@link InfiniteScroll}: the `onMore` action, an optional `show` guard, and slot content. */
export interface InfiniteScrollProps {
  /** Server action to run when the sentinel enters the viewport (method ref). */
  onMore: unknown;
  /**
   * Whether to render the sentinel at all. Pass a boolean expression — e.g.
   * `show={this.visible < this.all.length}` — to stop loading at the end without
   * an outer ternary. Re-evaluated on every render. Defaults to true.
   */
  show?: boolean;
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

/**
 * A viewport sentinel that runs a server action when it scrolls into view — the
 * building block for load-more / infinite lists.
 *
 * @remarks
 * `onMore` is the method to invoke when the sentinel intersects; pass `show={false}`
 * (typically a boolean expression like `this.visible < this.all.length`) to stop
 * loading at the end. `children` replace the default "Loading more…" text.
 *
 * @example
 * ```tsx
 * <InfiniteScroll onMore={this.loadMore} show={this.visible < this.total} />
 * ```
 *
 * @category Navigation & data
 */
export function InfiniteScroll(props: InfiniteScrollProps): HtmlNode {
  const { onMore, show, class: cls, children, ...rest } = props;
  if (show === false) return { html: "" }; // past the end — render nothing
  return jsx("div", {
    ...rest,
    onIntersect: onMore,
    class: cls ?? "py-4 text-center text-sm text-gray-500",
    children: children ?? "Loading more…",
  });
}

// ── <Skeleton> ────────────────────────────────────────────────────────────────
/** Props for {@link Skeleton}: bar `width`/`height`/`rounded`, or `lines` for a multi-line block. */
export interface SkeletonProps {
  /** Bar width (CSS length). Defaults to 100%. */
  width?: string;
  /** Bar height (CSS length). Defaults to 1rem (0.75rem in multi-line mode). */
  height?: string;
  /** Corner radius: `true` → pill, a string → that radius, omitted → 0.375rem. */
  rounded?: boolean | string;
  /** Render N stacked line bars (the last is shortened for realism). */
  lines?: number;
  class?: string;
  [key: string]: unknown;
}

/**
 * A pulsing placeholder block for content that hasn't loaded yet — pure markup plus
 * the bundled `.flow-skeleton` animation (no app CSS needed). Use it inside a lazy
 * child's `placeholder()` or a {@link Loading} region.
 *
 * @remarks
 * A single bar by default; pass `lines` for a stacked multi-line block (the last bar
 * is shortened for realism). `width`, `height` and `rounded` tune the shape.
 *
 * @example
 * ```tsx
 * <Skeleton height="1.5rem" width="60%" />
 * <Skeleton lines={3} />
 * <Skeleton height="10rem" rounded="0.75rem" />
 * ```
 *
 * @category Feedback
 */
export function Skeleton(props: SkeletonProps): HtmlNode {
  const { width, height, rounded, lines, class: cls, ...rest } = props;
  const radius = rounded === true ? "9999px" : typeof rounded === "string" ? rounded : "0.375rem";
  const bar = (w: string, h: string): HtmlNode =>
    jsx("div", {
      class: "flow-skeleton",
      style: `width:${w};height:${h};border-radius:${radius};`,
    });

  if (lines && lines > 1) {
    const h = height ?? "0.75rem";
    const bars = Array.from({ length: lines }, (_, i) =>
      bar(i === lines - 1 ? "60%" : (width ?? "100%"), h),
    );
    return jsx("div", {
      ...rest,
      class: cls ? `flow-skeleton-group ${cls}` : "flow-skeleton-group",
      style: "display:flex;flex-direction:column;gap:0.5rem;",
      children: bars,
    });
  }

  const single = bar(width ?? "100%", height ?? "1rem");
  if (!cls && Object.keys(rest).length === 0) return single;
  return jsx("div", { ...rest, ...(cls ? { class: cls } : {}), children: single });
}

// ── <For> reactive list ─────────────────────────────────────────────────────────
/** Props for {@link For}: the `each` array, an optional `keyBy` field, and the item template `children`. */
export interface ForProps<T> {
  /** The array to render — an `@expose`/`@locked` prop; its name drives the reactive `x-for`. */
  each: readonly T[];
  /** The item field used as Alpine's stable `:key` (e.g. `keyBy="id"`). */
  keyBy?: string;
  /** The item template: `(item, index) => <li>…</li>`. */
  children: (item: T, index: number) => HtmlNode;
}

/**
 * Reactive list. The AOT compiler turns `<For each={this.items} keyBy="id">{(item) => …}</For>`
 * into an Alpine `<template x-for>`, so `appendOptimistic`/`removeOptimistic` (and any client change
 * to the array) re-render it instantly while server patches stay authoritative. This runtime body is
 * a static fallback, used only when a page's render couldn't be ahead-of-time compiled.
 *
 * @example
 * ```tsx
 * <For each={this.items} keyBy="id">
 *   {(item) => <li>{item.name}</li>}
 * </For>
 * ```
 *
 * @category Navigation & data
 */
export function For<T>(props: ForProps<T>): HtmlNode {
  const items = props.each ?? [];
  let html = "";
  for (let i = 0; i < items.length; i++) {
    const node = props.children(items[i]!, i);
    html += node && typeof node === "object" && "html" in node ? (node as HtmlNode).html : "";
  }
  return { html };
}

// ── <Loading> ─────────────────────────────────────────────────────────────────
/** Props for {@link Loading}: `target`/`hide`/`delay` loading behaviour and optional `skeleton` placeholder. */
export interface LoadingProps {
  target?: string | string[];
  hide?: boolean;
  delay?: boolean;
  /** Show a `<Skeleton>` while loading (used when no children are given). */
  skeleton?: boolean | SkeletonProps;
  tag?: string;
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

/**
 * A region that is visible only while a matching server action is in flight — for
 * inline spinners, "Saving…" text or a skeleton placeholder.
 *
 * @remarks
 * `target` scopes it to one or more named actions; `hide` removes the region instead
 * of toggling it, and `delay` waits before showing (to avoid flicker on fast requests).
 * Pass `skeleton` to render a {@link Skeleton} when no children are given; `tag`
 * chooses the wrapper element (default `"span"`).
 *
 * @example
 * ```tsx
 * <Loading target="save">Saving…</Loading>
 * <Loading skeleton delay />
 * ```
 *
 * @category Feedback
 */
export function Loading(props: LoadingProps): HtmlNode {
  const { target, hide, delay, skeleton, tag, class: cls, children, ...rest } = props;
  const body =
    children ?? (skeleton ? Skeleton(typeof skeleton === "object" ? skeleton : {}) : undefined);
  const out: Record<string, unknown> = { ...rest, children: body };
  if (cls) out["class"] = cls;
  if (hide) out["flow:loading.remove"] = true;
  else if (delay) out["flow:loading.delay"] = true;
  else out["flow:loading"] = true;
  if (target) out["flow:target"] = Array.isArray(target) ? target.join(",") : target;
  // An explicit tag always wins. Otherwise a skeleton placeholder is block-level,
  // so it defaults to <div>; every other case defaults to the inline <span>.
  const element = tag ?? (skeleton && !children ? "div" : "span");
  return jsx(element, out);
}

// ── <Pager> ─────────────────────────────────────────────────────────────────
/** Props for {@link Pager}: the `paginator`, preserved `params`, and label/style overrides. */
/**
 * What `<Pager>` needs from a paginator. `Model.paginate()`'s result and the in-memory
 * {@link Paginator} both carry this shape, so either renders the same pager.
 */
export interface PagerLike {
  page: number;
  lastPage: number;
  onFirstPage: boolean;
  hasMorePages: boolean;
  elements(each?: number): (number | "...")[];
}

export interface PagerProps {
  paginator: PagerLike;
  /** Extra query params to keep in the page links (e.g. a search term). */
  params?: Record<string, string | number | null | undefined>;
  /** Prefetch each page on hover. */
  hover?: boolean;
  /** Labels for the prev/next controls. */
  prevLabel?: string;
  nextLabel?: string;
  class?: string;
  linkClass?: string;
  activeClass?: string;
  [key: string]: unknown;
}

/**
 * Renders a Prev / numbered / Next pager from a `Paginator` (the result of
 * `Model.paginate()` or the in-memory `paginate()` helper). Links are SPA `navigate` anchors to
 * `?page=N`, so they pair with `@url page` with no per-link wiring; renders nothing for
 * a single page.
 *
 * @remarks
 * Pass `params` to preserve other query state (search term, per-page, …). `hover`
 * prefetches each page; `prevLabel`/`nextLabel` and the class props override the
 * defaults. This is the links UI — the Flow equivalent of Livewire's
 * `$paginator->links()` view.
 *
 * @example
 * ```tsx
 * <Pager paginator={p} params={{ q: this.query, perPage: this.perPage }} hover />
 * ```
 *
 * @category Navigation & data
 */
export function Pager(props: PagerProps): HtmlNode {
  const {
    paginator: p,
    params,
    hover,
    prevLabel = "‹ Prev",
    nextLabel = "Next ›",
    class: cls,
    linkClass,
    activeClass,
    children: _ignore,
    ...rest
  } = props as PagerProps & { children?: unknown };
  if (!p || p.lastPage <= 1) return { html: "" };

  const href = (page: number) => {
    const sp = new URLSearchParams();
    sp.set("page", String(page));
    if (params)
      for (const [k, v] of Object.entries(params))
        if (v !== null && v !== undefined && v !== "") sp.set(k, String(v));
    return "?" + sp.toString();
  };

  const base = "px-3 py-1.5 rounded-lg text-sm transition " + (linkClass ?? "");
  const activeCls = activeClass ?? "bg-indigo-600 text-white font-semibold";
  const idleCls = "bg-gray-800 hover:bg-gray-700 text-gray-300";

  const link = (
    page: number,
    label: unknown,
    opts: { active?: boolean; disabled?: boolean } = {},
  ) =>
    opts.disabled
      ? jsx("span", {
          "aria-disabled": "true",
          class: base + "bg-gray-900 text-gray-700 cursor-not-allowed",
          children: label,
        })
      : jsx("a", {
          href: href(page),
          navigate: true,
          ...(hover ? { navigateHover: true } : {}),
          ...(opts.active ? { "aria-current": "page" } : {}),
          class: base + (opts.active ? activeCls : idleCls),
          children: label,
        });

  const numbers = p
    .elements()
    .map((el, i) =>
      el === "..."
        ? jsx("span", { key: `gap-${i}`, class: "px-2 text-gray-600", children: "…" })
        : link(el as number, String(el), { active: el === p.page }),
    );

  return jsx("nav", {
    ...rest,
    role: "navigation",
    "aria-label": "Pagination",
    class: "flex items-center justify-center gap-1 flex-wrap " + (cls ?? ""),
    children: [
      link(p.page - 1, prevLabel, { disabled: p.onFirstPage }),
      ...numbers,
      link(p.page + 1, nextLabel, { disabled: !p.hasMorePages }),
    ],
  });
}

// ── <FileUpload> ──────────────────────────────────────────────────────────────
/** Props for {@link FileUpload}: the `bind` target plus `multiple`, `accept` and `label`. */
export interface FileUploadProps {
  /** Bound @expose property — receives the TemporaryUploadedFile (or array). */
  bind: unknown;
  multiple?: boolean;
  accept?: string;
  label?: string;
  class?: string;
  /** Rendered below the dropzone — e.g. a preview/filename of the current value. */
  children?: unknown;
  [key: string]: unknown;
}

/**
 * A dropzone bound to an `@expose` property. Selecting a file POSTs it to
 * `/__flow/upload` over HTTP, shows live progress, and `$set`s a signed reference the
 * server resolves into a `TemporaryUploadedFile`. Pairs with the `FileUploads` mixin.
 *
 * @remarks
 * Bind `bind` to the receiving property; `multiple` uploads an array, `accept` filters
 * the file picker, and `children` render below the dropzone (e.g. a preview of the
 * current value).
 *
 * @example
 * ```tsx
 * <FileUpload bind={this.photo} accept="image/*" />
 * <FileUpload bind={this.docs} multiple />
 * ```
 *
 * @category Forms & inputs
 */
export function FileUpload(props: FileUploadProps): HtmlNode {
  const { bind, multiple, accept, label = "Choose a file…", class: cls, children, ...rest } = props;
  const name = _resolveReactiveName(bind);

  const inputAttrs: Record<string, unknown> = { type: "file", class: "sr-only" };
  if (name) inputAttrs["flow:model"] = name; // file inputs upload over HTTP, then $set the ref
  if (multiple) inputAttrs["multiple"] = true;
  if (accept) inputAttrs["accept"] = accept;

  const dropzone = jsx("label", {
    class:
      "flex flex-col items-center justify-center gap-1 cursor-pointer rounded-xl border-2 border-dashed " +
      "border-gray-700 hover:border-gray-600 p-6 text-center text-sm text-gray-400 transition-colors",
    children: [
      jsx("input", inputAttrs),
      jsx("span", { "x-show": "!uploading", children: label }),
      jsx("span", { "x-show": "uploading", "x-text": "'Uploading… ' + progress + '%'" }),
    ],
  });

  const bar = jsx("div", {
    "x-show": "uploading",
    "x-cloak": true,
    class: "mt-2 h-1.5 w-full rounded bg-gray-800 overflow-hidden",
    children: jsx("div", {
      class: "h-full bg-indigo-500 transition-all",
      ":style": "'width: ' + progress + '%'",
    }),
  });

  const err = jsx("p", {
    "x-show": "error",
    "x-cloak": true,
    "x-text": "error",
    class: "mt-2 text-xs text-red-400",
  });

  return jsx("div", {
    ...rest,
    "x-data": name
      ? `flowFileUpload({ name: ${jsLiteral(name)} })`
      : "{ uploading: false, progress: 0, error: '' }",
    class: "flow-fileupload " + (cls ?? ""),
    children: [dropzone, bar, err, children],
  });
}

// ── <Tooltip> ─────────────────────────────────────────────────────────────────
/** Props for {@link Tooltip}: the tip text (`content`/`text`) and its `placement`. */
export interface TooltipProps {
  content?: unknown;
  /** Alias for `content`. */
  text?: unknown;
  placement?: "top" | "bottom";
  class?: string;
  tooltipClass?: string;
  children?: unknown;
  [key: string]: unknown;
}

/**
 * Shows a small tip on hover/focus of its children, with `aria-describedby` wired to
 * the tooltip. Client-only (Alpine), positioned with CSS relative to the trigger.
 *
 * @remarks
 * Supply the tip via `content` (or its alias `text`); `placement` is `"top"` (default)
 * or `"bottom"`. The trigger is whatever you pass as `children`.
 *
 * @example
 * ```tsx
 * <Tooltip content="Copy to clipboard"><button>📋</button></Tooltip>
 * ```
 *
 * @category Overlays
 */
export function Tooltip(props: TooltipProps): HtmlNode {
  const { content, text, placement = "top", class: cls, tooltipClass, children, ...rest } = props;
  const tip = content ?? text;
  const pos = placement === "bottom" ? "top-full mt-1" : "bottom-full mb-1";
  return jsx("span", {
    ...rest,
    "x-data": "{ open: false }",
    "x-id": "['flow-tooltip']",
    "x-on:mouseenter": "open = true",
    "x-on:mouseleave": "open = false",
    "x-on:focusin": "open = true",
    "x-on:focusout": "open = false",
    class: "relative inline-block " + (cls ?? ""),
    children: [
      jsx("span", { ":aria-describedby": "$id('flow-tooltip')", tabindex: 0, children }),
      jsx("span", {
        role: "tooltip",
        ":id": "$id('flow-tooltip')",
        "x-show": "open",
        "x-cloak": true,
        "x-transition": true,
        class:
          "absolute left-1/2 -translate-x-1/2 z-50 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white shadow-lg " +
          pos +
          (tooltipClass ? " " + tooltipClass : ""),
        children: tip,
      }),
    ],
  });
}

// ── <Alert> ───────────────────────────────────────────────────────────────────
/** Props for {@link Alert}: the colour/role `variant`, `dismissible` flag and optional `title`. */
export interface AlertProps {
  variant?: "info" | "success" | "warning" | "error";
  dismissible?: boolean;
  title?: unknown;
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

const _ALERT_VARIANT: Record<string, string> = {
  info: "bg-blue-500/10 border-blue-500/40 text-blue-200",
  success: "bg-emerald-500/10 border-emerald-500/40 text-emerald-200",
  warning: "bg-amber-500/10 border-amber-500/40 text-amber-200",
  error: "bg-red-500/10 border-red-500/40 text-red-200",
};

/**
 * An inline, statically-styled alert box. `variant` (default `"info"`) sets the colour
 * and ARIA role — `error`/`warning` announce assertively as `role="alert"`, others as
 * `role="status"`.
 *
 * @remarks
 * `title` renders a bold heading above the body; `dismissible` adds a client-only ×
 * that hides the alert with no server round-trip.
 *
 * @example
 * ```tsx
 * <Alert variant="success" dismissible>Saved!</Alert>
 * ```
 *
 * @category Feedback
 */
export function Alert(props: AlertProps): HtmlNode {
  const { variant = "info", dismissible, title, class: cls, children, ...rest } = props;
  const role = variant === "error" || variant === "warning" ? "alert" : "status";
  const body: unknown[] = [];
  if (title !== undefined && title !== null) {
    body.push(jsx("div", { class: "font-semibold mb-0.5", children: title }));
  }
  body.push(jsx("div", { class: "min-w-0 flex-1", children }));
  if (dismissible) {
    body.push(
      jsx("button", {
        type: "button",
        "aria-label": "Dismiss",
        "x-on:click": "shown = false",
        class: "shrink-0 text-current/70 hover:text-current text-lg leading-none",
        children: "×",
      }),
    );
  }
  return jsx("div", {
    ...rest,
    role,
    "x-data": "{ shown: true }",
    "x-show": "shown",
    class:
      "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm " +
      (_ALERT_VARIANT[variant] ?? _ALERT_VARIANT["info"]) +
      (cls ? " " + cls : ""),
    children: body,
  });
}

// ── <Table> ───────────────────────────────────────────────────────────────────
/** A {@link Table} column definition: its `key`, `label`, `sortable` flag and optional cell `render`. */
export interface TableColumn<T = Record<string, unknown>> {
  key: string;
  label: unknown;
  sortable?: boolean;
  /** Custom cell renderer; defaults to `row[key]`. */
  render?: (row: T) => unknown;
  /** Extra classes for this column's cells. */
  class?: string;
}

/** Props for {@link Table}: the `columns` and `rows`, current `sortBy`/`sortDir`, and styling. */
export interface TableProps<T = Record<string, unknown>> {
  columns: TableColumn<T>[];
  rows: T[];
  sortBy?: string;
  sortDir?: "asc" | "desc";
  /** Extra query params to keep in sort links (e.g. a search term). */
  params?: Record<string, string | number | null | undefined>;
  /** Field used as the row key (defaults to the first column's key). */
  rowKey?: string;
  hover?: boolean;
  class?: string;
  theadClass?: string;
  [key: string]: unknown;
}

/**
 * A data table with URL-driven sortable headers. Clicking a sortable header navigates
 * to `?sortBy=key&sortDir=asc|desc` (toggling direction) — pair with `@url sortBy` /
 * `@url sortDir` and sort the rows server-side in `render()`.
 *
 * @remarks
 * Cells default to `row[col.key]`; give a column a `render` for custom content. `params`
 * preserves other query state (e.g. a search term), `hover` highlights rows, and `rowKey`
 * (default the first column's key) identifies rows for morph-stable reordering.
 *
 * @example
 * ```tsx
 * <Table
 *   columns={[{ key: "name", label: "Name", sortable: true }]}
 *   rows={p.data}
 *   sortBy={this.sortBy}
 *   sortDir={this.sortDir}
 * />
 * ```
 *
 * @category Navigation & data
 */
export function Table<T extends Record<string, unknown>>(props: TableProps<T>): HtmlNode {
  const {
    columns,
    rows,
    sortBy,
    sortDir,
    params,
    rowKey,
    hover,
    class: cls,
    theadClass,
    children: _ignore,
    ...rest
  } = props as TableProps<T> & { children?: unknown };
  const keyField = rowKey ?? columns[0]?.key ?? "id";

  const sortHref = (key: string) => {
    const nextDir = key === sortBy && sortDir === "asc" ? "desc" : "asc";
    const sp = new URLSearchParams();
    sp.set("sortBy", key);
    sp.set("sortDir", nextDir);
    if (params)
      for (const [k, v] of Object.entries(params))
        if (v !== null && v !== undefined && v !== "") sp.set(k, String(v));
    return "?" + sp.toString();
  };

  const headCells = columns.map((col) => {
    if (!col.sortable) {
      return jsx("th", {
        scope: "col",
        class: "px-3 py-2 text-left font-semibold text-gray-300",
        children: col.label,
      });
    }
    const active = col.key === sortBy;
    const indicator = active ? (sortDir === "asc" ? " ▲" : " ▼") : "";
    return jsx("th", {
      scope: "col",
      "aria-sort": active ? (sortDir === "asc" ? "ascending" : "descending") : "none",
      class: "px-3 py-2 text-left font-semibold text-gray-300",
      children: jsx("a", {
        href: sortHref(col.key),
        navigate: true,
        ...(hover ? { navigateHover: true } : {}),
        class: "inline-flex items-center gap-0.5 hover:text-white",
        children: [col.label, indicator],
      }),
    });
  });

  const bodyRows = rows.map((row) =>
    jsx("tr", {
      "flow:key": String(row[keyField] ?? ""), // morph keys rows by identity (sort/filter reorders)
      class: "border-t border-gray-800 " + (hover ? "hover:bg-gray-800/40" : ""),
      children: columns.map((col) =>
        jsx("td", {
          class: "px-3 py-2 text-gray-200 " + (col.class ?? ""),
          children: col.render ? col.render(row) : (row[col.key] as unknown),
        }),
      ),
    }),
  );

  return jsx("table", {
    ...rest,
    class: "w-full text-sm border-collapse " + (cls ?? ""),
    children: [
      jsx("thead", { class: theadClass ?? "", children: jsx("tr", { children: headCells }) }),
      jsx("tbody", { children: bodyRows }),
    ],
  });
}

// ── <Drawer> ──────────────────────────────────────────────────────────────────
/** Props for {@link Drawer}: the `show` binding, the `side` it slides from, and title/close options. */
export interface DrawerProps {
  show?: unknown;
  /** Explicit prop name override — use when auto-resolve is ambiguous. */
  name?: string;
  onClose?: unknown;
  title?: unknown;
  closable?: boolean;
  side?: "left" | "right" | "top" | "bottom";
  /** Extra classes for the panel. */
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

const _DRAWER_SIDE: Record<string, { pos: string; closed: string }> = {
  right: { pos: "inset-y-0 right-0 h-full w-80 max-w-full", closed: "translate-x-full" },
  left: { pos: "inset-y-0 left-0 h-full w-80 max-w-full", closed: "-translate-x-full" },
  top: { pos: "inset-x-0 top-0 w-full max-h-full", closed: "-translate-y-full" },
  bottom: { pos: "inset-x-0 bottom-0 w-full max-h-full", closed: "translate-y-full" },
};

/**
 * A slide-over panel — the edge-anchored sibling of {@link Modal}. Bind `show` to an
 * `@expose` boolean; backdrop click, the × button and Escape all close it locally with
 * no server round-trip, and focus is trapped while open.
 *
 * @remarks
 * Slides in from `side` (default `"right"`; also `"left"`, `"top"`, `"bottom"`). `title`
 * fills the header, `closable` (default `true`) renders the × button, and `onClose`
 * overrides the default close action. The prop name is auto-resolved; override with `name`.
 *
 * @example
 * ```tsx
 * <Drawer show={this.cart} side="right" title="Your cart">
 *   <CartItems />
 * </Drawer>
 * ```
 *
 * @category Overlays
 */
export function Drawer(props: DrawerProps): HtmlNode {
  const {
    show,
    name: nameProp,
    onClose,
    title,
    closable = true,
    side = "right",
    class: panelClass,
    children,
    ...rest
  } = props;
  const name = nameProp ?? _injectedBindKey(props, "show") ?? _resolveReactiveName(show);
  const open = Boolean(show);
  const s = _DRAWER_SIDE[side] ?? _DRAWER_SIDE["right"]!;
  const shownExpr = name ? `$flow.${name}` : open ? "true" : "false";
  const inAxis = side === "left" || side === "right" ? "translate-x-0" : "translate-y-0";

  const closeProps: Record<string, unknown> = onClose
    ? { onClick: onClose }
    : name
      ? { "flow:click": `$flow.${name} = false` }
      : {};

  const backdrop = jsx("div", {
    "x-show": shownExpr,
    "x-cloak": true,
    "x-transition:enter": "transition-opacity ease-out duration-300",
    "x-transition:enter-start": "opacity-0",
    "x-transition:enter-end": "opacity-100",
    "x-transition:leave": "transition-opacity ease-in duration-200",
    "x-transition:leave-start": "opacity-100",
    "x-transition:leave-end": "opacity-0",
    class: "fixed inset-0 z-40 bg-black/50",
    ...closeProps,
  });

  const titleId = name ? `flow-drawer-title-${name}` : undefined;
  const header =
    title || closable
      ? jsx("div", {
          class: "flex items-center justify-between gap-4 mb-3",
          children: [
            title
              ? jsx("h2", { id: titleId, class: "text-lg font-semibold", children: title })
              : "",
            closable
              ? jsx("button", {
                  type: "button",
                  "aria-label": "Close",
                  class: "text-gray-400 hover:text-white text-2xl leading-none",
                  children: "×",
                  ...closeProps,
                })
              : "",
          ],
        })
      : "";

  const panelOut: Record<string, unknown> = {
    role: "dialog",
    "aria-modal": "true",
    "x-show": shownExpr,
    "x-cloak": true,
    "x-transition:enter": "transform transition ease-out duration-300",
    "x-transition:enter-start": s.closed,
    "x-transition:enter-end": inAxis,
    "x-transition:leave": "transform transition ease-in duration-200",
    "x-transition:leave-start": inAxis,
    "x-transition:leave-end": s.closed,
    class:
      "fixed z-50 bg-gray-900 border border-gray-800 p-5 shadow-xl text-white overflow-auto " +
      s.pos +
      " " +
      (panelClass ?? ""),
    children: [header, children],
  };
  if (name) {
    panelOut["data-flow-modal"] = name; // Escape-to-close (shared bridge handler)
    panelOut["x-trap"] = shownExpr; // trap focus while open
    if (title) panelOut["aria-labelledby"] = titleId;
  }

  // `contents` wrapper creates no box, so the fixed backdrop/panel aren't blocked
  // and nothing intercepts clicks when closed (both are display:none via x-show).
  return jsx("div", { ...rest, class: "contents", children: [backdrop, jsx("div", panelOut)] });
}
