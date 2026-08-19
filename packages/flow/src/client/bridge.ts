// ── Flow WS bridge ───────────────────────────────────────────────────────────
//
// Responsibilities:
//   1. Scan the DOM for [data-flow-root] and initialise FlowComponent instances
//      (including nested child components, each an isolated island)
//   2. Open a WebSocket to /__flow/ws with exponential back-off reconnect
//   3. Event delegation for flow:click, flow:submit, flow:model, flow:confirm
//   4. Loading state (flow:loading family, with flow:target scoping + .delay)
//   5. Dirty state (flow:dirty family — local edits not yet confirmed by server)
//   6. Offline state (flow:offline family + body[data-flow-connection])
//   7. Per-component outbound frame queue (serialised — no race conditions)
//   8. Apply server patches via Alpine.morph (respecting flow:ignore /
//      flow:ignore.self / flow:replace, skipping nested component roots)
//   9. flow:cloak removal on init; flow:poll interval setup
//  10. Declarative bindings: flow:text, flow:show, flow:bind:class/href/attr
//  11. flow:intersect viewport actions; flow:sort drag-and-drop reordering
//  12. flow:stream progressive content frames (mid-action server pushes)
//  13. flow:navigate SPA navigation (+ .hover prefetch, flow:current links)
//  14. Update the $flow Alpine store after every patch
//  15. $errors Alpine magic for validation error bags
//  16. Cross-component events via CustomEvent + window dispatch
//  17. @url query string sync on every patch
//  18. Lazy loading (IntersectionObserver) and deferred loading (DOMContentLoaded)
//  19. File downloads via blob URL
//  20. flow:transition enter animations on morph
//  21. flow:teleport — render content at a different DOM location
//  22. Offline action queue — multiple actions per component queued offline

import type { Snapshot, SnapshotData, SnapshotMemo, ServerFrame } from "../types.ts";
import { FlowComponent } from "./FlowComponent.ts";
import { evaluateCsp } from "./cspEvaluator.ts";
import { buildUrlWithQuery, type CurrentUrlOptions } from "./url.ts";
import { confirmDialog, type ConfirmDialogOptions } from "./confirm.ts";
import { showErrorOverlay } from "./errorOverlay.ts";
import { applyAppend, applyRemove, type OptOp } from "./optimistic.ts";
import { clientStore } from "../store.ts";
// The `/Socket` subpath, not the package root: the root also exports
// `ClientProvider`, which reaches @zerotal/core's CLI modules — one of which
// does `await import("bun")`, a hard error in a browser bundle before
// tree-shaking can drop it.
import { Socket as BundledSocket } from "@zerotal/client/Socket";
import { route } from "@zerotal/core/routes";
import { URL_ATTRIBUTES, sanitizeUrl } from "../urlSafety.ts";
import {
  recordFrame as _recordTimelineFrame,
  isTimelineEnabled,
  setTimelineEnabled,
  setTimelineApplier,
} from "./timeline.ts";
import * as _timeline from "./timeline.ts";
import {
  framePanes as _framePanes,
  renderFramePanes as _renderFramePanes,
  type FrameServerCost as _ServerCost,
} from "./framePanes.ts";

// CSP-safe mode: set by the CSP client entry. When on, bridge-managed bindings
// use the eval-free evaluateCsp() instead of `new Function`.
let _bridgeCsp = false;
/** @internal Enable CSP-safe evaluation in the bridge (called by the CSP client entry). */
export function setCspMode(on: boolean): void {
  _bridgeCsp = on;
}

// Holds the $flow proxy builder (assigned in registerFlowMagic) so the CSP
// evaluator adapter can resolve `$flow` without going through Alpine's evaluator.
let _gelMagicBuilder: ((el: Element) => unknown) | null = null;
/** @internal Build the $flow proxy for an element (used by the CSP evaluator scope). */
export function _resolveGel(el: Element): unknown {
  return _gelMagicBuilder ? _gelMagicBuilder(el) : undefined;
}

type AlpineType = {
  reactive(o: object): Record<string, unknown>;
  morph(from: Element, to: string | Element, config?: object): void;
  store(name: string, init?: object): unknown;
  magic(name: string, fn: (el: Element) => unknown): void;
};

declare const Alpine: AlpineType;

const PULSE_CSS = `
[flow\\:cloak]                              { display: none !important; }
[x-cloak]                                  { display: none !important; }
[flow\\:loading]                            { display: none; }
/* Visual loading indicators wait out a short delay so a very fast action never flashes one.
   The delayed marker is set LOADING_DELAY_MS after the action starts (see _setLoading), and
   cleared the moment it resolves — so an action that finishes inside the window shows nothing. */
[data-flow-loading-delayed] [flow\\:loading]       { display: revert; }
[data-flow-loading-delayed] [flow\\:loading\\.remove] { display: none !important; }
[flow\\:loading\\.delay]                    { display: none; }
[data-flow-loading-delayed] [flow\\:loading\\.delay] { display: revert; }
[flow\\:loading][flow\\:target],
[flow\\:loading][flow\\:target\\.except]   { display: none; }
[flow\\:dirty]                              { display: none; }
[flow\\:offline]                            { display: none; }
body[data-flow-connection="offline"] [flow\\:offline]          { display: revert; }
body[data-flow-connection="offline"] [flow\\:offline\\.remove] { display: none !important; }
[data-flow-lazy-placeholder]                { min-height: 1px; }
[flow\\:transition]                         { transition: opacity var(--flow-transition-duration, 200ms) ease, transform var(--flow-transition-duration, 200ms) ease; }
[flow\\:transition].flow-entering          { opacity: 0; transform: translateY(4px); }
/* show= enter/leave presets for Alpine's x-transition. The compiler emits the transition prop on a
   show= element as x-transition:enter/leave="flow-t-PRESET" + enter-start/leave-end="flow-t-out". The
   preset class carries the transition timing; .flow-t-PRESET.flow-t-out is the hidden state. */
.flow-t-fade, .flow-t-scale, .flow-t-slide-up,
.flow-t-slide-down, .flow-t-slide-left, .flow-t-slide-right { transition: opacity var(--flow-transition-duration, 200ms) ease, transform var(--flow-transition-duration, 200ms) ease; }
.flow-t-fade.flow-t-out        { opacity: 0; }
.flow-t-scale.flow-t-out       { opacity: 0; transform: scale(0.95); }
.flow-t-slide-up.flow-t-out    { opacity: 0; transform: translateY(8px); }
.flow-t-slide-down.flow-t-out  { opacity: 0; transform: translateY(-8px); }
.flow-t-slide-left.flow-t-out  { opacity: 0; transform: translateX(8px); }
.flow-t-slide-right.flow-t-out { opacity: 0; transform: translateX(-8px); }
@media (prefers-reduced-motion: reduce) {
  .flow-t-fade, .flow-t-scale, .flow-t-slide-up,
  .flow-t-slide-down, .flow-t-slide-left, .flow-t-slide-right { transition: none; }
}
[flow\\:failed]                             { display: none; }
[data-flow-action-error] [flow\\:failed]   { display: revert; }
[data-flow-action-error] [flow\\:failed\\.remove] { display: none !important; }
.flow-skeleton { background: var(--flow-skeleton-color, rgba(0,0,0,0.08)); animation: flow-skeleton-pulse 1.5s ease-in-out infinite; }
@keyframes flow-skeleton-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) { .flow-skeleton { animation: none; } }
`;

function _escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function _injectFlowStyles(): void {
  if (document.getElementById("flow-styles")) return;
  const style = document.createElement("style");
  style.id = "flow-styles";
  style.textContent = PULSE_CSS;
  document.head.appendChild(style);
}

const _components = new Map<string, FlowComponent>();

// Bare→`$`-prefixed aliases for the small set of magics that are ALSO real Component
// methods (`this.refresh()` / `this.dispatch()` …). These names are already owned by the
// base class, so promoting the bare form to the `$`-magic is safe and can't shadow a
// developer's own member. Every OTHER client magic lives ONLY under its `$`-prefixed name
// on `$flow` (`$flow.$set`, `$flow.$store`, `$flow.$parent`, …), leaving the bare names
// (`set`, `toggle`, `store`, `parent`, …) free for the developer's own props/methods.
// Keep in sync with `CLIENT_CALLBACK_MAGICS` in compiler/transform.ts.
const _MAGIC_ALIASES = new Set(["refresh", "dispatch", "dispatchTo", "dispatchSelf"]);

// Reactive/modelable bindings (Tier 1). `_modelMaps`: childId → { childProp: parentProp }.
// `_modelBaselines`: childId → { prop: lastSeenJSON } — guards against echo loops so a
// parent-pushed value isn't propagated straight back to the parent (and vice-versa).
const _modelMaps = new Map<string, Record<string, string>>();
const _modelBaselines = new Map<string, Map<string, string>>();

function _modelBaselineFor(id: string): Map<string, string> {
  let b = _modelBaselines.get(id);
  if (!b) {
    b = new Map();
    _modelBaselines.set(id, b);
  }
  return b;
}

/**
 * Apply parent→child reactive bindings carried on a child root's stub during morph.
 * Reads `data-flow-model` (records the child→parent map) and `data-flow-props` (parent-
 * pushed @reactive values); for each changed value, updates the child locally and
 * round-trips a $set so the child re-renders. Baselines are recorded so the change
 * isn't echoed back to the parent by `_propagateModelable`.
 */
function _applyChildBindings(from: Element, to: Element): void {
  const childId = (from as HTMLElement).dataset["flowId"];
  if (!childId) return;
  const child = _components.get(childId);
  if (!child) return;

  const modelRaw = to.getAttribute("data-flow-model");
  if (modelRaw) {
    try {
      _modelMaps.set(childId, JSON.parse(modelRaw) as Record<string, string>);
    } catch {
      /* ignore */
    }
  }

  const propsRaw = to.getAttribute("data-flow-props");
  if (!propsRaw) return;
  let props: Record<string, unknown>;
  try {
    props = JSON.parse(propsRaw) as Record<string, unknown>;
  } catch {
    return;
  }

  const baseline = _modelBaselineFor(childId);
  for (const [k, v] of Object.entries(props)) {
    const nextJson = JSON.stringify(v);
    baseline.set(k, nextJson); // parent-originated → suppress echo
    if (JSON.stringify(child.reactive[k]) === nextJson) continue;
    child.reactive[k] = v; // reactive first (proxy), then raw target
    child.ephemeral[k] = v;
    _callAction(child, "$set", [k, v]); // re-render child with the new prop
  }
}

/**
 * After a child's patch lands, push any genuinely child-originated change to a
 * @modelable prop back up to the bound parent property (child→parent half of the
 * two-way binding). The baseline guard ensures parent-pushed values don't bounce back.
 */
function _propagateModelable(comp: FlowComponent): void {
  const map = _modelMaps.get(comp.id);
  if (!map) return;
  const parentEl = comp.rootEl.parentElement?.closest<HTMLElement>("[data-flow-root]");
  const parentId = parentEl?.dataset["flowId"];
  const parent = parentId ? _components.get(parentId) : undefined;
  if (!parent) return;

  const baseline = _modelBaselineFor(comp.id);
  for (const [childProp, parentProp] of Object.entries(map)) {
    const curJson = JSON.stringify(comp.reactive[childProp]);
    if (baseline.get(childProp) === curJson) continue; // unchanged or parent-originated
    baseline.set(childProp, curJson);
    const val = comp.reactive[childProp];
    parent.reactive[parentProp] = val; // reactive first, then raw target
    parent.ephemeral[parentProp] = val;
    _callAction(parent, "$set", [parentProp, val]);
  }
}

function findComponentByEl(el: Element): FlowComponent | null {
  // Teleported elements live outside [data-flow-root] — look for a saved owner id
  const teleportRoot = el.closest("[data-flow-teleported]") as HTMLElement | null;
  if (teleportRoot) {
    const ownerId = teleportRoot.dataset["flowOwner"];
    if (ownerId) return _components.get(ownerId) ?? null;
  }

  let root = el.closest("[data-flow-root]") as HTMLElement | null;
  while (root) {
    const id = root.dataset["flowId"];
    if (id) return _components.get(id) ?? null;
    root = (root.parentElement?.closest("[data-flow-root]") as HTMLElement | null) ?? null;
  }
  return null;
}

function _owns(comp: FlowComponent, el: Element): boolean {
  return el.closest("[data-flow-root]") === comp.rootEl;
}

// Dotted-path get/set for nested model binding (e.g. Form fields: "form.email").
function _getPath(obj: Record<string, unknown>, path: string): unknown {
  if (!path.includes(".")) return obj?.[path];
  return path
    .split(".")
    .reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}
function _setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  if (!path.includes(".")) {
    obj[path] = value;
    return;
  }
  const parts = path.split(".");
  let o = obj as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    if (o[k] == null || typeof o[k] !== "object") o[k] = {};
    o = o[k] as Record<string, unknown>;
  }
  o[parts[parts.length - 1]!] = value;
}

function _ownedEls(comp: FlowComponent, selector: string): Element[] {
  const els = Array.from(comp.rootEl.querySelectorAll(selector)).filter((el) => _owns(comp, el));
  if (comp.rootEl.matches(selector)) els.unshift(comp.rootEl);
  // Teleported subtrees live outside rootEl (moved to e.g. <body>) but still belong
  // to this component — include them so flow:show / flow:text / flow:bind keep working.
  document
    .querySelectorAll(`[data-flow-teleported][data-flow-owner="${comp.id}"]`)
    .forEach((root) => {
      if (root.matches(selector)) els.push(root);
      root.querySelectorAll(selector).forEach((e) => els.push(e));
    });
  return els;
}

const _loadingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const LOADING_DELAY_MS = 200;

// A `live` text input debounces its per-keystroke sync by default, so fast typing doesn't fire
// a WebSocket $set on every character. Discrete
// controls — checkbox, radio, select, range, date, colour — send immediately (a deliberate pick,
// not a stream of keystrokes). The default binding (no `live`) is deferred and never affected.
const MODEL_DEBOUNCE_MS = 150;
const _TEXTLIKE_INPUT = new Set([
  "text",
  "email",
  "password",
  "search",
  "url",
  "tel",
  "number",
  "textarea",
]);

/** Debounce for a `live` input's keystroke sync: text-like → MODEL_DEBOUNCE_MS, else immediate. */
function _modelDebounceMs(el: HTMLInputElement): number {
  return _TEXTLIKE_INPUT.has((el.type || "text").toLowerCase()) ? MODEL_DEBOUNCE_MS : 0;
}

function _targetsMatch(el: Element, action: string | null): boolean {
  const except = el.getAttribute("flow:target.except");
  if (
    except &&
    action &&
    except
      .split(",")
      .map((s) => s.trim())
      .includes(action)
  ) {
    return false;
  }
  const target = el.getAttribute("flow:target");
  if (target) {
    if (!action) return false;
    return target
      .split(",")
      .map((s) => s.trim())
      .includes(action);
  }
  return true;
}

/**
 * Attribute toggles (`loadingAttr="disabled"`) are applied IMMEDIATELY — a disabled submit
 * button must guard against a double-click even for a sub-100ms action.
 */
function _applyLoadingAttr(comp: FlowComponent, loading: boolean, action: string | null): void {
  _ownedEls(comp, "[flow\\:loading\\.attr]").forEach((el) => {
    const attr = el.getAttribute("flow:loading.attr");
    if (!attr) return;
    const active = loading && _targetsMatch(el, action);
    if (active) el.setAttribute(attr, "");
    else el.removeAttribute(attr);
  });
}

/**
 * Visual indicators (targeted show/hide, `loadingClass`) — the flashy ones. Applied only after
 * the delay on the way in, and cleared immediately on the way out, so a fast action shows none.
 */
function _applyLoadingVisuals(comp: FlowComponent, loading: boolean, action: string | null): void {
  _ownedEls(
    comp,
    "[flow\\:loading][flow\\:target], [flow\\:loading][flow\\:target\\.except]",
  ).forEach((el) => {
    const show = loading && _targetsMatch(el, action);
    (el as HTMLElement).style.display = show ? el.getAttribute("flow:loading") || "revert" : "";
  });
  _ownedEls(
    comp,
    "[flow\\:loading\\.remove][flow\\:target], [flow\\:loading\\.remove][flow\\:target\\.except]",
  ).forEach((el) => {
    const hide = loading && _targetsMatch(el, action);
    (el as HTMLElement).style.display = hide ? "none" : "";
  });

  _ownedEls(comp, "[flow\\:loading\\.class]").forEach((el) => {
    const cls = el.getAttribute("flow:loading.class");
    if (!cls) return;
    const active = loading && _targetsMatch(el, action);
    cls
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => el.classList.toggle(c, active));
  });

  _ownedEls(comp, "[flow\\:loading\\.class\\.remove]").forEach((el) => {
    const cls = el.getAttribute("flow:loading.class.remove");
    if (!cls) return;
    const active = loading && _targetsMatch(el, action);
    cls
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => el.classList.toggle(c, !active));
  });
}

function _setLoading(comp: FlowComponent, loading: boolean, action: string | null = null): void {
  if (loading) {
    comp.rootEl.setAttribute("data-flow-loading", "");
    // Disable now (guards double-submit); reveal spinners/classes only if the action
    // outlasts the delay — a quick action never flashes a loading indicator.
    _applyLoadingAttr(comp, true, action);
    clearTimeout(_loadingTimers.get(comp.id));
    _loadingTimers.set(
      comp.id,
      setTimeout(() => {
        comp.rootEl.setAttribute("data-flow-loading-delayed", "");
        _applyLoadingVisuals(comp, true, action);
      }, LOADING_DELAY_MS),
    );
  } else {
    comp.rootEl.removeAttribute("data-flow-loading");
    comp.rootEl.removeAttribute("data-flow-loading-delayed");
    clearTimeout(_loadingTimers.get(comp.id));
    _loadingTimers.delete(comp.id);
    _applyLoadingAttr(comp, false, action);
    _applyLoadingVisuals(comp, false, action); // clears anything the timer had already applied
  }
}

function _dirtyKeys(comp: FlowComponent): Set<string> {
  const keys = new Set<string>();
  for (const [key, val] of Object.entries(comp.ephemeral)) {
    if (JSON.stringify(comp.canonical[key]) !== JSON.stringify(val)) keys.add(key);
  }
  return keys;
}

function _dirtyMatch(el: Element, dirty: Set<string>): boolean {
  const target = el.getAttribute("flow:target");
  if (target) return target.split(",").some((k) => dirty.has(k.trim()));
  return dirty.size > 0;
}

function _updateDirty(comp: FlowComponent): void {
  const dirty = _dirtyKeys(comp);

  _ownedEls(comp, "[flow\\:dirty]").forEach((el) => {
    const show = _dirtyMatch(el, dirty);
    (el as HTMLElement).style.display = show ? el.getAttribute("flow:dirty") || "revert" : "";
  });
  _ownedEls(comp, "[flow\\:dirty\\.remove]").forEach((el) => {
    (el as HTMLElement).style.display = _dirtyMatch(el, dirty) ? "none" : "";
  });
  _ownedEls(comp, "[flow\\:dirty\\.class]").forEach((el) => {
    const cls = el.getAttribute("flow:dirty.class");
    if (!cls) return;
    const active = _dirtyMatch(el, dirty);
    cls
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => el.classList.toggle(c, active));
  });
  _ownedEls(comp, "[flow\\:dirty\\.class\\.remove]").forEach((el) => {
    const cls = el.getAttribute("flow:dirty.class.remove");
    if (!cls) return;
    const active = _dirtyMatch(el, dirty);
    cls
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => el.classList.toggle(c, !active));
  });
  _ownedEls(comp, "[flow\\:dirty\\.attr]").forEach((el) => {
    const attr = el.getAttribute("flow:dirty.attr");
    if (!attr) return;
    if (_dirtyMatch(el, dirty)) el.setAttribute(attr, "");
    else el.removeAttribute(attr);
  });
}

let _isOnline = true;

function _setConnectionState(online: boolean): void {
  // The attribute mirrors the *current* state, so it is stamped even when that
  // state hasn't changed. The bridge starts optimistic (`_isOnline = true`), so
  // a page whose socket connects on the first attempt — the normal case — would
  // otherwise never carry the attribute at all, and a stylesheet or a readiness
  // check keyed on `[data-flow-connection="online"]` would wait forever for a
  // page that is in fact perfectly connected.
  document.body.setAttribute("data-flow-connection", online ? "online" : "offline");

  if (_isOnline === online) return;
  _isOnline = online;
  document.dispatchEvent(new CustomEvent(online ? "flow:online" : "flow:offline"));

  const offline = !online;
  document.querySelectorAll("[flow\\:offline\\.class]").forEach((el) => {
    const cls = el.getAttribute("flow:offline.class");
    if (cls)
      cls
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => el.classList.toggle(c, offline));
  });
  document.querySelectorAll("[flow\\:offline\\.class\\.remove]").forEach((el) => {
    const cls = el.getAttribute("flow:offline.class.remove");
    if (cls)
      cls
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => el.classList.toggle(c, !offline));
  });
  document.querySelectorAll("[flow\\:offline\\.attr]").forEach((el) => {
    const attr = el.getAttribute("flow:offline.attr");
    if (!attr) return;
    if (offline) el.setAttribute(attr, "");
    else el.removeAttribute(attr);
  });
}

let _ws: WebSocket | null = null;
let _reconnectDelay = 1_000;
const MAX_DELAY = 30_000;

// ── HTTP fallback (circuit breaker) ─────────────────────────────────────────────
// Strict corporate proxies/firewalls often block WebSocket upgrades entirely. After a few failed
// handshakes we fall back to sending action frames over plain HTTP POST (/__flow/http), which runs
// the identical server pipeline and returns the frames to apply. WS reconnection keeps running in
// the background, so if the socket becomes available again we upgrade back automatically.
let _httpMode = false;
let _wsFailures = 0;
const HTTP_FALLBACK_AFTER = 3; // consecutive failed WS handshakes before switching to HTTP

/**
 * The origin guard refused this page, and no retry will change that.
 *
 * Reported once, in full, because the alternative is the worst failure this app has: the
 * HTML renders, the console shows a generic "action failed", and the only symptom is that
 * nothing a user clicks does anything. The connection state drops to offline too — the app
 * genuinely cannot act, so actions queue behind `flow:offline` directives instead of being
 * fired at an endpoint that will refuse every one of them.
 */
let _originRefused = false;
function _reportOriginRefused(body: string): void {
  if (_originRefused) return;
  _originRefused = true;
  console.error(
    `[Flow] Actions refused: the server rejected this page's origin (${location.origin}).\n` +
      `Behind a reverse proxy the app's own origin is the loopback address it bound to, so ` +
      `the public origin has to be configured for it to accept browser-initiated actions.\n` +
      `Fix: set \`url\` in config/app.ts to ${location.origin} — AppConfig fills ` +
      `app.allowedOrigins from it.` +
      (body ? `\nServer said: ${body}` : ""),
  );
  _setConnectionState(false);
}

function _enableHttpMode(): void {
  if (_httpMode) return;
  _httpMode = true;
  console.warn(
    "[Flow] WebSocket unavailable — falling back to HTTP requests. If actions also fail, " +
      "check that the proxy forwards /__flow/* over HTTP/1.1 and does not gate it behind auth.",
  );
  _setConnectionState(true); // HTTP works, so we're "online" for offline directives
  // The socket that dropped may never come back, so this is the reconnect for anything it
  // left mid-action — resync over HTTP before replaying, same order as the WS path.
  _resyncStaleComponents();
  // Drain anything queued while we were deciding, now over HTTP.
  const replay = [..._offlineQueues.values()].flat();
  _offlineQueues.clear();
  for (const a of replay) _sendCall(a.comp, a.method, a.args, a.updates);
}

/** POST an action frame to the HTTP fallback endpoint and apply the returned frames. */
function _httpSend(frame: unknown, compId: string): void {
  fetch("/__flow/http", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(frame),
  })
    .then(async (r) => {
      if (r.ok) return r.json();
      // The status is the diagnosis, and the body carries the server's own words for it.
      // Both are dropped by a bare `HTTP 403`, which is what made this failure so quiet.
      const body = await r.text().catch(() => "");
      const err = new Error(`HTTP ${r.status}${body ? `: ${body}` : ""}`) as Error & {
        status?: number;
        body?: string;
      };
      err.status = r.status;
      err.body = body;
      throw err;
    })
    .then((frames: unknown) => {
      if (Array.isArray(frames)) for (const f of frames) void _handleServerFrame(f as ServerFrame);
    })
    .catch((e: Error & { status?: number; body?: string }) => {
      if (e.status === 403) _reportOriginRefused(e.body ?? "");
      else console.error("[Flow] HTTP action failed:", e);
      _resolveAck(compId); // never wedge the per-component queue
    });
}

const _queues = new Map<string, Promise<void>>();

// Offline queue: multiple actions per component (FIFO, sent on reconnect)
type OfflineAction = {
  comp: FlowComponent;
  method: string;
  args: unknown[];
  updates: Record<string, unknown>;
};
const _offlineQueues = new Map<string, OfflineAction[]>();

const _intervals = new Map<string, ReturnType<typeof setInterval>[]>();
const _observers = new Map<string, IntersectionObserver[]>();
const _lazyObservers = new Map<string, IntersectionObserver>();

function _pendingUpdates(comp: FlowComponent): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(comp.ephemeral)) {
    if (JSON.stringify(comp.canonical[key]) !== JSON.stringify(val)) {
      updates[key] = val;
    }
  }
  return updates;
}

// Serialize round-trips per component: only ONE action is in flight for a component at a
// time. Snapshot deltas are order-dependent — the server diffs the new state against the
// snapshot the client SENT, so the client must apply the returned delta to that same base.
// Pipelining (sending the next action before the previous patch lands) would apply a delta
// to an already-updated snapshot and corrupt it, failing the HMAC on the next action. Each
// queued send therefore resolves only when its patch/terminal frame is applied (or a timeout
// fires), which gates the next send until comp.snapshot reflects the previous patch.
const _pendingAcks = new Map<string, () => void>();
const ACK_TIMEOUT_MS = 15_000;

/**
 * Components whose last action was released without its patch ever being applied — the
 * socket closed, or the ack timed out, while the action was in flight.
 *
 * The client cannot tell whether such an action ran. The server is stateless per frame, so
 * a completed action's database write is committed while the client still holds the
 * pre-action snapshot: the in-memory half is silently reverted, nothing is shown, and the
 * next action then builds on state that does not match the server's. Rather than guess,
 * these components are re-synchronised from the server on reconnect — the server's current
 * state is the truth whether the action ran or not. See {@link _resyncStaleComponents}.
 */
const _staleComponents = new Set<string>();

function _resolveAck(compId: string): void {
  const resolve = _pendingAcks.get(compId);
  if (resolve) {
    _pendingAcks.delete(compId);
    resolve();
  }
}

/**
 * Release an ack whose patch never arrived, and remember that the component's state is now
 * of unknown accuracy.
 *
 * @param compId - The component whose in-flight action was abandoned.
 */
function _abandonAck(compId: string): void {
  if (!_pendingAcks.has(compId)) return;
  _staleComponents.add(compId);
  _resolveAck(compId);
}

/**
 * Ask the server to re-derive the state of every component left mid-action by a dropped
 * connection or a timed-out ack.
 *
 * `$refresh` re-runs `onMount()` server-side and sends back a patch built from that, so a
 * component whose state comes from the database converges on what was actually committed —
 * including the effects of an action whose acknowledgement was lost. A `flow:desync` event
 * is dispatched first so an app can say something about it rather than having the UI change
 * under the user with no explanation.
 */
function _resyncStaleComponents(refresh: (id: string) => boolean = _refreshMounted): string[] {
  if (_staleComponents.size === 0) return [];
  const ids = [..._staleComponents];
  // Cleared before refreshing, not after: `$refresh` goes through the send queue and can
  // itself be abandoned, which must re-mark the component rather than be wiped by this
  // drain finishing.
  _staleComponents.clear();

  const resynced = ids.filter((id) => refresh(id));

  if (resynced.length > 0 && typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("flow:desync", { detail: { components: resynced } }));
  }
  return resynced;
}

/** Send `$refresh` to a mounted component. Returns false when it is no longer on the page. */
function _refreshMounted(id: string): boolean {
  const comp = _components.get(id);
  if (!comp) return false;
  _callAction(comp, "$refresh", []);
  return true;
}

/**
 * @internal Exported for tests: the bridge's stale-component bookkeeping runs in a browser,
 * but the state machine — mark on abandon, drain exactly once, re-mark if the resync itself
 * is abandoned — is what carries the risk and is testable on its own.
 */
export const _resyncInternals = {
  markStale: (id: string): void => {
    _staleComponents.add(id);
  },
  isStale: (id: string): boolean => _staleComponents.has(id),
  size: (): number => _staleComponents.size,
  clear: (): void => _staleComponents.clear(),
  drain: (refresh: (id: string) => boolean): string[] => _resyncStaleComponents(refresh),
};

/**
 * Enqueue a call on the component's serial queue. The returned queue promise resolves when
 * the action's patch (or a terminal error frame) is applied — not merely when it is sent —
 * so the next action for this component waits for an up-to-date snapshot base. `fixedUpdates`
 * is supplied for offline replay (captured at queue time); otherwise updates are read at send.
 */
function _sendCall(
  comp: FlowComponent,
  method: string,
  args: unknown[],
  fixedUpdates?: Record<string, unknown>,
): void {
  const compId = comp.id;
  const prev = _queues.get(compId) ?? Promise.resolve();
  _queues.set(
    compId,
    prev
      .then(
        () =>
          new Promise<void>((resolve) => {
            const updates = fixedUpdates ?? _pendingUpdates(comp);
            const frame = {
              type: "call",
              component: compId,
              method,
              args,
              updates,
              snapshot: comp.snapshot,
            };
            // Here is where the client writes riding along with this call are
            // finally resolved, so it is the only place the panel can learn them.
            const pending = _pendingActionByComp.get(compId);
            if (pending && pending.method === method) pending.updates = updates;
            // Safety net: never wedge the queue if a patch is dropped (server crash / HTTP error).
            const armSafetyNet = (): void => {
              setTimeout(() => {
                // A timed-out ack carries exactly the same ambiguity as a dropped socket:
                // the action may well have run. Mark the component for resync rather than
                // carrying on from a snapshot that may no longer match the server.
                if (_pendingAcks.get(compId) === resolve) _abandonAck(compId);
              }, ACK_TIMEOUT_MS);
            };

            if (_ws && _ws.readyState === WebSocket.OPEN) {
              _ws.send(JSON.stringify(frame));
              _pendingAcks.set(compId, resolve);
              armSafetyNet();
            } else if (_httpMode && _isOnline) {
              // HTTP fallback: the returned frames resolve the ack (a patch → _resolveAck).
              _pendingAcks.set(compId, resolve);
              _httpSend(frame, compId);
              armSafetyNet();
            } else {
              const q = _offlineQueues.get(compId) ?? [];
              q.push({ comp, method, args, updates: fixedUpdates ?? _pendingUpdates(comp) });
              _offlineQueues.set(compId, q);
              resolve();
            }
          }),
      )
      .catch((e) => {
        console.error(e);
        _resolveAck(compId);
      }),
  );
}

function _dispatchFrame(comp: FlowComponent, method: string, args: unknown[]): void {
  // Fast offline path when the socket is down AND we're not in HTTP fallback; otherwise _sendCall
  // routes over the socket or HTTP as appropriate (and queues offline itself if truly offline).
  if (!_httpMode && (!_isOnline || !_ws || _ws.readyState !== WebSocket.OPEN)) {
    const q = _offlineQueues.get(comp.id) ?? [];
    q.push({ comp, method, args, updates: _pendingUpdates(comp) });
    _offlineQueues.set(comp.id, q);
    return;
  }
  _sendCall(comp, method, args);
}

function _connect(): void {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  _ws = new WebSocket(`${proto}//${location.host}/__flow/ws`);

  _ws.onopen = () => {
    _reconnectDelay = 1_000;
    _wsFailures = 0;
    if (_httpMode) {
      _httpMode = false; // socket is back — upgrade out of HTTP fallback
      console.info("[Flow] WebSocket restored — leaving HTTP fallback.");
    }
    _setConnectionState(true);

    // Replay all queued offline actions in order — through the serial queue, so a
    // component's actions still go out one-at-a-time (deltas stay aligned to their base).
    // Resync before replaying: a component left mid-action needs the server's current
    // state as its base, or the replayed actions build on a snapshot that may already be
    // out of date. Both go through the per-component serial queue, so the order holds.
    _resyncStaleComponents();

    const replay = [..._offlineQueues.values()].flat();
    _offlineQueues.clear();
    for (const action of replay) {
      _sendCall(action.comp, action.method, action.args, action.updates);
    }
  };

  _ws.onmessage = (e: MessageEvent) => {
    let frame: ServerFrame & { type: string; scripts?: string[] };
    try {
      frame = JSON.parse(e.data as string) as typeof frame;
    } catch {
      return;
    }
    void _handleServerFrame(frame);
  };

  _ws.onclose = () => {
    _ws = null;

    // Release any in-flight ack waiters and reset the per-component queues so a fresh
    // action chain starts cleanly on reconnect. Each released ack belonged to an action
    // that may have completed server-side, so its component is flagged for resync rather
    // than left silently holding pre-action state.
    for (const id of [..._pendingAcks.keys()]) _abandonAck(id);
    for (const [id] of _queues) _queues.set(id, Promise.resolve());

    _components.forEach((c) => _setLoading(c, false));

    // Trip the circuit breaker after a few failed handshakes — switch to HTTP so the app keeps
    // working where WebSockets are blocked. WS reconnection continues in the background.
    _wsFailures++;
    if (!_httpMode && _wsFailures >= HTTP_FALLBACK_AFTER) _enableHttpMode();
    if (!_httpMode) _setConnectionState(false);

    setTimeout(() => {
      _reconnectDelay = Math.min(_reconnectDelay * 2, MAX_DELAY);
      _connect();
    }, _reconnectDelay);
  };
}

type AlpineWithEval = AlpineType & {
  evaluate(el: Element, expression: string): unknown;
};

function _executeClientScripts(comp: FlowComponent, scripts: string[]): void {
  const A = Alpine as unknown as AlpineWithEval;
  for (const script of scripts) {
    try {
      A.evaluate(comp.rootEl, script);
    } catch (e) {
      console.error("[Flow] client() script error:", e, "\nScript:", script);
    }
  }
}

// ── Per-component error store ─────────────────────────────────────────────────

const _errors = new Map<string, Record<string, string[]>>();

// ── $flow.$watch subscriptions ───────────────────────────────────────────────

type WatchFn = (newVal: unknown, oldVal: unknown) => void;
const _watchers = new Map<string, Map<string, Set<WatchFn>>>();

function _runWatchers(comp: FlowComponent, oldValues: Record<string, unknown>): void {
  const compMap = _watchers.get(comp.id);
  if (!compMap) return;
  for (const [prop, fns] of compMap) {
    const next = comp.reactive[prop];
    if (JSON.stringify(oldValues[prop]) !== JSON.stringify(next)) {
      for (const fn of fns) {
        try {
          fn(next, oldValues[prop]);
        } catch (e) {
          console.error("[Flow] $watch error:", e);
        }
      }
    }
  }
}

function _setErrors(comp: FlowComponent, errors: Record<string, string[]> | undefined): void {
  if (errors && Object.keys(errors).length > 0) {
    _errors.set(comp.id, errors);
  } else {
    _errors.delete(comp.id);
  }
}

function _getErrors(compId: string): Record<string, string[]> {
  return _errors.get(compId) ?? {};
}

// ── @url sync ─────────────────────────────────────────────────────────────────

/**
 * After a patch, update the browser URL query string for @url-decorated props.
 * The metadata lives in snapshot.data[key][1].url.
 */
function _syncUrlParams(comp: FlowComponent): void {
  const data = comp.snapshot.data;
  let pushed = false;
  const params = new URLSearchParams(location.search);

  for (const [key, [, meta]] of Object.entries(data)) {
    const urlMeta = meta["url"] as { as: string; history: "push" | "replace" } | undefined;
    if (!urlMeta) continue;

    const paramName = urlMeta.as ?? key;
    const val = comp.reactive[key];

    if (val === null || val === undefined || val === "") {
      params.delete(paramName);
    } else {
      params.set(paramName, String(val));
    }

    if (urlMeta.history === "push" && !pushed) pushed = true;
  }

  const newSearch = params.toString();
  const newUrl = `${location.pathname}${newSearch ? "?" + newSearch : ""}${location.hash}`;

  if (newUrl !== location.pathname + location.search + location.hash) {
    if (pushed) {
      // Bank the scroll offset first: this entry is about to become a Back
      // target, and the viewport has not moved, so where the user is now is
      // where Back should return them.
      _rememberScroll();
      _pushHistoryEntry(newUrl);
    } else {
      history.replaceState(history.state, "", newUrl);
    }
  }
}

// ── flow:transition ──────────────────────────────────────────────────────────

/** Trigger the enter transition for elements with flow:transition. */
function _triggerEnterTransition(el: Element): void {
  if (!(el instanceof HTMLElement)) return;
  el.classList.add("flow-entering");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.classList.remove("flow-entering");
    });
  });
}

// ── flow:teleport ────────────────────────────────────────────────────────────

/**
 * Process `flow:teleport` elements: move them to their target location in the
 * DOM. The attribute value is a CSS selector for the target parent.
 *
 * @example
 * <div flow:teleport="#modal-root">...</div>
 */
function _processTeleports(): void {
  document.querySelectorAll("[flow\\:teleport]").forEach((el) => {
    const target = el.getAttribute("flow:teleport");
    if (!target) return;
    const dest = document.querySelector(target);
    if (!dest || el.parentElement === dest) return;

    // Save the owning component id so findComponentByEl works after the move
    const owner = findComponentByEl(el);
    if (owner) (el as HTMLElement).dataset["flowOwner"] = owner.id;

    // Dedupe: a parent re-render morphs a FRESH copy of this element back into the
    // root; remove the previously-teleported copy (matched by id) before moving the
    // new one, so the destination never accumulates duplicates. Give teleported
    // elements a stable `id` for this to work across re-renders.
    const id = (el as HTMLElement).id;
    if (id) {
      const prev = dest.querySelector(`#${CSS.escape(id)}[data-flow-teleported]`);
      if (prev && prev !== el) prev.remove();
    }

    // Move the element to the target, keeping original position marker
    const marker = document.createComment(`flow:teleport ${id || "unknown"}`);
    el.replaceWith(marker);
    dest.appendChild(el);
    // Mark as teleported so we don't re-process
    (el as HTMLElement).dataset["flowTeleported"] = "1";
  });
}

// ── Cross-component events ────────────────────────────────────────────────────

/**
 * Emit a cross-component event: broadcast it on window (so Alpine
 * `x-on:event-name.window` works) AND trigger any server `@on` listeners on
 * matching components. Used by both server-dispatched event frames and the
 * client-side $dispatch / $dispatchTo / $dispatchSelf magics, so a client
 * dispatch reaches server listeners exactly like a server dispatch does.
 *
 *   opts.toName → deliver only to components whose class name matches
 *   opts.selfId → deliver only to the component with this id
 */
function _emitEvent(
  name: string,
  data: Record<string, unknown>,
  opts: { toName?: string | undefined; selfId?: string | undefined } = {},
): void {
  window.dispatchEvent(new CustomEvent(`flow:${name}`, { detail: data, bubbles: true }));

  for (const [, comp] of _components) {
    if (opts.selfId && comp.id !== opts.selfId) continue;
    if (opts.toName && comp.snapshot.memo.name !== opts.toName) continue;
    const method = comp.snapshot.memo.listeners?.[name];
    if (method) _callAction(comp, method, [data]);
  }
}

/** Server-dispatched event frame → emit, honouring optional to/self targeting. */
function _handleEventFrame(
  name: string,
  data: Record<string, unknown>,
  to?: string,
  selfId?: string,
): void {
  _emitEvent(name, data, { toName: to, selfId });
}

// ── File downloads ────────────────────────────────────────────────────────────

function _handleDownloadFrame(filename: string, content: string, mime: string): void {
  try {
    const binary = atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    console.error("[Flow] download error:", e);
  }
}

// ── Flash notifications ───────────────────────────────────────────────────────

function _dispatchFlash(detail: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent("flow:flash", { detail }));
}

// ── Server frame handler ──────────────────────────────────────────────────────

// One-shot guard for the auto-reload that recovers from an expired/unknown component
// (see the "error" frame handling). Persisted across the reload via sessionStorage so the
// reload itself can't re-arm it, and cleared once normal patches resume — so each broken
// episode triggers at most one reload, while a later, genuine restart can recover again.
const _EXPIRY_RELOAD_KEY = "flow:reloaded-for-expired-component";

/**
 * Why an error frame should be recovered by a reload, if it should.
 *
 * Pure and exported so the policy is testable without a DOM — the handler that
 * calls it needs `window`, `sessionStorage` and a live component map.
 *
 * `reload` is set by the server when the snapshot no longer belongs to the
 * session that is asking, which is what signing out in another tab looks like
 * from here. The page's state belongs to who you *were*, so no patch can
 * succeed and reloading is the only honest recovery — the fresh request meets
 * auth middleware and lands wherever a signed-out visitor belongs.
 *
 * Both cases share the one-shot guard: a reload that does not fix the problem
 * must not reload again.
 */
export function _reloadReasonFor(
  frame: { message?: string; reload?: boolean },
  alreadyReloaded: boolean,
): "session-changed" | "unknown-component" | null {
  if (alreadyReloaded) return null;
  // The server's explicit instruction outranks any inference from the message.
  if (frame.reload) return "session-changed";
  if (frame.message === "Unknown component") return "unknown-component";
  return null;
}

function _reloadedForExpiry(): boolean {
  try {
    return sessionStorage.getItem(_EXPIRY_RELOAD_KEY) === "1";
  } catch {
    return false;
  }
}

function _markReloadedForExpiry(): void {
  try {
    sessionStorage.setItem(_EXPIRY_RELOAD_KEY, "1");
  } catch {
    // sessionStorage unavailable (private mode, etc.) — proceed without the guard.
  }
}

function _clearExpiryReloadGuard(): void {
  try {
    sessionStorage.removeItem(_EXPIRY_RELOAD_KEY);
  } catch {
    // ignore
  }
}

/**
 * Morph a component's DOM to fresh HTML (the shared body of a patch apply and a time-travel
 * jump), then re-scan/refresh so restored islands and directives are interactive again.
 */
function _morphComponent(comp: FlowComponent, html: string): void {
  try {
    Alpine.morph(comp.rootEl, html, {
      key: (el: Element) =>
        (el as HTMLElement).dataset?.["flowId"] ??
        el.getAttribute("flow:id") ??
        el.getAttribute("flow:key") ??
        (el as HTMLElement).id ??
        null,

      removing: (el: Node, skip: () => void) => {
        if (el instanceof Element && el.tagName === "SCRIPT" && el.id.startsWith("flow-state-")) {
          skip();
        }
      },

      updating: (from: Node, to: Node, childrenOnly: () => void, skip: () => void) => {
        if (!(from instanceof Element)) return;

        if (from.hasAttribute("flow:ignore")) {
          skip();
          return;
        }
        if (from.hasAttribute("flow:ignore.self")) {
          childrenOnly();
          return;
        }

        if (from.hasAttribute("flow:replace") && to instanceof Element) {
          from.innerHTML = to.innerHTML;
          skip();
          return;
        }

        if (
          from.hasAttribute("data-flow-root") &&
          (from as HTMLElement).dataset["flowId"] !== comp.id
        ) {
          // Deliver parent→child reactive/modelable bindings before preserving the island.
          if (to instanceof Element) _applyChildBindings(from, to);
          skip();
        }
      },

      added: (el: Node) => {
        if (el instanceof Element && el.hasAttribute("flow:transition")) {
          _triggerEnterTransition(el);
        }
      },
    });
  } catch (e) {
    console.error("[Flow] morph error:", e);
  }

  _scanComponents();
  _cleanupDisconnected();
  _refreshComponentFeatures(comp);
}

// ── Time-travel devtools (dev-only) ────────────────────────────────────────────
// Enabled when the server's `ready` frame reports `dev: true`. Recording lives in the patch
// handler and _scanComponents; this wires the DOM side — applying a jumped-to frame, a console
// API (window.__flow.timeline), and a minimal scrubbing panel.

/** Restore a recorded frame's snapshot + HTML into the live component (client-only). */
function _applyTimelineFrame(frame: _timeline.TimelineFrame): void {
  const comp = _components.get(frame.compId);
  if (!comp) return;
  comp.mergeServerPatch(frame.snapshot); // reactive state + <script id="flow-state-*"> ← this frame
  _syncFlowStore(comp);
  if (frame.html) _morphComponent(comp, frame.html);
  _syncModelInputs(comp);
  _syncDeclarative(comp);
}

function _enableTimeline(): void {
  setTimelineEnabled(true);
  setTimelineApplier(_applyTimelineFrame);
  // Seed the initial (mount) frame for every component already scanned before the WS was ready.
  for (const [id, comp] of _components) {
    _recordTimelineFrame({
      compId: id,
      compName: comp.name,
      action: "mount",
      snapshot: comp.snapshot,
      html: comp.rootEl.outerHTML,
    });
  }
  const w = window as unknown as {
    __flow?: Record<string, unknown>;
    __zerotalDevtools?: _DevtoolsRegistryLike;
  };
  w.__flow = {
    ...(w.__flow ?? {}),
    timeline: {
      frames: () => _timeline.getFrames(),
      framesFor: (id: string) => _timeline.getFramesFor(id),
      jump: (seq: number) => _timeline.jumpTo(seq),
      live: (id: string) => _timeline.resumeLive(id),
      current: (id: string) => _timeline.currentSeq(id),
    },
  };

  // Prefer the unified Zerotal devtools panel: register a "Timeline" tab there. Only fall back to
  // the standalone pill when @zerotal/devtools isn't present on the page.
  const dt = w.__zerotalDevtools;
  if (dt && typeof dt.register === "function") {
    dt.register({
      id: "flow-timeline",
      title: "Flow",
      badge: () => _timeline.getFrames().length || undefined,
      render: (el: HTMLElement, context?: { trace?: _TraceLike | null }) =>
        _renderTimelineInto(el, context?.trace ?? null),
    });
    _timeline.onTimelineChange(() => dt.refresh("flow-timeline"));
  } else {
    _setupTimelinePanel();
  }
}

/** Minimal shape of the devtools extension registry (window.__zerotalDevtools) we depend on. */
interface _DevtoolsRegistryLike {
  register(panel: {
    id: string;
    title: string;
    badge?: () => number | string | undefined;
    render: (el: HTMLElement) => void;
  }): unknown;
  refresh(id?: string): void;
}

/**
 * The half of a devtools trace this panel reads.
 *
 * Structural rather than imported: Flow depends on no observer package, and an
 * app without devtools installed simply never passes one. Every field is optional
 * for the same reason — this is a shape read from another package's data.
 */
interface _TraceLike {
  statusCode?: number;
  durationMs?: number;
  channels?: Record<string, Array<Record<string, unknown>>>;
  queries?: Array<{ sql?: unknown; durationMs?: unknown; rowCount?: unknown }>;
  logs?: Array<{ level?: unknown; args?: unknown }>;
  exception?: { message?: unknown } | null;
}

/**
 * Server cost per frame, accumulated as traces arrive.
 *
 * A trace carries one action, and the panel follows the newest — so each render
 * can bind at most the frame that just happened. Keeping what earlier renders
 * bound is what lets a frame from four clicks ago still show what it cost, rather
 * than only ever the selected one being annotated.
 */
const _frameCost = new Map<number, _ServerCost>();

/** Attach the selected trace's action to the frame it produced, once. */
function _bindServerCost(
  trace: _TraceLike | null,
  frames: readonly _timeline.TimelineFrame[],
): void {
  for (const entry of trace?.channels?.["flow"] ?? []) {
    const component = entry["component"];
    const action = entry["action"];
    const durationMs = entry["durationMs"];
    if (typeof component !== "string" || typeof action !== "string") continue;
    if (typeof durationMs !== "number") continue;

    // The newest matching frame that has no cost yet: an action produces its
    // frame before the trace reaches the panel, and re-rendering the same trace
    // must not walk the binding back through older frames of the same name.
    for (let i = frames.length - 1; i >= 0; i--) {
      const frame = frames[i]!;
      if (frame.compId !== component || frame.action !== action) continue;
      if (_frameCost.has(frame.seq)) break;
      const ip = entry["ip"];
      _frameCost.set(frame.seq, {
        durationMs,
        ip: typeof ip === "string" ? ip : null,
        statusCode: typeof trace?.statusCode === "number" ? trace.statusCode : null,
        // One action is one trace, so the whole trace is this action's server half.
        queries: (trace?.queries ?? []).map((q) => ({
          sql: String(q.sql ?? ""),
          durationMs: typeof q.durationMs === "number" ? q.durationMs : null,
          rowCount: typeof q.rowCount === "number" ? q.rowCount : null,
        })),
        logs: (trace?.logs ?? []).map((l) => ({
          level: String(l.level ?? "log"),
          text: Array.isArray(l.args) ? l.args.map((a) => String(a)).join(" ") : "",
        })),
        error:
          trace?.exception && typeof trace.exception.message === "string"
            ? trace.exception.message
            : null,
      });
      break;
    }
  }
}

/** Which frames are expanded. Module state so a redraw does not collapse them. */
const _expanded = new Set<number>();

/** The trace of the last draw, so toggling a row can redraw without waiting for one. */
let _lastTrace: _TraceLike | null = null;

/** Which pane of a frame the reader last picked. See `activePane`. */
let _framePref = "";

/** Render the timeline into the Zerotal devtools content area (themed with its CSS vars/classes). */
function _renderTimelineInto(el: HTMLElement, trace: _TraceLike | null = null): void {
  const frames = _timeline.getFrames();
  _lastTrace = trace;
  _bindServerCost(trace, frames);
  const compIds = [...new Set(frames.map((f) => f.compId))];
  const curSeqs = new Set(compIds.map((id) => _timeline.currentSeq(id)));
  const rewound = compIds.some((id) => !_timeline.isLive(id));

  const header =
    `<div class="sec" style="display:flex;align-items:center;gap:8px">` +
    `<div class="stitle" style="margin:0;flex:1">Time-travel · ${frames.length} frame${frames.length === 1 ? "" : "s"}</div>` +
    (rewound ? `<button class="ibtn live-on" data-tl-live="1">⏵ Resume live</button>` : "") +
    `</div>`;

  const rows = frames.length
    ? frames
        .slice()
        .reverse()
        .map((f) => {
          const cur = curSeqs.has(f.seq);
          const changed = f.changed.length ? f.changed.join(", ") : "—";
          const time = new Date(f.ts).toLocaleTimeString();
          // A frame with no cost ran entirely in the browser — a client expression
          // never reached the server, and saying nothing is the honest rendering.
          const cost = _frameCost.get(f.seq);
          const server = cost
            ? `<span class="dim" style="font-size:10px">server ${cost.durationMs}ms${cost.queries.length ? ` · ${cost.queries.length}q` : ""}</span>`
            : "";
          const open = _expanded.has(f.seq);
          const detail = open
            ? `<div class="hdetail" style="margin-left:26px">` +
              _renderFramePanes(_framePanes(f, frames, _frameCost.get(f.seq) ?? null), _framePref) +
              `</div>`
            : "";
          return (
            `<div class="qrow" data-tl-seq="${f.seq}" style="cursor:pointer;display:flex;gap:8px;align-items:baseline${cur ? ";background:var(--card)" : ""}">` +
            // Its own hit area: the row time-travels, and expanding to read what
            // happened must not also rewind the page you are reading it from.
            `<span data-tl-exp="${f.seq}" title="${open ? "Collapse" : "What this action did"}" style="min-width:12px;cursor:pointer;user-select:none">${open ? "▾" : "▸"}</span>` +
            `<span class="dim" style="min-width:30px">#${f.seq}</span>` +
            `<span style="color:var(--purple);font-weight:700">${_escapeHtml(f.action)}</span>` +
            `<span class="dim" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escapeHtml(f.compName)} · ${_escapeHtml(changed)}</span>` +
            server +
            `<span class="dim" style="font-size:10px">${time}</span>` +
            `</div>` +
            detail
          );
        })
        .join("")
    : '<p class="empty">No frames yet — interact with a component.</p>';

  el.innerHTML = header + `<div>${rows}</div>`;
  // A single delegated handler (assignment replaces any prior one — no stacking across renders).
  el.onclick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-tl-live]")) {
      for (const id of new Set(_timeline.getFrames().map((f) => f.compId)))
        _timeline.resumeLive(id);
      return;
    }
    // A pane of the frame being read. First, since the strip sits inside the
    // detail the row opened and a click there must not also rewind the page.
    const pane = target.closest<HTMLElement>("[data-fsec]");
    if (pane?.dataset["fsec"]) {
      _framePref = pane.dataset["fsec"];
      _renderTimelineInto(el, _lastTrace);
      return;
    }

    // Checked before the row, since the toggle sits inside it.
    const toggle = target.closest<HTMLElement>("[data-tl-exp]");
    if (toggle?.dataset["tlExp"]) {
      const seq = Number(toggle.dataset["tlExp"]);
      if (_expanded.has(seq)) _expanded.delete(seq);
      else _expanded.add(seq);
      _renderTimelineInto(el, _lastTrace);
      return;
    }
    const row = target.closest<HTMLElement>("[data-tl-seq]");
    if (row?.dataset["tlSeq"]) _timeline.jumpTo(Number(row.dataset["tlSeq"]));
  };
}

/** The four corners the timeline pill can dock to. */
const _TL_CORNERS = ["bottom-left", "bottom-right", "top-left", "top-right"] as const;
type _TlCorner = (typeof _TL_CORNERS)[number];

/**
 * Which corner the fallback pill docks to. `data-flow-tl-corner` on <html> or <body>
 * overrides; the default is bottom-left, where it stays clear of an app's own left-rail
 * navigation (a top-docked panel at max z-index sat exactly on a sidebar's first item).
 */
function _timelineCorner(): _TlCorner {
  const raw =
    document.documentElement.dataset["flowTlCorner"] ?? document.body.dataset["flowTlCorner"];
  return (_TL_CORNERS as readonly string[]).includes(raw ?? "")
    ? (raw as _TlCorner)
    : "bottom-left";
}

// A compact, dev-only scrubbing panel docked bottom-left by default (see _timelineCorner).
// The console API above is the primary interface; this is a convenience over it.
function _setupTimelinePanel(): void {
  if (document.getElementById("flow-tl-panel")) return;
  const style = document.createElement("style");
  style.textContent = `
    #flow-tl-panel{position:fixed;z-index:2147483647;display:flex;flex-direction:column;gap:6px;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#e5e7eb}
    #flow-tl-panel[data-corner="bottom-left"]{left:10px;bottom:10px;flex-direction:column-reverse}
    #flow-tl-panel[data-corner="bottom-right"]{right:10px;bottom:10px;flex-direction:column-reverse;align-items:flex-end}
    #flow-tl-panel[data-corner="top-left"]{left:10px;top:10px}
    #flow-tl-panel[data-corner="top-right"]{right:10px;top:10px;align-items:flex-end}
    #flow-tl-panel *{box-sizing:border-box}
    .flow-tl-toggle{background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:9999px;padding:5px 10px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.3);align-self:inherit}
    .flow-tl-body{width:320px;max-height:50vh;display:flex;flex-direction:column;background:#0b1220;border:1px solid #374151;border-radius:10px;overflow:hidden;box-shadow:0 8px 28px rgba(0,0,0,.45)}
    .flow-tl-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #1f2937;font-weight:600}
    .flow-tl-head .sp{flex:1}
    .flow-tl-live{background:#059669;color:#fff;border:0;border-radius:6px;padding:3px 8px;cursor:pointer}
    .flow-tl-list{list-style:none;margin:0;padding:4px;overflow-y:auto}
    .flow-tl-row{display:flex;gap:8px;align-items:baseline;padding:5px 7px;border-radius:6px;cursor:pointer}
    .flow-tl-row:hover{background:#111a2e}
    .flow-tl-row.cur{background:#1d4ed8;color:#fff}
    .flow-tl-seq{color:#64748b;min-width:26px}
    .flow-tl-act{font-weight:600;color:#93c5fd}
    .flow-tl-row.cur .flow-tl-act{color:#fff}
    .flow-tl-meta{flex:1;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .flow-tl-row.cur .flow-tl-meta{color:#dbeafe}
  `;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "flow-tl-panel";
  root.dataset["corner"] = _timelineCorner();
  root.innerHTML =
    `<button class="flow-tl-toggle" type="button">⏱ <b class="flow-tl-count">0</b></button>` +
    `<div class="flow-tl-body" hidden>` +
    `<div class="flow-tl-head"><span>Flow timeline</span><span class="sp"></span>` +
    `<button class="flow-tl-live" type="button" hidden>⏵ Live</button></div>` +
    `<ol class="flow-tl-list"></ol></div>`;
  document.body.appendChild(root);

  const toggle = root.querySelector<HTMLButtonElement>(".flow-tl-toggle")!;
  const body = root.querySelector<HTMLDivElement>(".flow-tl-body")!;
  const list = root.querySelector<HTMLOListElement>(".flow-tl-list")!;
  const liveBtn = root.querySelector<HTMLButtonElement>(".flow-tl-live")!;

  toggle.addEventListener("click", () => {
    body.hidden = !body.hidden;
    if (!body.hidden) _renderTimelinePanel();
  });
  list.addEventListener("click", (e) => {
    const row = (e.target as Element).closest<HTMLElement>(".flow-tl-row");
    if (row?.dataset["seq"]) _timeline.jumpTo(Number(row.dataset["seq"]));
  });
  liveBtn.addEventListener("click", () => {
    // Resume the most-recently-rewound component (or all).
    for (const id of new Set(_timeline.getFrames().map((f) => f.compId))) _timeline.resumeLive(id);
  });

  _timeline.onTimelineChange(() => _renderTimelinePanel());
  _renderTimelinePanel();
}

function _renderTimelinePanel(): void {
  const root = document.getElementById("flow-tl-panel");
  if (!root) return;
  const frames = _timeline.getFrames();
  root.querySelector(".flow-tl-count")!.textContent = String(frames.length);

  const body = root.querySelector<HTMLDivElement>(".flow-tl-body")!;
  if (body.hidden) return; // don't rebuild the (hidden) list on every frame

  // Rewound if any component's current seq isn't its latest.
  const rewound = [...new Set(frames.map((f) => f.compId))].some((id) => !_timeline.isLive(id));
  root.querySelector<HTMLButtonElement>(".flow-tl-live")!.hidden = !rewound;

  const list = root.querySelector<HTMLOListElement>(".flow-tl-list")!;
  const curSeqs = new Set(
    [...new Set(frames.map((f) => f.compId))].map((id) => _timeline.currentSeq(id)),
  );
  list.innerHTML = frames
    .slice()
    .reverse()
    .map((f) => {
      const cur = curSeqs.has(f.seq) ? " cur" : "";
      const t = new Date(f.ts).toLocaleTimeString();
      const changed = f.changed.length ? f.changed.join(", ") : "—";
      return (
        `<li class="flow-tl-row${cur}" data-seq="${f.seq}">` +
        `<span class="flow-tl-seq">#${f.seq}</span>` +
        `<span class="flow-tl-act">${_escapeHtml(f.action)}</span>` +
        `<span class="flow-tl-meta">${_escapeHtml(f.compName)} · ${_escapeHtml(changed)} · ${t}</span>` +
        `</li>`
      );
    })
    .join("");
}

/**
 * Rebuild a full snapshot from the component's prior snapshot and a patch delta
 * (mirror of the server's `applySnapshotDelta`). The prior `data` is exactly the base
 * the server diffed against, so the reconstruction is byte-equal to what the server
 * signed — the carried `checksum` verifies on the next action. Kept inline (not imported
 * from dehydrate.ts) so the client bundle stays free of server-side crypto deps.
 */
function _reconstructSnapshot(
  prev: Snapshot,
  frame: {
    memo?: SnapshotMemo;
    checksum?: string;
    dataDelta?: SnapshotData;
    dataRemoved?: string[];
  },
): Snapshot {
  const data: SnapshotData = { ...prev.data };
  for (const k of frame.dataRemoved ?? []) delete data[k];
  Object.assign(data, frame.dataDelta ?? {});
  return {
    data,
    memo: frame.memo ?? prev.memo,
    checksum: frame.checksum ?? prev.checksum,
  };
}

// ── Dev fast refresh ──────────────────────────────────────────────────────────
// On a dev server restart the flow WS reconnects and the server re-sends `ready`
// with `dev: true`. Rather than a full reload (which loses state), re-render every
// mounted component from its held, still-valid snapshot with the newly-compiled code,
// and refetch the stylesheet so new classes apply. If an edit is incompatible with the
// held snapshot (a render throw / integrity error), fall back to a one-shot full reload.

let _connectedBefore = false;
let _softRefreshUntil = 0;

/** Re-render every mounted component from its snapshot (new code, state preserved). */
function _softRefresh(): void {
  _softRefreshUntil = Date.now() + 5_000; // window in which an error frame → fallback reload
  for (const [, comp] of _components) {
    _dispatchFrame(comp, "$rerender", []); // no loading spinner; serialised like any action
  }
  // Refetch stylesheets so a newly-used Tailwind class (rebuilt on the server restart)
  // applies without a full reload.
  document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach((link) => {
    try {
      const url = new URL(link.getAttribute("href") ?? link.href, location.href);
      url.searchParams.set("flow-refresh", Date.now().toString(36));
      link.setAttribute("href", url.href);
    } catch {
      /* leave a malformed href alone */
    }
  });
}

async function _handleServerFrame(
  frame: ServerFrame & {
    type: string;
    html?: string;
    scripts?: string[];
    errors?: Record<string, string[]>;
    title?: string;
    memo?: SnapshotMemo;
    checksum?: string;
    dataDelta?: SnapshotData;
    dataRemoved?: string[];
    actionError?: boolean;
    dev?: boolean;
    reload?: boolean;
  },
): Promise<void> {
  if (frame.type === "ready") {
    // The server sends `dev: true` from the dev worker — enable time-travel recording (once).
    if (frame.dev === true && !isTimelineEnabled()) _enableTimeline();
    // First `ready` is the initial page load (already fresh); a later one is a reconnect
    // after a dev restart → soft refresh.
    if (!_connectedBefore) _connectedBefore = true;
    else if (frame.dev === true) _softRefresh();
    return;
  }

  if (frame.type === "patch") {
    const { component, scripts, errors, title } = frame;
    const html = frame.html;
    const comp = _components.get(component);
    if (!comp) return;

    // Optimistic failed state: the reconciliation below already reverts a rejected write;
    // this drives the visible `showOnError` region. Cleared on the next successful patch
    // (and when a new action is dispatched, see _callAction).
    _setActionError(comp, frame.actionError === true);

    // Snapshot travels as a delta by default (only changed fields); rebuild the full
    // snapshot from the component's prior copy. A full `snapshot` is honoured if present.
    const snapshot: Snapshot = frame.snapshot ?? _reconstructSnapshot(comp.snapshot, frame);

    // A patch landed on a live component — normal operation has resumed, so re-arm the
    // expiry auto-reload for any future server restart.
    _clearExpiryReloadGuard();

    // A mid-@task streaming patch (partial) applies the DOM/snapshot but keeps the triggering
    // action's loading state on — only the final patch clears it (below, at the ack release).
    if (!frame.partial) _setLoading(comp, false);

    // Snapshot old watcher values before the patch so we can diff them
    const oldWatchValues: Record<string, unknown> = {};
    const compWatchers = _watchers.get(comp.id);
    if (compWatchers) {
      for (const prop of compWatchers.keys()) oldWatchValues[prop] = comp.reactive[prop];
    }

    // Update title if server sent one
    if (title) document.title = title;

    // Update validation errors
    _setErrors(comp, errors);

    comp.mergeServerPatch(snapshot);
    // Optimistic collections: if this patch resolves the owning action's ack (checked before the
    // ack is released below), the action is done — drop pending ops and adopt the authoritative
    // server state (reconcile on success, roll back on failure). Otherwise it's an interim
    // (broadcast/event) patch — re-apply the pending optimistic ops so they survive it.
    if (_optOps.has(component)) {
      if (!frame.partial && _pendingAcks.has(component)) _optOps.delete(component);
      else _reapplyOptOps(comp);
    }
    _syncFlowStore(comp);
    _runWatchers(comp, oldWatchValues);
    _syncModelInputs(comp);
    _updateDirty(comp);
    _propagateModelable(comp); // child→parent half of a @modelable binding

    if (html) _morphComponent(comp, html);

    _syncDeclarative(comp);
    _syncUrlParams(comp);
    _processTeleports();

    // Move focus to the first invalid focusOnError field (no-op if none / user is mid-edit).
    if (!frame.partial) _focusFirstError(comp);

    if (scripts && scripts.length > 0) {
      _executeClientScripts(comp, scripts);
    }

    // Time-travel: record this applied patch as a timeline frame (final patches only — mid-@task
    // partials would flood the timeline). No-op unless recording is enabled (dev).
    if (!frame.partial && isTimelineEnabled()) {
      const dispatched = _takeLastDispatch(component);
      _recordTimelineFrame({
        compId: component,
        compName: comp.name,
        action: dispatched.action,
        snapshot: comp.snapshot,
        html: comp.rootEl.outerHTML,
        ...(dispatched.sent
          ? {
              sent: {
                args: dispatched.sent.args,
                ...(dispatched.sent.updates ? { updates: dispatched.sent.updates } : {}),
              },
            }
          : {}),
      });
    }

    // Patch applied and comp.snapshot updated — release the queue so the next action for this
    // component sends against the fresh base. A partial (mid-@task) patch keeps the queue held
    // and loading on: only the final patch releases the ack, so the task stays "in flight".
    if (!frame.partial) _resolveAck(component);
    return;
  }

  if (frame.type === "stream") {
    const sel = `[flow\\:stream="${frame.ref.replace(/"/g, '\\"')}"]`;
    document.querySelectorAll(sel).forEach((el) => {
      const replace = frame.replace || el.hasAttribute("flow:stream.replace");
      // Text by default. The canonical use of flow:stream is streaming LLM tokens — the
      // least trustworthy content a server handles — and parsing it as HTML makes a
      // prompt-injected `<img src=x onerror=…>` execute with the framework's blessing.
      // An element that genuinely streams server-authored markup opts in per element with
      // `flow:stream.html`, which reads as the deliberate choice it is.
      if (el.hasAttribute("flow:stream.html")) {
        if (replace) el.innerHTML = frame.content;
        else el.insertAdjacentHTML("beforeend", frame.content);
      } else {
        if (replace) el.textContent = frame.content;
        else el.append(document.createTextNode(frame.content));
      }
    });
    return;
  }

  if (frame.type === "flash") {
    const { type: _t, ...detail } = frame;
    _dispatchFlash(detail);
    return;
  }

  if (frame.type === "redirect") {
    if (frame.sessionToken) {
      try {
        await fetch(`/__flow/session-relay?t=${encodeURIComponent(frame.sessionToken)}`, {
          credentials: "include",
        });
      } catch {
        // Network error — navigate anyway.
      }
    }
    window.location.href = frame.url;
    return;
  }

  if (frame.type === "error") {
    _components.forEach((c) => _setLoading(c, false));
    // A rejected action is terminal — release the queue so the component isn't wedged.
    if (frame.component) _resolveAck(frame.component);

    // Dev fast-refresh fallback: an error during the soft-refresh window means the edit is
    // incompatible with the held snapshot (a render throw / integrity failure), so a plain
    // re-render can't recover — do a one-shot full reload to load the new code cleanly.
    if (Date.now() < _softRefreshUntil && !_reloadedForExpiry()) {
      _softRefreshUntil = 0;
      _markReloadedForExpiry();
      console.warn("[Flow] Fast refresh couldn't re-render from the held state — reloading.");
      window.location.reload();
      return;
    }

    // "Unknown component" means the server no longer has this component's server-side
    // registration — almost always because the server restarted (dev hot-reload) or the
    // page's registration expired. The client snapshot is now orphaned, so no targeted
    // patch can ever succeed and the page is silently dead. Recover by reloading: the
    // fresh document re-renders and re-registers every component server-side, then
    // re-hydrates the client. A one-shot guard (cleared once patches flow again, below)
    // prevents a reload loop if the reload doesn't resolve it.
    const reloadReason = _reloadReasonFor(frame, _reloadedForExpiry());
    if (reloadReason) {
      _markReloadedForExpiry();
      console.warn(
        reloadReason === "session-changed"
          ? `[Flow] ${frame.message ?? "The session changed"} — reloading the page.`
          : `[Flow] Component "${frame.component}" is no longer registered on the server ` +
              `(likely a server restart) — reloading the page to recover.`,
      );
      window.location.reload();
      return;
    }

    // Dev error overlay: the server attaches a stack only under the dev worker, so its presence
    // means "show the full-screen overlay". The patch that follows still reconciles the component
    // underneath, so dismissing (Esc / backdrop) returns to a live page.
    const errFrame = frame as { stack?: string; name?: string; action?: string; message: string };
    if (errFrame.stack) {
      showErrorOverlay({
        message: errFrame.message,
        name: errFrame.name,
        stack: errFrame.stack,
        action: errFrame.action,
        component: frame.component ? _components.get(frame.component)?.name : undefined,
      });
    }

    console.error(`[Flow] Server error on ${frame.component}: ${frame.message}`);
    return;
  }

  if (frame.type === "event") {
    const ev = frame as unknown as {
      name: string;
      data: Record<string, unknown>;
      to?: string;
      self?: string;
    };
    _handleEventFrame(ev.name, ev.data, ev.to, ev.self);
    return;
  }

  if (frame.type === "download") {
    _handleDownloadFrame(frame.filename, frame.content, frame.mime);
    return;
  }

  // Session cookie relay — sent after WS actions that mutated @session props.
  // The browser must fetch this endpoint so the Set-Cookie header is applied.
  if (frame.type === "session") {
    try {
      await fetch(`/__flow/session-relay?t=${encodeURIComponent(frame.token as string)}`, {
        credentials: "include",
      });
    } catch {
      /* network error — non-fatal */
    }
    return;
  }
}

function _syncFlowStore(comp: FlowComponent): void {
  const store = Alpine.store("flow") as Record<string, unknown> | undefined;
  if (store) {
    store[comp.id] = comp.reactive;
  }
}

function _syncModelInputs(comp: FlowComponent): void {
  _ownedEls(comp, "input, textarea, select").forEach((node) => {
    const el = node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    // Don't clobber a live-bound field the user is typing in — but only if it
    // actually holds something. An element that is focused *and* empty was just
    // created by this patch and autofocused; there is nothing to protect, and
    // skipping it leaves it permanently blank (an action that opens a focused
    // editor could never populate it).
    if (el.hasAttribute("flow:model.live") && document.activeElement === el && el.value !== "")
      return;
    const key =
      el.getAttribute("flow:model") ??
      el.getAttribute("flow:model.live") ??
      el.getAttribute("flow:model.blur");
    if (!key) return;
    const serverVal = _getPath(comp.reactive, key); // dotted keys → nested (Form fields)
    if (el instanceof HTMLInputElement && el.type === "checkbox") {
      el.checked = Boolean(serverVal);
      return;
    }
    // A radio's `value` is its immutable option identifier — the group's state selects
    // among those, it does not replace them. Assigning `el.value` here (as the generic
    // path below does) would rewrite every option in the group to the current value and
    // destroy the choices.
    if (el instanceof HTMLInputElement && el.type === "radio") {
      el.checked = el.value === String(serverVal ?? "");
      return;
    }
    // A file input's value belongs to the user agent: assigning anything but "" throws
    // InvalidStateError, and that throw escapes the frame handler — the morph never runs
    // and the action's ack never resolves, wedging the component's queue for good. The
    // server side of the binding is an upload reference, not a filename, so there is
    // nothing to write back; only the server *clearing* it is worth mirroring, so the
    // same file can be picked again after a remove.
    if (el instanceof HTMLInputElement && el.type === "file") {
      if (serverVal === null || serverVal === undefined) el.value = "";
      return;
    }
    const str = String(serverVal ?? "");
    if (el.value !== str) el.value = str;
    // A draft-backed field the server just emptied (e.g. after a successful submit) → drop the draft.
    if (el.hasAttribute("flow:draft") && str === "") _persistDraft(el, "");
  });
}

function _syncDeclarative(comp: FlowComponent): void {
  _ownedEls(comp, "[flow\\:text]").forEach((el) => {
    const prop = el.getAttribute("flow:text");
    if (!prop) return;
    // Simple identifier → direct property lookup; anything else → JS expression.
    // Expressions also get `$flow` in scope so compiled client-magic reads
    // (e.g. flow:text="$flow.currentUrl(...)" from {this.currentUrl(...)}) resolve.
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(prop)) {
      el.textContent = String(comp.reactive[prop] ?? "");
    } else {
      try {
        const flow = _resolveGel(el);
        if (_bridgeCsp) {
          // CSP-safe: no `new Function`. Evaluate against reactive state + $flow.
          const scope = new Proxy({} as Record<string, unknown>, {
            get(_t, k: string | symbol): unknown {
              if (k === "$flow") return flow;
              return (comp.reactive as Record<string, unknown>)[k as string];
            },
            has(): boolean {
              return true;
            },
          });
          el.textContent = String(evaluateCsp(prop, scope) ?? "");
        } else {
          const keys = Object.keys(comp.reactive);
          const vals = keys.map((k) => (comp.reactive as Record<string, unknown>)[k]);
          el.textContent = String(
            new Function("$flow", ...keys, `return String(${prop} ?? '')`)(flow, ...vals),
          );
        }
      } catch {
        /* leave textContent unchanged on eval error */
      }
    }
  });

  _ownedEls(comp, "[flow\\:show], [flow\\:show\\.important]").forEach((node) => {
    const el = node as HTMLElement;
    const important = el.hasAttribute("flow:show.important");
    const prop = el.getAttribute("flow:show") ?? el.getAttribute("flow:show.important");
    if (!prop) return;
    const visible = Boolean(comp.reactive[prop]);
    if (visible) {
      el.style.removeProperty("display");
    } else {
      el.style.setProperty("display", "none", important ? "important" : "");
    }
  });

  _ownedEls(comp, "[flow\\:bind\\:class]").forEach((el) => {
    const prop = el.getAttribute("flow:bind:class");
    if (!prop) return;
    const base =
      (el as HTMLElement).dataset["flowBaseClass"] ??
      ((el as HTMLElement).dataset["flowBaseClass"] = el.className);
    const extra = String(comp.reactive[prop] ?? "");
    el.className = extra ? `${base} ${extra}`.trim() : base;
  });

  _ownedEls(comp, "[flow\\:bind\\:href]").forEach((el) => {
    const prop = el.getAttribute("flow:bind:href");
    // Same scheme check the server renderer applies. This path is the worse of the two:
    // the value arrives from server-pushed state, so it updates without a page load.
    if (prop) el.setAttribute("href", sanitizeUrl(String(comp.reactive[prop] ?? "")));
  });

  _ownedEls(comp, "[flow\\:bind\\:attr]").forEach((el) => {
    const spec = el.getAttribute("flow:bind:attr");
    if (!spec) return;
    let map: Record<string, string>;
    try {
      map = JSON.parse(spec) as Record<string, string>;
    } catch {
      return;
    }
    for (const [attr, prop] of Object.entries(map)) {
      const val = comp.reactive[prop];
      if (attr.startsWith("aria-")) {
        // WAI-ARIA attributes require "true"/"false" strings, not boolean present/absent
        if (val === null || val === undefined) {
          el.removeAttribute(attr);
        } else {
          el.setAttribute(attr, String(val));
        }
      } else if (val === false || val === null || val === undefined) {
        el.removeAttribute(attr);
      } else if (val === true) {
        el.setAttribute(attr, "");
      } else if (URL_ATTRIBUTES.has(attr)) {
        el.setAttribute(attr, sanitizeUrl(String(val)));
      } else {
        el.setAttribute(attr, String(val));
      }
    }
  });

  // flow:error — display the first error message for a field
  _ownedEls(comp, "[flow\\:error]").forEach((el) => {
    const field = el.getAttribute("flow:error");
    if (!field) return;
    const errs = _getErrors(comp.id)[field];
    const msg = errs && errs.length > 0 ? errs[0]! : "";
    el.textContent = msg;
    (el as HTMLElement).style.display = msg ? "" : "none";
  });

  // flow:errors — render the whole validation bag as a list (the <Errors> component).
  // flow:errors.only="a,b" limits it to specific fields; data-flow-errors-item sets the
  // child tag (default <li>). The container is hidden when there are no messages.
  _ownedEls(comp, "[flow\\:errors]").forEach((node) => {
    const el = node as HTMLElement;
    const bag = _getErrors(comp.id);
    const onlyRaw = el.getAttribute("flow:errors.only");
    let entries = Object.entries(bag);
    if (onlyRaw) {
      const only = onlyRaw.split(",").map((s) => s.trim());
      entries = entries.filter(([f]) => only.includes(f));
    }
    const msgs = entries.flatMap(([, m]) => m);
    if (msgs.length === 0) {
      el.style.setProperty("display", "none");
      el.innerHTML = "";
      return;
    }
    el.style.removeProperty("display");
    const tag = el.dataset["flowErrorsItem"] || "li";
    el.innerHTML = msgs.map((m) => `<${tag}>${_escapeHtml(m)}</${tag}>`).join("");
  });

  _syncAria(comp);
}

/**
 * Accessibility auto-wiring (morph-safe). Links each validation-error region to the input it
 * describes, so a screen-reader user hears the message a sighted user sees — with deterministic
 * ids that stay stable across morphs. For every `flow:error="<field>"`, ensure a stable id; for
 * every `flow:model` input whose field matches, set `aria-describedby` to that id and toggle
 * `aria-invalid`. Runs at the end of every declarative sync (scan + patch), so it re-applies
 * automatically after a morph drops the attributes. Zero author effort — it rides the existing
 * `value={this.x}` / `<span error={this.errors.x} />` props.
 */
function _syncAria(comp: FlowComponent): void {
  const prefix = `flow-err-${comp.id}-`;
  const errorId = new Map<string, string>();

  _ownedEls(comp, "[flow\\:error]").forEach((el) => {
    const field = el.getAttribute("flow:error");
    if (!field) return;
    let id = (el as HTMLElement).id;
    if (!id) {
      id = prefix + field.replace(/[^\w-]/g, "_");
      (el as HTMLElement).id = id;
    }
    errorId.set(field, id);
  });
  if (errorId.size === 0) return;

  const bag = _getErrors(comp.id);
  _ownedEls(comp, "[flow\\:model], [flow\\:model\\.live], [flow\\:model\\.blur]").forEach((el) => {
    const field =
      el.getAttribute("flow:model") ??
      el.getAttribute("flow:model.live") ??
      el.getAttribute("flow:model.blur");
    if (!field) return;
    // Match by exact field or the model's last dotted segment (Form fields: "form.email" → "email").
    const last = field.includes(".") ? field.slice(field.lastIndexOf(".") + 1) : field;
    const id = errorId.get(field) ?? errorId.get(last);
    if (id) {
      // Preserve any author-provided ids; keep ours exactly once.
      const kept = (el.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter((t) => t && t !== id && !t.startsWith(prefix));
      el.setAttribute("aria-describedby", [...kept, id].join(" ").trim());
    }
    const msgs = bag[field] ?? bag[last];
    if (Array.isArray(msgs) && msgs.length > 0) el.setAttribute("aria-invalid", "true");
    else el.removeAttribute("aria-invalid");
  });
}

// ── Focus management (autoFocus / focusOnError) ───────────────────────────────

/** True if `el` is a focusable form field. */
function _isField(el: Element | null): el is HTMLElement {
  return (
    !!el &&
    (el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement)
  );
}

/** On mount, focus the first `autoFocus` (flow:autofocus) field — once, and never stealing focus
 *  the user has already placed elsewhere. */
function _autoFocus(comp: FlowComponent): void {
  if (_isField(document.activeElement) && document.activeElement !== document.body) return;
  const el = _ownedEls(comp, "[flow\\:autofocus]").find((n) => _isField(n));
  if (el) (el as HTMLElement).focus();
}

/**
 * After a patch, move focus to the first invalid `focusOnError` (flow:focus-error) field — the
 * WCAG "send focus to the first error" behaviour. It won't yank focus out of a field the user is
 * actively editing (a form control inside this component); it fires when focus sits on a
 * button/body — e.g. right after a failed submit.
 */
function _focusFirstError(comp: FlowComponent): void {
  const bag = _getErrors(comp.id);
  if (Object.keys(bag).length === 0) return;
  const active = document.activeElement;
  if (_isField(active) && _owns(comp, active)) return; // user is in a field — leave them
  const invalid = _ownedEls(comp, "[flow\\:focus-error]").find((el) => {
    const key = _modelKey(el);
    if (!key) return false;
    const last = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key;
    const msgs = bag[key] ?? bag[last];
    return Array.isArray(msgs) && msgs.length > 0;
  });
  if (invalid) (invalid as HTMLElement).focus();
}

/**
 * Find the nearest ancestor carrying `flow:<event>`, with or without modifiers.
 *
 * The compiler emits modifiers into the attribute *name* (`onClick={flow(this.save).stop}`
 * → `flow:click.stop="save"`), but a `[flow\:click]` attribute selector matches that name
 * exactly — so every handler that carried a modifier was invisible to the bridge and did
 * nothing at all, silently. Walking the ancestors and reading the attribute list finds
 * both forms.
 */
export function _findHandler(
  target: Element | null,
  event: string,
): { el: Element; value: string; modifiers: Set<string> } | null {
  const prefix = `flow:${event}`;
  for (let el = target; el; el = el.parentElement) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name !== prefix && !attr.name.startsWith(`${prefix}.`)) continue;
      if (!attr.value) continue;
      const modifiers = new Set(
        attr.name.length > prefix.length ? attr.name.slice(prefix.length + 1).split(".") : [],
      );
      return { el, value: attr.value, modifiers };
    }
  }
  return null;
}

/**
 * Whether a click handler should cancel the element's default action.
 *
 * `preventDefault()` used to be unconditional, which cancels the *activation behaviour*
 * of whatever it is placed on — so a radio or checkbox carrying `onClick` never became
 * checked, and no handler could fix it: the browser restores the control's pre-click
 * checkedness after listeners run, so assigning `.checked` inside the handler is reverted
 * a moment later. `onClick` and a form control were effectively mutually exclusive.
 *
 * Default only where the default action is the thing in the way — following a link, or
 * submitting a form. `.prevent` forces it anywhere; `.passive` opts out anywhere.
 */
export function _shouldPreventClickDefault(el: Element, modifiers: Set<string>): boolean {
  if (modifiers.has("passive")) return false;
  if (modifiers.has("prevent")) return true;
  // tagName rather than instanceof: an element adopted from another document (an iframe,
  // a template) fails `instanceof HTMLAnchorElement` against this window's constructors,
  // and silently taking the wrong branch here is the whole class of bug being fixed.
  const tag = el.tagName?.toUpperCase();
  if (tag === "A") return true;
  const type = (el.getAttribute?.("type") ?? "").toLowerCase();
  // A <button> with no type attribute is type="submit" per the HTML spec.
  if (tag === "BUTTON") return type === "" || type === "submit";
  // Inputs of type submit/image submit a form; every other control (checkbox, radio,
  // file, …) needs its activation behaviour left alone.
  if (tag === "INPUT") return type === "submit" || type === "image";
  return false;
}

function _parseArgs(el: Element): unknown[] {
  const raw = el.getAttribute("data-args") ?? el.getAttribute("flow:args");
  if (!raw) return [];
  try {
    return JSON.parse(raw) as unknown[];
  } catch {
    return [];
  }
}

async function _requireConfirm(el: Element): Promise<boolean> {
  // Rich options object (title/labels/variant/icon/prompt) encoded as JSON.
  const optsJson = el.getAttribute("flow:confirm.opts");
  if (optsJson) {
    try {
      return await confirmDialog(JSON.parse(optsJson) as ConfirmDialogOptions);
    } catch {
      return true; // malformed spec → don't block the action
    }
  }
  const promptSpec = el.getAttribute("flow:confirm.prompt");
  if (promptSpec) {
    const sep = promptSpec.lastIndexOf("|");
    const message = sep >= 0 ? promptSpec.slice(0, sep) : promptSpec;
    const expected = sep >= 0 ? promptSpec.slice(sep + 1) : "";
    return await confirmDialog({ message, prompt: expected });
  }
  const confirm = el.getAttribute("flow:confirm");
  if (confirm) return await confirmDialog({ message: confirm });
  return true;
}

/** Toggle the component's failed state (drives `showOnError` / `hideOnError`). */
function _setActionError(comp: FlowComponent, on: boolean): void {
  if (on) comp.rootEl.setAttribute("data-flow-action-error", "");
  else comp.rootEl.removeAttribute("data-flow-action-error");
}

// ── Optimistic collections ─────────────────────────────────────────────────────
// Pending optimistic list mutations per component. Applied to the reactive store instantly (so a
// reactive `x-for`/`<For>` list shows them at once), re-applied on top of any interim server patch,
// and dropped when the owning action's patch resolves the ack (adopt server state = reconcile/roll-
// back). See client/optimistic.ts for the pure logic.
const _optOps = new Map<string, OptOp[]>();

function _appendOptimistic(comp: FlowComponent, prop: string, item: unknown): void {
  const arr = comp.reactive[prop];
  if (!Array.isArray(arr)) return;
  comp.reactive[prop] = applyAppend(arr, item);
  (_optOps.get(comp.id) ?? _optOps.set(comp.id, []).get(comp.id)!).push({
    prop,
    kind: "append",
    item,
  });
}

function _removeOptimistic(
  comp: FlowComponent,
  prop: string,
  match: (x: unknown) => boolean,
): void {
  const arr = comp.reactive[prop];
  if (!Array.isArray(arr)) return;
  comp.reactive[prop] = applyRemove(arr, match);
  (_optOps.get(comp.id) ?? _optOps.set(comp.id, []).get(comp.id)!).push({
    prop,
    kind: "remove",
    match,
  });
}

/** Re-apply pending optimistic ops onto the just-merged server arrays (survive an interim patch). */
function _reapplyOptOps(comp: FlowComponent): void {
  const ops = _optOps.get(comp.id);
  if (!ops) return;
  for (const op of ops) {
    const arr = comp.reactive[op.prop];
    if (!Array.isArray(arr)) continue;
    comp.reactive[op.prop] =
      op.kind === "append" ? applyAppend(arr, op.item) : applyRemove(arr, op.match!);
  }
}

// Time-travel: remember what a component last dispatched, so the patch it produces is labelled
// with that action name in the timeline — and so the panel can show the call that caused it.
// Consumed (and cleared) when the patch lands.
interface _PendingDispatch {
  method: string;
  args: unknown[];
  /** Filled in by `_sendCall`, which is where the batch of client writes is resolved. */
  updates?: Record<string, unknown>;
}
const _pendingActionByComp = new Map<string, _PendingDispatch>();

function _takeLastDispatch(compId: string): { action: string; sent?: _PendingDispatch } {
  const d = _pendingActionByComp.get(compId);
  _pendingActionByComp.delete(compId);
  if (!d) return { action: "action" };
  return { action: d.method, sent: d };
}

function _callAction(comp: FlowComponent, method: string, args: unknown[]): void {
  _countActionDispatch(comp);
  _setActionError(comp, false); // retrying clears any prior failed state
  _setLoading(comp, true, method);
  if (isTimelineEnabled()) _pendingActionByComp.set(comp.id, { method, args });
  _dispatchFrame(comp, method, args);
}

// ── Client-expression writes sync to the server ───────────────────────────────
// `onClick={() => (this.selected = row.id)}` writes the reactive store, but render()
// runs on the server — without a round-trip the page never reflects the write, and
// nothing errors. (It *looked* reactive whenever a later action happened to flush it,
// which is the worst kind of sometimes.) So: while a client expression evaluates,
// every write to an exposed prop is recorded; if the expression wrote state and did
// not itself dispatch an action on that component (an action's frame already carries
// all pending writes), one `$rerender` is sent — state applied through the same
// allowlist + updating()/updated() hooks, re-rendered, patched. No loading state:
// it is a sync, not a user action. Client-only UI state belongs in `this.store()`,
// which never round-trips.

/** Writes recorded during the currently-evaluating client expression (null: none active). */
let _exprWrites: Set<string> | null = null;
/** Actions dispatched per component, to detect "the expression already sent one". */
const _actionSeq = new Map<string, number>();

/** @internal Count an action dispatch on `comp` (called by _callAction; exported for tests). */
export function _countActionDispatch(comp: { id: string }): void {
  _actionSeq.set(comp.id, (_actionSeq.get(comp.id) ?? 0) + 1);
}

/** @internal Record a write to an exposed prop; no-op outside an expression evaluation. */
export function _noteExprWrite(key: string): void {
  _exprWrites?.add(key);
}

/** @internal Opaque state carried from {@link _beginExprEval} to {@link _endExprEval}. */
export interface ExprEvalToken {
  writes: Set<string>;
  prev: Set<string> | null;
  seqBefore: number;
}

/** @internal Start recording exposed-prop writes for one expression evaluation. */
export function _beginExprEval(comp: { id: string }): ExprEvalToken {
  const token: ExprEvalToken = {
    writes: new Set(),
    prev: _exprWrites,
    seqBefore: _actionSeq.get(comp.id) ?? 0,
  };
  _exprWrites = token.writes;
  return token;
}

/**
 * @internal Stop recording and decide whether the component needs a sync round-trip:
 * it does when the expression wrote at least one exposed prop, dispatched no action on
 * this component itself, and the writes left actual pending changes (a toggle-back to
 * the canonical value needs nothing).
 */
export function _endExprEval(
  comp: { id: string },
  token: ExprEvalToken,
  pendingCount: number,
): boolean {
  _exprWrites = token.prev;
  if (token.writes.size === 0) return false;
  if ((_actionSeq.get(comp.id) ?? 0) !== token.seqBefore) return false;
  return pendingCount > 0;
}

/**
 * Execute a flow:click / flow:submit value that contains $flow references.
 * Emitted from inline arrow handlers in JSX — `onClick={(e) => this.x = 0}` — where
 * `this.` is rewritten to `$flow.` at SSR time, so it evaluates against the Alpine
 * reactive proxy instead of sending a WebSocket action.
 *
 * Mirrors Alpine's own `x-on` semantics: if the expression evaluates to a function
 * (the author wrote an arrow), call it with the DOM event. A bare statement
 * (`$flow.x = 0`) evaluates directly and returns a non-function, so nothing is called.
 *
 * A write to an exposed prop syncs to the server afterwards (see _beginExprEval) —
 * a partial write before a throw still syncs, since the client state did change.
 */
function _evalClientExpr(comp: FlowComponent, el: Element, expr: string, event?: Event): void {
  const A = Alpine as unknown as { evaluate(el: Element, expr: string): unknown };
  const token = _beginExprEval(comp);
  let needsSync = false;
  try {
    const result = A.evaluate(el, expr);
    if (typeof result === "function") (result as (e?: Event) => unknown)(event);
  } catch (e) {
    console.error("[Flow] client expression error:", e, "\nExpr:", expr);
  } finally {
    needsSync = _endExprEval(comp, token, Object.keys(_pendingUpdates(comp)).length);
  }
  // Serialised like any action; carries every pending write as the frame's `updates`.
  if (needsSync) _dispatchFrame(comp, "$rerender", []);
}

/**
 * Read every flow:model input the component owns straight from the DOM into its
 * reactive/ephemeral state. Called right before dispatching a server action
 * (a form submit, or a click on a server-action button) so the action's
 * pendingUpdates carry the latest field values even when an input's own
 * input/blur sync didn't land first — e.g. clicking submit moves focus to the
 * button before its handler runs, or a value was set without an input event.
 * Without this, "type in a field, click Save" can silently drop that field.
 */
type ModelEl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** The `flow:model` field key for an input (with any sync modifier), or null. */
function _modelKey(el: Element): string | null {
  return (
    el.getAttribute("flow:model") ??
    el.getAttribute("flow:model.live") ??
    el.getAttribute("flow:model.blur")
  );
}

/**
 * Read an input's value for sync, applying the `trim` / `number` modifiers (data-flow-trim /
 * data-flow-number, surfaced as the `trim` / `number` JSX props) plus the implicit number
 * coercion for `type="number"` inputs whose canonical value is already numeric. A checkbox
 * returns its boolean `checked`. `existing` (the current canonical value) guards the implicit
 * number coercion so a string-typed field isn't turned into a number behind the author's back.
 *
 * A radio returns its value only when it is the checked member of its group, and
 * `undefined` otherwise — callers must skip `undefined` rather than write it. Every
 * radio in a group carries the same `flow:model`, so returning a bare `.value` would
 * let each unchecked option overwrite the group's state in turn and leave whichever
 * one happens to be last in DOM order as the winner.
 */
function _readModelValue(el: ModelEl, existing?: unknown): unknown {
  if (el instanceof HTMLInputElement && el.type === "checkbox") return el.checked;
  if (el instanceof HTMLInputElement && el.type === "radio") {
    return el.checked ? el.value : undefined;
  }
  let v = (el as HTMLInputElement).value;
  if (el.hasAttribute("data-flow-trim")) v = v.trim();
  const wantNumber =
    el.hasAttribute("data-flow-number") ||
    (el instanceof HTMLInputElement && el.type === "number" && typeof existing === "number");
  if (wantNumber) return v === "" ? null : Number(v);
  return v;
}

function _flushModelInputs(comp: FlowComponent): void {
  _ownedEls(comp, "[flow\\:model], [flow\\:model\\.live], [flow\\:model\\.blur]").forEach(
    (node) => {
      const el = node as ModelEl;
      if (el instanceof HTMLInputElement && el.type === "file") return; // files upload over HTTP, not via $set
      const key = _modelKey(el);
      if (!key) return;
      // Coerce (see _readModelValue) so a number field doesn't send "0" as a string, etc.
      const value = _readModelValue(el, _getPath(comp.reactive as Record<string, unknown>, key));
      // An unchecked radio reports undefined — skip it, or iterating the group would
      // clear the value its checked sibling just contributed.
      if (value === undefined) return;
      // reactive first (see set-trap note): ephemeral is the proxy's raw target.
      _setPath(comp.reactive, key, value);
      _setPath(comp.ephemeral, key, value);
    },
  );
}

// ── Persisted drafts (flow:draft) ──────────────────────────────────────────────
// `draft="key"` mirrors an input's value to localStorage so unsubmitted text survives a reload
// or crash — a client-side safety net; the server snapshot stays the authority. Restored on
// mount when the bound field is empty; cleared when the field is emptied (e.g. after submit).

const _DRAFT_NS = "flow:draft:";

function _persistDraft(el: Element, value: unknown): void {
  const k = el.getAttribute("flow:draft");
  if (!k) return;
  try {
    const s = typeof value === "string" ? value : String(value ?? "");
    if (s) localStorage.setItem(_DRAFT_NS + k, s);
    else localStorage.removeItem(_DRAFT_NS + k);
  } catch {
    /* storage unavailable (private mode / quota) — drafts are best-effort */
  }
}

/** On mount, seed empty draft-backed fields from localStorage (held locally, flushed with the
 *  next action). Never clobbers server-provided content — only fills a genuinely empty field. */
function _restoreDrafts(comp: FlowComponent): void {
  _ownedEls(comp, "[flow\\:draft]").forEach((el) => {
    const k = el.getAttribute("flow:draft");
    const key = _modelKey(el);
    if (!k || !key) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(_DRAFT_NS + k);
    } catch {
      return;
    }
    if (!saved) return;
    const cur = _getPath(comp.reactive as Record<string, unknown>, key);
    if (cur !== undefined && cur !== null && cur !== "") return; // server content wins
    _setPath(comp.reactive, key, saved);
    _setPath(comp.ephemeral, key, saved);
    if ((el as HTMLInputElement).value !== undefined) (el as HTMLInputElement).value = saved;
  });
}

function _setupEventDelegation(): void {
  // Toast action/onClose buttons live outside any component's DOM (they're created
  // by the <Flash> runtime script), so they reach the bridge via a window event
  // carrying the owning component id + the @expose method to invoke.
  window.addEventListener("flow:invoke", (e) => {
    const detail = (e as CustomEvent).detail as
      { component?: string; method?: string; args?: unknown[] } | undefined;
    if (!detail?.method) return;
    const comp = detail.component ? _components.get(detail.component) : undefined;
    if (!comp) return;
    _callAction(comp, detail.method, Array.isArray(detail.args) ? detail.args : []);
  });

  document.addEventListener("click", async (e) => {
    const found = _findHandler(e.target as Element, "click");
    if (!found) return;
    const { el, value: method, modifiers } = found;
    const comp = findComponentByEl(el);
    if (!comp) return;

    if (modifiers.has("stop")) e.stopPropagation();
    if (_shouldPreventClickDefault(el, modifiers)) e.preventDefault();

    // Async: a confirm prompt shows the styled dialog and resolves on Confirm/Cancel.
    if (!(await _requireConfirm(el))) return;

    // Plain identifier → server action; anything else (incl. $flow exprs, arbitrary JS) → client-side eval
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(method)) {
      _flushModelInputs(comp); // capture in-progress field edits before the action
      _callAction(comp, method, _parseArgs(el));
    } else {
      _evalClientExpr(comp, el, method, e);
    }
  });

  document.addEventListener("submit", async (e) => {
    const el = e.target as Element;
    const method = el.getAttribute("flow:submit") ?? el.getAttribute("flow:submit.prevent");
    if (!method) return;
    const comp = findComponentByEl(el);
    if (!comp) return;
    e.preventDefault();

    if (!(await _requireConfirm(el))) return;

    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(method)) {
      _evalClientExpr(comp, el, method, e);
    } else {
      _flushModelInputs(comp); // capture all field values (incl. the focused one) → pendingUpdates
      const formData = new FormData(e.target as HTMLFormElement);
      const data = Object.fromEntries(
        (formData as unknown as { entries(): Iterable<[string, unknown]> }).entries(),
      );
      _callAction(comp, method, [data]);
    }
  });

  document.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    const key =
      el.getAttribute("flow:model") ??
      el.getAttribute("flow:model.live") ??
      el.getAttribute("flow:model.blur");
    if (!key) return;
    const comp = findComponentByEl(el);
    if (!comp) return;

    // File inputs are handled by the 'change' listener (they upload over HTTP, not the WS).
    if (el.type === "file") return;

    // Apply the trim/number modifiers on the way in, so client-reactive bindings see the coerced
    // value immediately (not just the server on the next action).
    const value = _readModelValue(el, _getPath(comp.reactive as Record<string, unknown>, key));
    // Only the newly-checked radio in a group reports a value; the input event that
    // deselects its sibling carries nothing to write.
    if (value === undefined) return;

    // reactive first (see set-trap note): ephemeral is the proxy's raw target, so writing it
    // first would suppress the reactive trigger and leave x-text/:class bindings stale.
    // Dotted keys (e.g. Form fields: flow:model="form.email") set a nested path.
    _setPath(comp.reactive, key, value);
    _setPath(comp.ephemeral, key, value);

    _persistDraft(el, value); // mirror to localStorage if this input has draft="…"

    _updateDirty(comp);
    _syncDeclarative(comp);

    if (!el.hasAttribute("flow:model.live")) return;

    // Debounce a text input's keystrokes (default); discrete controls send immediately.
    _debouncedModelSend(comp, key, value, _modelDebounceMs(el));
  });

  // File inputs bound with flow:model — upload bytes over HTTP, then $set the signed reference.
  document.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.type !== "file") return;
    const key = el.getAttribute("flow:model") ?? el.getAttribute("flow:model.live");
    if (!key) return;
    const comp = findComponentByEl(el);
    if (!comp || !el.files || el.files.length === 0) return;
    _uploadFiles(comp, key, Array.from(el.files), el.multiple);
    el.value = ""; // allow re-selecting the same file
  });

  document.addEventListener(
    "blur",
    (e) => {
      const el = e.target as Element;
      const comp = findComponentByEl(el);
      if (!comp) return;

      const key = el.getAttribute("flow:model.blur");
      if (key) {
        // Go through _readModelValue so the blur path applies the same coercions and
        // the same radio/checkbox rules as input and flush do — a raw `.value` here
        // sends "on" for a checkbox and an unchecked radio's value for a radio.
        const blurValue = _readModelValue(
          el as ModelEl,
          _getPath(comp.reactive as Record<string, unknown>, key),
        );
        if (blurValue !== undefined) _callAction(comp, "$set", [key, blurValue]);
      }

      // `onBlur={this.method}` — the JSX runtime emits `flow:blur` for it like any
      // other `on*` prop, so without this the attribute renders and nothing ever
      // calls it. Dispatched the same way as flow:click: a bare identifier is a
      // server action, anything else is a client expression.
      const action = el.getAttribute("flow:blur");
      if (!action) return;
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(action)) {
        // Flush first, so an action that reads the field sees what was typed
        // rather than the value as of the last sync.
        _flushModelInputs(comp);
        _callAction(comp, action, _parseArgs(el));
      } else {
        _evalClientExpr(comp, el, action, e);
      }
    },
    true,
  );
}

// ── SPA Navigation (flow:navigate / flow:current) ───────────────────────────────

function _linkActive(href: string, path: string, exact = false): boolean {
  const h = href.split("?")[0] ?? href; // compare pathname only
  if (exact) return h === path;
  return h === path || (h.length > 1 && path.startsWith(h + "/"));
}

function _updateCurrentLinks(): void {
  const path = window.location.pathname;

  // Auto data-current on every navigate link matching the URL.
  // Style with `class="data-current:font-bold"` or `[data-current] {}`. Opt out
  // per-link with `flow:current.ignore` (the <Link current={false}> prop), or force it
  // always-on with `flow:current.force` (the <Link current={true}> prop) so the link stays
  // active across SPA navigations regardless of whether its href matches the URL.
  document.querySelectorAll("a[flow\\:navigate]").forEach((el) => {
    if (el.hasAttribute("flow:current.ignore")) return;
    if (el.hasAttribute("flow:current.force")) {
      el.setAttribute("data-current", "");
      return;
    }
    const exact = el.hasAttribute("flow:current.exact");
    if (_linkActive(el.getAttribute("href") ?? "", path, exact))
      el.setAttribute("data-current", "");
    else el.removeAttribute("data-current");
  });

  document.querySelectorAll("a[flow\\:navigate][flow\\:current]").forEach((el) => {
    const href = el.getAttribute("href") ?? "";
    const activeClass = el.getAttribute("flow:current") ?? "";
    if (!activeClass) return;
    if (!el.hasAttribute("data-flow-base-class")) {
      el.setAttribute("data-flow-base-class", el.getAttribute("class") ?? "");
    }
    const base = el.getAttribute("data-flow-base-class") ?? "";
    const isActive = href === path || (href.length > 1 && path.startsWith(href + "/"));
    el.setAttribute("class", isActive ? `${base} ${activeClass}`.trim() : base);
  });
}

// ── Hover prefetch ────────────────────────────────────────────────────────────
// `<a … navigate hover>` (flow:navigate.hover) fetches the target after a short dwell
// and caches the HTML, so the click swaps instantly (beats a cold fetch on slow links).

const _prefetchCache = new Map<string, { html: string; at: number }>();
const _prefetchInflight = new Set<string>();
const PREFETCH_MAX = 10;
const PREFETCH_TTL_MS = 30_000;
const PREFETCH_DWELL_MS = 60;

function _prefetch(href: string): void {
  if (_prefetchInflight.has(href)) return;
  const cached = _prefetchCache.get(href);
  if (cached && Date.now() - cached.at < PREFETCH_TTL_MS) return;
  _prefetchInflight.add(href);
  void fetch(href, { credentials: "include", headers: { Accept: "text/html" } })
    .then(async (res) => {
      if (res.ok && (res.headers.get("content-type") ?? "").includes("text/html")) {
        _prefetchCache.set(href, { html: await res.text(), at: Date.now() });
        while (_prefetchCache.size > PREFETCH_MAX) {
          const oldest = _prefetchCache.keys().next().value; // insertion-order = LRU-ish
          if (oldest === undefined) break;
          _prefetchCache.delete(oldest);
        }
      }
    })
    .catch(() => {})
    .finally(() => _prefetchInflight.delete(href));
}

/** Consume a fresh prefetched page for `href`, or null. Consuming evicts it. */
function _takePrefetched(href: string): string | null {
  const cached = _prefetchCache.get(href);
  if (!cached) return null;
  _prefetchCache.delete(href);
  return Date.now() - cached.at < PREFETCH_TTL_MS ? cached.html : null;
}

// ── Scroll position across SPA navigations ────────────────────────────────────
//
// A real navigation puts you at the top of the new page, and Back puts you back
// where you were. Swapping the DOM under a stationary viewport does neither: you
// click a link near the bottom of a long list and land halfway down the next
// page, which reads as the page having failed to load.
//
// Positions live in a map keyed by history entry rather than inside
// `history.state`, because the entry you are *leaving* on a Back cannot be
// stamped — by the time `popstate` fires, `history.state` is already the
// destination's. A key per entry lets both directions be recorded.

let _nextHistoryKey = 1;
let _currentHistoryKey = 0;
const _scrollByHistoryKey = new Map<number, [number, number]>();

/**
 * The live scroll offset, tracked passively.
 *
 * Read from here rather than from `window.scrollY` at navigation time: on a
 * `popstate` the browser may already have applied its own scroll restoration
 * before our handler runs, and by then the outgoing page's real position is gone.
 */
let _liveScroll: [number, number] = [0, 0];

function _trackScroll(): void {
  const update = (): void => {
    _liveScroll = [window.scrollX, window.scrollY];
  };
  update();
  window.addEventListener("scroll", update, { passive: true });
}

/** Record where the current history entry was left, so Back can return to it. */
function _rememberScroll(): void {
  _scrollByHistoryKey.set(_currentHistoryKey, _liveScroll);
}

/** Start a new history entry, keyed so its scroll position can be found again. */
function _pushHistoryEntry(url: string): void {
  _currentHistoryKey = _nextHistoryKey++;
  history.pushState({ flowNavigate: true, flowKey: _currentHistoryKey }, "", url);
}

/** Where a navigation should leave the viewport. */
export type ScrollIntent = "top" | "preserve" | readonly [number, number];

/** The fragment of an href, without the `#`. Empty when it has none. */
export function _hashOf(href: string): string {
  const at = href.indexOf("#");
  return at === -1 ? "" : href.slice(at + 1);
}

/**
 * Resolve what a navigation should do to the viewport.
 *
 * A recorded position wins outright: on Back/Forward the whole point is to land
 * where the user was, and `preserveScroll` is passed alongside it only as the
 * fallback for an entry with nothing recorded.
 */
export function _scrollIntent(options: {
  preserveScroll?: boolean;
  restoreScroll?: readonly [number, number] | undefined;
}): ScrollIntent {
  return options.restoreScroll ?? (options.preserveScroll ? "preserve" : "top");
}

/** What {@link _applyScroll} will do, separated out so the decision is testable. */
export type ScrollAction =
  | { kind: "none" }
  | { kind: "offset"; left: number; top: number }
  | { kind: "fragment"; id: string };

export function _scrollAction(intent: ScrollIntent, hash: string): ScrollAction {
  if (intent === "preserve") return { kind: "none" };
  if (intent !== "top") return { kind: "offset", left: intent[0], top: intent[1] };

  // A fragment in the URL beats the top of the page — that is what the browser
  // would have done for the same link without the SPA swap.
  let id = hash;
  if (id) {
    try {
      id = decodeURIComponent(id);
    } catch {
      /* malformed %-escape — take the fragment literally, as browsers do */
    }
  }
  return id ? { kind: "fragment", id } : { kind: "offset", left: 0, top: 0 };
}

function _applyScroll(intent: ScrollIntent, hash: string): void {
  const action = _scrollAction(intent, hash);
  if (action.kind === "none") return;

  // `behavior: "instant"` on purpose: a page with `scroll-behavior: smooth` in
  // its CSS would otherwise animate the whole way up on every navigation, which
  // on a long page is a visible scroll-back the user did not ask for.
  if (action.kind === "offset") {
    window.scrollTo({ left: action.left, top: action.top, behavior: "instant" });
    return;
  }

  const target = document.getElementById(action.id);
  // A fragment naming nothing on the page lands at the top, same as a real load.
  if (target) target.scrollIntoView({ behavior: "instant", block: "start" });
  else window.scrollTo({ left: 0, top: 0, behavior: "instant" });
}

/** Options for {@link _navigateTo}. */
interface NavigateOptions {
  /** Add a history entry. False on Back/Forward, where the entry already exists. */
  push?: boolean;
  /** Leave the viewport where it is instead of going to the top of the new page. */
  preserveScroll?: boolean;
  /** Offsets to restore, for Back/Forward. Takes precedence over `preserveScroll`. */
  restoreScroll?: readonly [number, number] | undefined;
}

async function _navigateTo(href: string, options: NavigateOptions = {}): Promise<void> {
  const { push = true } = options;
  const scrollIntent = _scrollIntent(options);
  let html: string;
  const prefetched = _takePrefetched(href);
  if (prefetched !== null) {
    html = prefetched; // instant — no network round-trip on click
  } else {
    try {
      const res = await fetch(href, { credentials: "include", headers: { Accept: "text/html" } });
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) {
        window.location.href = href;
        return;
      }
      html = await res.text();
    } catch {
      window.location.href = href;
      return;
    }
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const currentLayout = document.querySelector<HTMLElement>("[data-flow-layout]");
  const incomingLayout = doc.querySelector<HTMLElement>("[data-flow-layout]");
  const sameLayout =
    currentLayout &&
    incomingLayout &&
    currentLayout.dataset["flowLayout"] === incomingLayout.dataset["flowLayout"];

  if (!sameLayout) {
    // Crossing layouts means a different document shell (and its own runtime).
    // Do a real browser navigation so the new page loads in a fresh realm: a
    // document.write() here would re-inject the classic runtime <script> into the
    // *current* realm and redeclare its top-level bindings (e.g. `class
    // FlowComponent` → "already declared"). A hard navigation also re-bootstraps
    // the client cleanly for the new layout — including the scroll position,
    // which the browser owns on a real document load.
    if (push) window.location.assign(href);
    else window.location.reload();
    return;
  }

  const incomingRoot = incomingLayout.querySelector<HTMLElement>("[data-flow-root]");
  const currentRoot = currentLayout.querySelector<HTMLElement>("[data-flow-root]");
  if (!incomingRoot || !currentRoot) {
    window.location.href = href;
    return;
  }

  const newId = incomingRoot.dataset["flowId"] ?? "";
  const incomingState = doc.getElementById(`flow-state-${newId}`);
  if (!incomingState) {
    window.location.href = href;
    return;
  }

  // <Persist>: move live persisted elements (with their state — a playing <audio>,
  // scroll position, …) from the current root into the incoming clone so they're
  // re-used instead of replaced.
  const incomingClone = incomingRoot.cloneNode(true) as HTMLElement;
  _carryPersisted(currentRoot, incomingClone);

  // Where this page is sitting, banked before the swap. Replacing the root
  // changes the document height, and the browser clamps the scroll offset
  // against it — read afterwards, a position near the bottom of a long page
  // comes back as somewhere near the bottom of the short one.
  if (push) _rememberScroll();

  // Swap state script + component root. Wrapped in a View Transition when the
  // browser supports it, for a smooth cross-page animation; falls back to an
  // instant swap otherwise.
  const _swap = (): void => {
    // Page-level state scripts only: the server renders one as a direct child of
    // <body>, after the body content, while every child island's script sits
    // *inside* that content.
    //
    // This used to be `document.querySelector('[id^="flow-state-"]')`, which
    // matches in document order — so on any page with an island it removed the
    // first island's script and left the page's own behind. The outgoing
    // snapshot was orphaned, and ids are random per request, so they accumulated
    // one per navigation for as long as the tab stayed open.
    //
    // Removing *all* of them rather than just this page's also clears whatever a
    // previously-buggy session left behind.
    for (const stale of document.querySelectorAll('body > script[id^="flow-state-"]')) {
      stale.remove();
    }
    document.body.appendChild(incomingState.cloneNode(true));
    currentRoot.replaceWith(incomingClone);
    _cleanupDisconnected();
    _scanComponents();
    _processHead(doc); // re-apply head from the incoming page (shell stylesheet + page meta)
    // Inside the swap, not after it: the document only has its new height (and
    // its fragment targets) once the root is in place. Inside the View
    // Transition callback this is also what the "after" snapshot captures, so
    // the animation ends at the right offset instead of sliding there.
    _applyScroll(scrollIntent, _hashOf(href));
  };
  // The return value is typed here rather than cast at the call site, so reading
  // the transition's promises below costs no new assertion.
  const _startVT = (
    document as unknown as {
      startViewTransition?: (cb: () => void) => {
        ready?: Promise<unknown>;
        finished?: Promise<unknown>;
      };
    }
  ).startViewTransition;
  const _reduceMotion =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (typeof _startVT === "function" && !_reduceMotion) {
    const _vt = _startVT.call(document, _swap);
    // A navigation that starts while a transition is still running makes the
    // browser skip the older one and reject its `ready` and `finished` promises
    // with an AbortError. Nothing has gone wrong — the swap itself already ran
    // inside the callback — but an unhandled rejection reaches `window.onerror`
    // and whatever error tracker the app has wired to it. Clicking through links
    // faster than the animation reported a stream of errors describing an
    // animation the browser skipped on purpose.
    void _vt?.ready?.catch(() => {});
    void _vt?.finished?.catch(() => {});
  } else {
    _swap(); // reduced-motion (or unsupported): swap instantly, no cross-page animation
  }

  if (push) _pushHistoryEntry(href);
  const incomingTitle = doc.querySelector("title");
  if (incomingTitle) document.title = incomingTitle.textContent ?? "";
  _updateCurrentLinks();
}

/** Move live `[data-flow-persist]` elements from `fromEl` into matching slots in `toEl`. */
function _carryPersisted(fromEl: Element, toEl: Element): void {
  fromEl.querySelectorAll("[data-flow-persist]").forEach((live) => {
    const name = (live as HTMLElement).dataset["flowPersist"];
    if (!name) return;
    const slot = toEl.querySelector(`[data-flow-persist="${CSS.escape(name)}"]`);
    if (slot) slot.replaceWith(live); // re-use the live node (preserves its state)
  });
}

/**
 * Hoist `<template data-flow-head>` content (from <Head>) into document.head.
 *
 * On a same-layout `navigate` the shell (and its `<Head>` template) isn't part of
 * the swapped-in page root, and the initial hoist removes the template from the
 * live DOM — so read from `source` (the incoming parsed document on navigation),
 * which still carries every head template (shell-level stylesheet *and* page-level
 * title/meta). Dedupe by identity so an unchanged stylesheet is left in place
 * rather than removed-and-re-added (which would flash unstyled on every visit).
 */
function _processHead(source: ParentNode = document): void {
  const keyOf = (el: Element): string =>
    el.tagName +
    "|" +
    (el.getAttribute("href") ?? el.getAttribute("name") ?? el.getAttribute("rel") ?? el.outerHTML);

  const desired: HTMLElement[] = [];
  source.querySelectorAll("template[data-flow-head]").forEach((tplEl) => {
    const tpl = tplEl as HTMLTemplateElement;
    const frag = tpl.content.cloneNode(true) as DocumentFragment;
    for (const el of Array.from(frag.children)) {
      if (el.tagName === "TITLE") {
        document.title = el.textContent ?? "";
        continue;
      }
      desired.push(el as HTMLElement);
    }
    tpl.remove();
  });

  const existing = new Map<string, Element>();
  document.head
    .querySelectorAll("[data-flow-head-managed]")
    .forEach((n) => existing.set(keyOf(n), n));

  const keep = new Set<string>();
  for (const el of desired) {
    const k = keyOf(el);
    keep.add(k);
    if (existing.has(k)) continue; // already applied — leave it untouched (no flash)
    el.setAttribute("data-flow-head-managed", "");
    document.head.appendChild(el);
  }
  for (const [k, n] of existing) if (!keep.has(k)) n.remove(); // drop stale entries
}

/** Delegated hover/touch prefetch for `a[flow:navigate.hover]` links. */
function _setupPrefetch(): void {
  const sameOrigin = (a: HTMLAnchorElement): string | null => {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || href.includes(":")) return null;
    try {
      if (new URL(href, location.origin).origin !== location.origin) return null;
    } catch {
      return null;
    }
    return href;
  };

  let hoverHref: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // pointerover bubbles (unlike pointerenter), so one delegated listener covers all links.
  document.addEventListener("pointerover", (e) => {
    const a = (e.target as Element).closest?.(
      "a[flow\\:navigate\\.hover]",
    ) as HTMLAnchorElement | null;
    const href = a ? sameOrigin(a) : null;
    if (href === hoverHref) return; // still hovering the same link — don't restart the dwell
    hoverHref = href;
    if (timer) clearTimeout(timer);
    if (href) timer = setTimeout(() => _prefetch(href), PREFETCH_DWELL_MS);
  });

  // Mobile has no hover — prefetch on first touch (still ahead of the click).
  document.addEventListener(
    "touchstart",
    (e) => {
      const a = (e.target as Element).closest?.(
        "a[flow\\:navigate\\.hover]",
      ) as HTMLAnchorElement | null;
      const href = a ? sameOrigin(a) : null;
      if (href) _prefetch(href);
    },
    { passive: true },
  );

  // `flow:navigate.down` — prefetch on pointer-down, with no dwell.
  //
  // The middle setting between "never" and "every link the pointer crosses".
  // Hover prefetch is free speed on a handful of stable links and the opposite
  // on a dense list: moving the pointer down a table of a hundred rows asks the
  // server for a hundred pages, none of which anyone chose. Pointer-down fires
  // once, on the link the reader has committed to, and still beats the click by
  // however long the button stays held — around 100ms of ordinary human timing,
  // which is most of a fast page render.
  //
  // `pointerdown` rather than `mousedown` so a touch lands here too, and it is
  // passive because this never calls preventDefault — the click that follows is
  // handled by the navigation listener as usual, and finds the page waiting in
  // the cache.
  document.addEventListener(
    "pointerdown",
    (e) => {
      const a = (e.target as Element).closest?.(
        "a[flow\\:navigate\\.down]",
      ) as HTMLAnchorElement | null;
      const href = a ? sameOrigin(a) : null;
      if (href) _prefetch(href);
    },
    { passive: true },
  );
}

function _setupNavigationLinks(): void {
  _updateCurrentLinks();
  _setupPrefetch();
  _trackScroll();

  // Stamp the initial history entry as ours. A fresh page load has `history.state === null`,
  // so without this, pressing Back to the first page fires `popstate` with a null state — the
  // handler below ignores it and the URL changes while the page stays put. Replacing (not
  // pushing) keeps the entry in place; it just gains the flowNavigate marker and its scroll key.
  const initial = history.state as { flowNavigate?: boolean; flowKey?: number } | null;
  if (typeof initial?.flowKey === "number") {
    // Restored from bfcache or a reload — keep the key so the entry's recorded
    // position still matches, and mint above it so a new entry can't collide.
    _currentHistoryKey = initial.flowKey;
    _nextHistoryKey = Math.max(_nextHistoryKey, initial.flowKey + 1);
  } else {
    _currentHistoryKey = _nextHistoryKey++;
    history.replaceState(
      { ...(initial as object | null), flowNavigate: true, flowKey: _currentHistoryKey },
      "",
      location.href,
    );
  }

  document.addEventListener("click", (e) => {
    const anchor = (e.target as Element).closest("a[flow\\:navigate]") as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.includes(":")) return;
    try {
      if (new URL(href, window.location.origin).origin !== window.location.origin) return;
    } catch {
      return;
    }
    e.preventDefault();
    void _navigateTo(href, {
      preserveScroll: anchor.hasAttribute("flow:navigate.preserve"),
    });
  });

  window.addEventListener("popstate", (e) => {
    const state = e.state as { flowNavigate?: boolean; flowKey?: number } | null;
    if (!state?.flowNavigate) return;

    // Bank the outgoing entry before the key moves on, so Forward lands correctly
    // too — not just Back. This is the half that cannot be done from
    // `history.state`, which by now already describes the destination.
    _rememberScroll();
    const destination = state.flowKey;
    const restore = destination === undefined ? undefined : _scrollByHistoryKey.get(destination);
    if (destination !== undefined) _currentHistoryKey = destination;

    void _navigateTo(location.pathname + location.search + location.hash, {
      push: false,
      restoreScroll: restore,
      // Nothing recorded for this entry — it predates the runtime, or a reload
      // cleared the map. Leave the viewport alone rather than jumping to the
      // top, which is not what Back does.
      preserveScroll: restore === undefined,
    });
  });
}

/**
 * Query-aware SPA-navigation helpers exposed on `$flow` (and `this` in components):
 *   $flow.currentUrl({ query, hash })      — build a URL from the current one, no nav
 *   $flow.navigateCurrent({ query, hash })  — build that URL and SPA-navigate to it
 *
 * Both read the live URL from window.location (kept in sync by flow:navigate).
 * Ideal for instant filters, e.g.:
 *   <select @change="$flow.navigateCurrent({ query: { status: $event.target.value || null } })">
 *
 * Like any navigation this lands at the top of the page. For a control sitting
 * partway down — a filter row the user is looking at while they change it —
 * pass `preserveScroll: true` to leave the viewport alone:
 *   $flow.navigateCurrent({ query: { status: … }, preserveScroll: true })
 */
function _currentUrl(options: CurrentUrlOptions = {}): string {
  return buildUrlWithQuery(window.location.href, options);
}
function _navigateCurrent(
  options: CurrentUrlOptions & { preserveScroll?: boolean } = {},
): Promise<void> {
  return _navigateTo(buildUrlWithQuery(window.location.href, options), {
    preserveScroll: options.preserveScroll ?? false,
  });
}

const _debouncedModelSend = (() => {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return (comp: FlowComponent, key: string, value: unknown, ms: number) => {
    const timerKey = `${comp.id}:${key}`;
    clearTimeout(timers.get(timerKey));
    if (ms === 0) {
      _callAction(comp, "$set", [key, value]);
    } else {
      timers.set(
        timerKey,
        setTimeout(() => _callAction(comp, "$set", [key, value]), ms),
      );
    }
  };
})();

// ── File uploads ───────────────────────────────────────────────────────────────
// POST each file to /__flow/upload (XHR for progress), collect the signed references,
// then $set them onto the bound property (single value, or array for `multiple`). Emits
// flow:upload-start / -progress / -finish / -error CustomEvents on window for the UI.

function _uploadOne(file: File, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/__flow/upload");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const percent = Math.round((ev.loaded / ev.total) * 100);
      window.dispatchEvent(
        new CustomEvent("flow:upload-progress", { detail: { key, name: file.name, percent } }),
      );
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Bad upload response"));
        }
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try {
          msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg;
        } catch {
          /* keep default */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(fd);
  });
}

function _uploadFiles(comp: FlowComponent, key: string, files: File[], multiple: boolean): void {
  window.dispatchEvent(
    new CustomEvent("flow:upload-start", { detail: { key, count: files.length } }),
  );
  void (async () => {
    try {
      const refs: unknown[] = [];
      for (const f of files) refs.push(await _uploadOne(f, key));
      const value = multiple ? refs : refs[0];
      // reactive first (see set-trap note): ephemeral is the proxy's raw target.
      comp.reactive[key] = value;
      comp.ephemeral[key] = value;
      _debouncedModelSend(comp, key, value, 0);
      window.dispatchEvent(new CustomEvent("flow:upload-finish", { detail: { key } }));
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent("flow:upload-error", {
          detail: { key, error: String((err as Error).message ?? err) },
        }),
      );
    }
  })();
}

function _parseDelay(modifier: string): number {
  if (modifier.endsWith("ms")) return parseInt(modifier, 10);
  if (modifier.endsWith("s")) return parseInt(modifier, 10) * 1_000;
  return parseInt(modifier, 10) * 1_000;
}

function _setupPolling(comp: FlowComponent): void {
  (_intervals.get(comp.id) ?? []).forEach(clearInterval);

  const list: ReturnType<typeof setInterval>[] = [];
  const walker = document.createTreeWalker(comp.rootEl, NodeFilter.SHOW_ELEMENT);
  let node: Node | null = comp.rootEl;
  while (node) {
    const el = node as Element;
    if (_owns(comp, el)) {
      for (const attr of Array.from(el.attributes)) {
        if (!attr.name.startsWith("flow:poll")) continue;

        const modifier = attr.name.replace("flow:poll", "").replace(/^\./, "");
        const keepAlive = modifier.includes("keep-alive");
        const visible = modifier.includes("visible");
        const delayPart = modifier
          .replace("keep-alive", "")
          .replace("visible", "")
          .replace(/^\.+|\.+$/g, "")
          .replace(/\.\./, ".");
        const ms = delayPart ? _parseDelay(delayPart) : 5_000;
        const method = attr.value || "$refresh";

        list.push(
          setInterval(() => {
            if (visible) {
              const r = el.getBoundingClientRect();
              const inView = r.bottom > 0 && r.top < innerHeight;
              if (!inView) return;
            }
            if (document.hidden && !keepAlive) return;
            _callAction(comp, method, []);
          }, ms),
        );
      }
    }
    node = walker.nextNode();
  }
  _intervals.set(comp.id, list);
}

function _setupIntersect(comp: FlowComponent): void {
  (_observers.get(comp.id) ?? []).forEach((o) => o.disconnect());

  const list: IntersectionObserver[] = [];
  _ownedEls(comp, "[flow\\:intersect], [flow\\:intersect\\.leave]").forEach((el) => {
    const enter = el.getAttribute("flow:intersect");
    const leave = el.getAttribute("flow:intersect.leave");

    // Alpine x-intersect parity: `.once` fires enter once then disconnects; `threshold`
    // (half | full | 0..1) sets how much must be visible; `margin` sets the observer rootMargin
    // (e.g. "200px" to fire before the element enters). Surfaced as the intersectOnce /
    // intersectThreshold / intersectMargin JSX props.
    const once = el.hasAttribute("flow:intersect.once");
    const thRaw = el.getAttribute("flow:intersect.threshold");
    const threshold =
      thRaw === "full" ? 0.99 : thRaw === "half" ? 0.5 : thRaw != null ? Number(thRaw) : 0;
    const margin = el.getAttribute("flow:intersect.margin");
    const opts: IntersectionObserverInit = { threshold };
    if (margin) opts.rootMargin = margin;

    let wasVisible = false;
    const obs = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !wasVisible) {
          wasVisible = true;
          if (enter) _callAction(comp, enter, _parseArgs(el));
          if (once) obs.disconnect();
        } else if (!entry.isIntersecting && wasVisible) {
          wasVisible = false;
          if (leave) _callAction(comp, leave, _parseArgs(el));
        }
      }
    }, opts);
    obs.observe(el);
    list.push(obs);
  });
  _observers.set(comp.id, list);
}

type DragState = {
  item: Element;
  container: Element;
  group: string | null;
} | null;

let _dragState: DragState = null;

function _sortItems(container: Element): Element[] {
  return Array.from(container.children).filter(
    (c) => c.hasAttribute("flow:sort:item") && !c.hasAttribute("flow:sort:ignore"),
  );
}

function _setupSort(comp: FlowComponent): void {
  _ownedEls(comp, "[flow\\:sort]").forEach((container) => {
    if ((container as HTMLElement).dataset["flowSortBound"]) return;
    (container as HTMLElement).dataset["flowSortBound"] = "1";
    const group = container.getAttribute("flow:sort:group");

    container.addEventListener("dragstart", (e) => {
      const item = (e.target as Element).closest?.("[flow\\:sort\\:item]");
      if (!item || item.parentElement !== container) return;
      _dragState = { item, container, group };
      const dt = (e as DragEvent).dataTransfer;
      if (dt) {
        dt.effectAllowed = "move";
        dt.setData("text/plain", item.getAttribute("flow:sort:item") ?? "");
      }
    });

    container.addEventListener("dragover", (e) => {
      if (!_dragState) return;
      const sameContainer = _dragState.container === container;
      const sameGroup = group !== null && _dragState.group === group;
      if (!sameContainer && !sameGroup) return;
      e.preventDefault();

      const y = (e as DragEvent).clientY;
      const items = _sortItems(container).filter((i) => i !== _dragState!.item);
      let before: Element | null = null;
      for (const it of items) {
        const r = (it as HTMLElement).getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          before = it;
          break;
        }
      }
      if (before) container.insertBefore(_dragState.item, before);
      else container.appendChild(_dragState.item);
    });

    container.addEventListener("drop", (e) => {
      if (_dragState) e.preventDefault();
    });

    container.addEventListener("dragend", () => {
      if (!_dragState) return;
      const { item } = _dragState;
      _dragState = null;

      const targetContainer = item.parentElement;
      if (!targetContainer) return;

      const key = item.getAttribute("flow:sort:item");
      const pos = _sortItems(targetContainer).indexOf(item);
      const method = targetContainer.getAttribute("flow:sort");
      const owner = findComponentByEl(targetContainer);
      if (owner && method && key !== null && pos !== -1) {
        _callAction(owner, method, [key, pos]);
      }
    });
  });

  _ownedEls(comp, "[flow\\:sort\\:item]").forEach((node) => {
    const item = node as HTMLElement;
    if (item.dataset["flowSortItemBound"]) return;
    item.dataset["flowSortItemBound"] = "1";

    const handle = item.querySelector("[flow\\:sort\\:handle]");
    if (handle) {
      item.draggable = false;
      handle.addEventListener("mousedown", () => {
        item.draggable = true;
      });
      item.addEventListener("dragend", () => {
        item.draggable = false;
      });
      document.addEventListener("mouseup", () => {
        item.draggable = false;
      });
    } else {
      item.draggable = true;
    }
  });
}

function _refreshComponentFeatures(comp: FlowComponent): void {
  _setupPolling(comp);
  _setupIntersect(comp);
  _setupSort(comp);
}

// ── Lazy / defer loading ──────────────────────────────────────────────────────

function _setupLazyComponents(): void {
  // [data-flow-lazy]: load when enters viewport
  document.querySelectorAll<HTMLElement>("[data-flow-root][data-flow-lazy]").forEach((root) => {
    const id = root.dataset["flowId"];
    if (!id || _lazyObservers.has(id)) return;
    const comp = _components.get(id);
    if (!comp) return;

    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          obs.disconnect();
          _lazyObservers.delete(id);
          root.removeAttribute("data-flow-lazy");
          _callAction(comp, "$mount", []);
          break;
        }
      },
      { rootMargin: "100px" },
    );
    obs.observe(root);
    _lazyObservers.set(id, obs);
  });

  // [data-flow-defer]: load immediately after current paint cycle
  document.querySelectorAll<HTMLElement>("[data-flow-root][data-flow-defer]").forEach((root) => {
    const id = root.dataset["flowId"];
    if (!id) return;
    const comp = _components.get(id);
    if (!comp) return;
    root.removeAttribute("data-flow-defer");
    // Use requestIdleCallback if available, otherwise setTimeout
    const schedule =
      (window as unknown as { requestIdleCallback?: (fn: () => void) => void })
        .requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 0));
    schedule(() => _callAction(comp, "$mount", []));
  });
}

// ── Component scanning ────────────────────────────────────────────────────────

/** Scan the DOM for Flow component roots and hydrate any not yet tracked. */
function _scanComponents(): void {
  document.querySelectorAll<HTMLElement>("[data-flow-root][data-flow-id]").forEach((root) => {
    const id = root.dataset["flowId"];
    const name = root.dataset["flowName"];
    if (!id || !name || _components.has(id)) return;

    const stateEl = document.getElementById(`flow-state-${id}`);
    if (!stateEl) return;

    let snapshot: Snapshot;
    try {
      snapshot = JSON.parse(stateEl.textContent ?? "") as Snapshot;
    } catch {
      return;
    }

    // FlowComponent constructor sets up reactive/canonical/ephemeral state.
    const comp = new FlowComponent(root, snapshot);
    _components.set(id, comp);
    _syncFlowStore(comp);
    _restoreDrafts(comp); // seed empty draft-backed fields from localStorage before first paint
    _syncModelInputs(comp);
    _syncDeclarative(comp);
    _syncUrlParams(comp);
    _autoFocus(comp); // focus a flow:autofocus field on mount
    _setupPolling(comp);
    _setupIntersect(comp);
    _setupSort(comp);
    _setupSocketListeners(comp);
    _setupPresence(comp);
    _setupShared(comp);

    // Time-travel: seed the timeline with this component's initial (mount) frame. No-op unless
    // recording is enabled (dev). Runs only for newly-tracked roots (the `_components.has` guard
    // above), so a re-scan after a morph doesn't duplicate it.
    if (isTimelineEnabled()) {
      _recordTimelineFrame({
        compId: id,
        compName: name,
        action: "mount",
        snapshot,
        html: root.outerHTML,
      });
    }

    // Register @modelable child→parent map + reactive baselines from the SSR root,
    // so the first parent-pushed/child-originated change is diffed against a real baseline.
    const modelRaw = root.getAttribute("data-flow-model");
    if (modelRaw) {
      try {
        _modelMaps.set(id, JSON.parse(modelRaw) as Record<string, string>);
      } catch {
        /* ignore */
      }
    }
    const propsRaw = root.getAttribute("data-flow-props");
    if (propsRaw) {
      try {
        const props = JSON.parse(propsRaw) as Record<string, unknown>;
        const baseline = _modelBaselineFor(id);
        for (const [k, v] of Object.entries(props)) baseline.set(k, JSON.stringify(v));
      } catch {
        /* ignore */
      }
    }
  });

  _processTeleports();
  _setupLazyComponents();
}

// ── Cleanup disconnected components ───────────────────────────────────────────

function _cleanupDisconnected(): void {
  for (const [id, comp] of _components) {
    if (!document.contains(comp.rootEl)) {
      _components.delete(id);
      _errors.delete(id);
      _watchers.delete(id);
      _modelMaps.delete(id);
      _modelBaselines.delete(id);
      _offlineQueues.delete(id);
      _queues.delete(id); // per-component outbound frame chain
      clearTimeout(_loadingTimers.get(id)); // pending loading-delay timer
      _loadingTimers.delete(id);
      (_intervals.get(id) ?? []).forEach(clearInterval);
      _intervals.delete(id);
      (_observers.get(id) ?? []).forEach((o) => o.disconnect());
      _observers.delete(id);
      const obs = _lazyObservers.get(id);
      if (obs) {
        obs.disconnect();
        _lazyObservers.delete(id);
      }
      _teardownSocketListeners(id);
      _teardownPresence(id);
      _teardownShared(id);
      _optOps.delete(id);
      _pendingActionByComp.delete(id);
    }
  }
}

// ── Real-time @on('socket:…') listeners ───────────────────────────────────────
//
// A listener whose event name is `socket:CHANNEL,EVENT` (or socket-private: /
// socket-presence:) subscribes to a broadcast channel. When the broadcast
// arrives, the component's @on method runs server-side via a normal action frame —
// so a broadcast updates the component exactly like any other event.
//
// The client is bundled into this runtime and created on first use, so a page
// that declares a listener is live without the app shipping any script. That is
// not a convenience: these subscriptions used to be *silently inert* when the
// global was missing — no error, no warning — so a live feature with no script
// looked exactly like a live feature that was never written. An app that needs a
// configured client (a different host, its own auth endpoint) still sets
// `window.Socket` itself before the runtime loads, and that one wins.

/**
 * The broadcast client: whatever the app published, or one made on demand.
 *
 * Constructed on first use rather than at load, so an app with no realtime
 * feature never opens a second connection. `new Socket()` needs no arguments in
 * a browser — it derives its URL from `location` and posts to
 * `/broadcasting/auth` — which is exactly the wiring every app was writing by
 * hand.
 */
function _socketClient(): SocketClient {
  const w = window as unknown as { Socket?: SocketClient };
  return (w.Socket ??= new BundledSocket() as unknown as SocketClient);
}

/**
 * The client, but only if one already exists.
 *
 * Teardown and whisper paths use this: creating a connection in order to leave a
 * channel, or to whisper on a page that never joined one, would open a socket to
 * do nothing with it.
 */
function _existingSocketClient(): SocketClient | undefined {
  return (window as unknown as { Socket?: SocketClient }).Socket;
}

type SocketSub = { channel: string; kind: "" | "-private" | "-presence" };
const _socketSubs = new Map<string, SocketSub[]>();

/** Parse `socket[-private|-presence]:channel,event` → parts, or null if not a socket listener. @internal */
export function _parseSocketListener(
  name: string,
): { kind: SocketSub["kind"]; channel: string; event: string } | null {
  const m = /^socket(-private|-presence)?:/.exec(name);
  if (!m) return null;
  const kind = (m[1] ?? "") as SocketSub["kind"];
  const rest = name.slice(m[0].length);
  const ci = rest.lastIndexOf(","); // split on the LAST comma (channels may contain dots, not commas)
  if (ci === -1) return null;
  return { kind, channel: rest.slice(0, ci), event: rest.slice(ci + 1) };
}

interface SocketChannel {
  listen(event: string, cb: (payload: unknown) => void): SocketChannel;
  here?(cb: (payload: unknown) => void): SocketChannel;
  joining?(cb: (payload: unknown) => void): SocketChannel;
  leaving?(cb: (payload: unknown) => void): SocketChannel;
}
interface SocketClient {
  channel(name: string): SocketChannel;
  private(name: string): SocketChannel;
  join(name: string): SocketChannel;
  leave(name: string): void;
}

function _setupSocketListeners(comp: FlowComponent): void {
  // The snapshot decides whether this page needs a connection at all — asking
  // for the client first would open one on every page, including the ones with
  // nothing to subscribe to.
  const listeners = comp.snapshot.memo.listeners;
  if (!listeners) return;
  const client = _socketClient();

  const subs: SocketSub[] = [];
  for (const [name, method] of Object.entries(listeners)) {
    const parsed = _parseSocketListener(name);
    if (!parsed) continue;
    const { kind, channel, event } = parsed;

    const ch =
      kind === "-private"
        ? client.private(channel)
        : kind === "-presence"
          ? client.join(channel)
          : client.channel(channel);

    const cb = (payload: unknown) => _callAction(comp, method, [payload]);
    // Presence sub-events (here/joining/leaving) use their own methods; everything
    // else is a broadcast event delivered via .listen().
    if (kind === "-presence" && (event === "here" || event === "joining" || event === "leaving")) {
      ch[event]?.(cb);
    } else {
      ch.listen(event, cb);
    }
    subs.push({ channel, kind });
  }
  if (subs.length) _socketSubs.set(comp.id, subs);
}

function _teardownSocketListeners(id: string): void {
  const client = _existingSocketClient();
  const subs = _socketSubs.get(id);
  if (client && subs)
    for (const s of subs) {
      try {
        client.leave(s.channel);
      } catch {
        /* ignore */
      }
    }
  _socketSubs.delete(id);
}

// ── @presence channels ────────────────────────────────────────────────────────
// A component with @presence props carries its resolved channel(s) in memo.presence.
// Join each presence channel and, on here/joining/leaving, dispatch `$presence` so the
// server refills the member list and re-renders. Cursors/ephemeral state ride the same
// channel via client whispers (see _presenceChannelFor / whisper helpers below).

interface PresenceSocketChannel extends SocketChannel {
  whisper?(event: string, data: unknown): PresenceSocketChannel;
  listenForWhisper?(event: string, cb: (data: unknown) => void): PresenceSocketChannel;
}
const _presenceChannels = new Map<string, string[]>(); // componentId → joined channels

function _setupPresence(comp: FlowComponent): void {
  const presence = comp.snapshot.memo.presence;
  if (!presence || presence.length === 0) return;
  const client = _socketClient();

  const channels: string[] = [];
  for (const { channel } of presence) {
    const ch = client.join(channel);
    const refresh = (): void => _callAction(comp, "$presence", []);
    ch.here?.(refresh);
    ch.joining?.(refresh);
    ch.leaving?.(refresh);
    channels.push(channel);
  }
  if (channels.length) _presenceChannels.set(comp.id, channels);
}

function _teardownPresence(id: string): void {
  const client = _existingSocketClient();
  const channels = _presenceChannels.get(id);
  if (client && channels)
    for (const c of channels) {
      try {
        client.leave(c);
      } catch {
        /* ignore */
      }
    }
  _presenceChannels.delete(id);
}

/** The first presence channel joined for a component (for cursor/ephemeral whispers). */
function _presenceChannelFor(comp: FlowComponent): string | null {
  return _presenceChannels.get(comp.id)?.[0] ?? null;
}

/**
 * Broadcast ephemeral state (e.g. a cursor position) to the other members of the
 * component's presence channel — client-only, never hits the server or the DB. Pair with
 * `onWhisper`. No-op without `window.client` or a presence channel.
 */
function _whisper(comp: FlowComponent, event: string, data: unknown): void {
  const client = _existingSocketClient();
  const channel = _presenceChannelFor(comp);
  if (!client || !channel) return;
  (client.join(channel) as PresenceSocketChannel).whisper?.(event, data);
}

/** Listen for peers' whispers on the component's presence channel (e.g. cursor moves). */
function _onWhisper(comp: FlowComponent, event: string, cb: (data: unknown) => void): void {
  const client = _existingSocketClient();
  const channel = _presenceChannelFor(comp);
  if (!client || !channel) return;
  (client.join(channel) as PresenceSocketChannel).listenForWhisper?.(event, cb);
}

// ── @task cancellation ─────────────────────────────────────────────────────────
// Cancel a running @task. The task's action still occupies the component's serial send queue
// (its final patch hasn't arrived), so the cancel frame is sent OUT OF BAND — straight down the
// socket, bypassing the queue — and the server handles `$cancel` before hydrate/dispatch,
// aborting the task's AbortController. No-op when the socket isn't open.

function _cancelTask(comp: FlowComponent): void {
  const cancel = { type: "call", component: comp.id, method: "$cancel" };
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify(cancel));
  } else if (_httpMode) {
    // Out-of-band over HTTP (a separate POST); the server aborts the running task's controller.
    void fetch("/__flow/http", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(cancel),
    }).catch(() => {});
  }
}

// ── @shared channels ───────────────────────────────────────────────────────────
// A component with @shared props carries its resolved channel(s) in memo.shared. Join each
// channel and, on the `flow:shared` broadcast, dispatch `$shared` so the server re-reads
// the room store and re-renders — every subscriber converges to the same state. Shared and
// presence channels are joined the same way (client.join), so one room channel can carry both.

const SHARED_EVENT = "flow:shared";
const _sharedChannels = new Map<string, string[]>(); // componentId → joined channels

function _setupShared(comp: FlowComponent): void {
  const shared = comp.snapshot.memo.shared;
  if (!shared || shared.length === 0) return;
  const client = _socketClient();

  const channels: string[] = [];
  for (const { channel } of shared) {
    const converge = (): void => _callAction(comp, "$shared", []);
    client.join(channel).listen(SHARED_EVENT, converge);
    channels.push(channel);
  }
  if (channels.length) _sharedChannels.set(comp.id, channels);
}

function _teardownShared(id: string): void {
  const client = _existingSocketClient();
  const channels = _sharedChannels.get(id);
  if (client && channels)
    for (const c of channels) {
      try {
        client.leave(c);
      } catch {
        /* ignore */
      }
    }
  _sharedChannels.delete(id);
}

// ── @expose write guard ───────────────────────────────────────────────────────

/** True only for @expose properties (in snapshot, not @locked). */
function _isWritable(comp: FlowComponent, key: string): boolean {
  const entry = comp.snapshot.data[key];
  return !!(entry && !entry[1]?.["locked"]);
}

// ── Alpine magic registration ─────────────────────────────────────────────────

/**
 * Register $flow and $errors Alpine magic helpers.
 * Called from index.ts with the Alpine instance before Alpine.start().
 *
 * The $flow client API:
 *
 *   $flow.method(args)         — call an @expose method
 *   $flow.prop                 — read a reactive property
 *   $flow.prop = value         — write; inside a client expression that dispatches no
 *                                action, the write syncs to the server afterwards so
 *                                render() reflects it (client-only state → $store)
 *
 *   $flow.$refresh()           — re-render the component
 *   $flow.$commit()            — alias for $refresh
 *   $flow.$el                  — root DOM element
 *   $flow.$id                  — component id
 *   $flow.$name                — component class name
 *   $flow.$get('prop')         — explicit property read
 *   $flow.$set('prop', val)    — write + immediately sync to server
 *   $flow.$toggle('prop')      — toggle boolean + immediately sync
 *   $flow.$call('m', ...args)  — explicit method call
 *   $flow.$dispatch('evt', {}) — broadcast flow:evt on window
 *   $flow.$on('evt', fn)       — listen for flow:evt on window
 *   $flow.$watch('prop', fn)   — call fn(newVal, oldVal) on server patch
 */
export function registerFlowMagic(alpine: AlpineType): void {
  const _gelBuild = (el: Element) => {
    const root = el.closest<HTMLElement>("[data-flow-root]");
    const id = root?.dataset["flowId"];
    const comp = id ? _components.get(id) : undefined;

    return new Proxy({} as Record<string | symbol, unknown>, {
      get(_t, key: string | symbol): unknown {
        if (typeof key !== "string") return undefined;

        // Bare client-magic aliases: in JSX you write `this.dispatch(...)` /
        // `this.parent.x()` / `this.refresh()` / `this.store(...)` (typesafe, mirrors
        // the server methods); `this.` → `$flow.` makes that `$flow.dispatch`, etc.
        // Normalise those bare names to their `$`-prefixed magics here.
        if (_MAGIC_ALIASES.has(key)) key = "$" + key;

        // ── Built-in $ helpers ─────────────────────────────────────────────
        if (key === "$el") return comp?.rootEl;
        if (key === "$id") return comp?.id;
        if (key === "$name") return comp?.name;

        if (key === "$refresh" || key === "$commit") {
          return () => {
            if (comp) _callAction(comp, "$refresh", []);
          };
        }

        if (key === "$get") {
          return (prop: string) => comp?.reactive[prop];
        }

        if (key === "$set") {
          return (prop: string, val: unknown) => {
            if (!comp || !_isWritable(comp, prop)) return;
            // reactive first (see set-trap note): ephemeral is the proxy's raw target.
            comp.reactive[prop] = val;
            comp.ephemeral[prop] = val;
            _updateDirty(comp);
            _syncDeclarative(comp);
            _syncModelInputs(comp);
            _callAction(comp, "$set", [prop, val]);
          };
        }

        if (key === "$toggle") {
          return (prop: string) => {
            if (!comp || !_isWritable(comp, prop)) return;
            const next = !comp.reactive[prop];
            // reactive first (see set-trap note): ephemeral is the proxy's raw target.
            comp.reactive[prop] = next;
            comp.ephemeral[prop] = next;
            _updateDirty(comp);
            _syncDeclarative(comp);
            _syncModelInputs(comp);
            _callAction(comp, "$set", [prop, next]);
          };
        }

        if (key === "$call") {
          return (method: string, ...args: unknown[]) => {
            if (comp) _callAction(comp, method, args);
          };
        }

        // $whisper('cursor', {x,y}) / $onWhisper('cursor', cb) — broadcast/receive ephemeral
        // state to peers on this component's @presence channel (client-only; never hits the
        // server or the DB). Ideal for cursors and typing indicators.
        if (key === "$whisper") {
          return (event: string, data: unknown) => {
            if (comp) _whisper(comp, event, data);
          };
        }
        if (key === "$onWhisper") {
          return (event: string, fn: (data: unknown) => void) => {
            if (comp) _onWhisper(comp, event, fn);
          };
        }

        // $cancel() — stop the component's running @task (sent out-of-band; the server aborts
        // the task's AbortSignal, which the task observes via this.signal / this.cancelled).
        if (key === "$cancel") {
          return () => {
            if (comp) _cancelTask(comp);
          };
        }

        // $appendOptimistic(prop, item) / $removeOptimistic(prop, match) — optimistic list
        // mutations: apply to the reactive store instantly (a reactive <For>/x-for list shows them
        // at once), survive interim patches, reconcile/roll back when the owning action resolves.
        if (key === "$appendOptimistic") {
          return (prop: string, item: unknown) => {
            if (comp) _appendOptimistic(comp, prop, item);
          };
        }
        if (key === "$removeOptimistic") {
          return (prop: string, match: (item: unknown) => boolean) => {
            if (comp) _removeOptimistic(comp, prop, match);
          };
        }

        // $store — the "flow" Alpine store (app-wide, client-only UI state). It's a real Alpine
        // store, so reads inside a binding track and writes re-render with no round-trip. Declare
        // its shape with defineStore(); see store.ts.
        // $route('posts.show', { slug }) — the same helper the server renders
        // with, so a link built in an Alpine expression and one built in JSX
        // resolve identically. The table is installed from window.__zerotalRoutes
        // by the bundle entry (see installClientRoutes).
        if (key === "$route") return route;

        if (key === "$store") return clientStore();

        // $dispatch('event', {data}) — fire an event to every component on the page
        // (Alpine x-on listeners AND server @on listeners), matching this.dispatch().
        if (key === "$dispatch") {
          return (name: string, data: Record<string, unknown> = {}) => {
            _emitEvent(name, data);
          };
        }

        // $dispatchTo('ComponentName', 'event', {data}) — only that component class.
        if (key === "$dispatchTo") {
          return (toName: string, name: string, data: Record<string, unknown> = {}) => {
            _emitEvent(name, data, { toName });
          };
        }

        // $dispatchSelf('event', {data}) — only this component (no bubbling to others).
        if (key === "$dispatchSelf") {
          return (name: string, data: Record<string, unknown> = {}) => {
            _emitEvent(name, data, { selfId: comp?.id });
          };
        }

        if (key === "$on") {
          return (name: string, fn: (detail: unknown) => void) => {
            const handler = (e: Event) => fn((e as CustomEvent).detail);
            window.addEventListener(`flow:${name}`, handler);
          };
        }

        // $parent — call actions on / read state from the nearest ancestor component:
        //   $flow.$parent.showCreatePostForm()   $flow.$parent.someExposedProp
        if (key === "$parent") {
          const parentEl = comp?.rootEl.parentElement?.closest<HTMLElement>("[data-flow-root]");
          const parentId = parentEl?.dataset["flowId"];
          const parent = parentId ? _components.get(parentId) : undefined;
          return new Proxy({} as Record<string | symbol, unknown>, {
            get(_pt, pkey: string | symbol): unknown {
              if (typeof pkey !== "string" || !parent) return undefined;
              // Exposed/locked property → reactive value; anything else → server action.
              if (pkey in parent.snapshot.data) return parent.reactive[pkey];
              return (...args: unknown[]) => _callAction(parent, pkey, args);
            },
          });
        }

        if (key === "$watch") {
          return (prop: string, fn: WatchFn) => {
            if (!comp) return;
            let compMap = _watchers.get(comp.id);
            if (!compMap) {
              compMap = new Map();
              _watchers.set(comp.id, compMap);
            }
            let propSet = compMap.get(prop);
            if (!propSet) {
              propSet = new Set();
              compMap.set(prop, propSet);
            }
            propSet.add(fn);
          };
        }

        // ── Property read: key exists in snapshot data → reactive value ────
        if (comp && key in comp.snapshot.data) {
          return comp.reactive[key];
        }

        // ── Client-only URL helpers — after snapshot so a same-named prop wins.
        // `this.currentUrl(...)` / `this.navigateCurrent(...)` compile to these.
        if (key === "currentUrl") return _currentUrl;
        if (key === "navigateCurrent") return _navigateCurrent;

        // ── Method call: anything else is treated as a server action ───────
        return (...args: unknown[]) => {
          if (comp) _callAction(comp, key, args);
        };
      },

      set(_t, key: string | symbol, value: unknown): boolean {
        if (typeof key !== "string" || !comp || !_isWritable(comp, key)) return true;
        // Write through the reactive proxy FIRST. `reactive` is Alpine.reactive(ephemeral),
        // so ephemeral is its raw target — assigning ephemeral[key] beforehand would make
        // the proxy's setter see oldValue === value and skip the reactive trigger, leaving
        // native Alpine bindings (x-text/:class) stale until the next server patch.
        comp.reactive[key] = value;
        comp.ephemeral[key] = value;
        _updateDirty(comp);
        _syncDeclarative(comp);
        // flow:model inputs aren't Alpine-bound, so push the new value into them explicitly.
        _syncModelInputs(comp);
        // Inside a client expression, the write syncs to the server when the
        // expression dispatches no action of its own (see _beginExprEval).
        _noteExprWrite(key);
        return true;
      },
    });
  };
  alpine.magic("flow", _gelBuild);
  _gelMagicBuilder = _gelBuild as (el: Element) => unknown;

  // $errors — per-component validation error bag
  alpine.magic("errors", (el: Element) => {
    const root = el.closest<HTMLElement>("[data-flow-root]");
    const id = root?.dataset["flowId"] ?? "";

    return new Proxy({} as Record<string, unknown>, {
      get(_target, field: string | symbol) {
        if (typeof field !== "string") return undefined;
        const bag = _getErrors(id);

        if (field === "has") return (f: string) => !!(bag[f] && bag[f]!.length > 0);
        if (field === "first") return (f: string) => bag[f]?.[0] ?? "";
        if (field === "get") return (f: string) => bag[f] ?? [];
        if (field === "all") return () => bag;
        if (field === "any")
          return () => Object.keys(bag).some((k) => (bag[k] as string[]).length > 0);
        if (field === "clear")
          return (f?: string) => {
            if (f) {
              delete bag[f];
            } else {
              _errors.set(id, {});
            }
          };

        // Direct field access: $errors.email → first message string or ''
        return (bag[field] as string[] | undefined)?.[0] ?? "";
      },
    });
  });
}

// ── Modal Escape-to-close (the <Modal> component) ─────────────────────────────
//
// A <Modal show={this.open}> emits `data-flow-modal="open"` carrying the bound
// @expose prop name. Pressing Escape closes the top-most visible modal by setting
// that prop to false (locally + synced to the server), mirroring the backdrop /
// close-button click. Modals with no bound prop (fully custom onClose) opt out.

function _setupModalEscape(): void {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = Array.from(document.querySelectorAll<HTMLElement>("[data-flow-modal]")).filter(
      (el) => getComputedStyle(el).display !== "none",
    );
    const top = open[open.length - 1];
    if (!top) return;
    const name = top.dataset["flowModal"];
    if (!name) return;
    const comp = findComponentByEl(top);
    if (!comp || !_isWritable(comp, name)) return;
    // Close locally only — NO server round-trip, matching the backdrop / × paths
    // (which use the $flow set trap). reactive first (see set-trap note): ephemeral
    // is the proxy's raw target. The dirty-tracked change rides with the next action.
    comp.reactive[name] = false;
    comp.ephemeral[name] = false;
    _updateDirty(comp);
    _syncDeclarative(comp);
    _syncModelInputs(comp);
  });
}

// ── Bridge entry point ────────────────────────────────────────────────────────

/**
 * Dev-only: an error thrown during the initial GET render is embedded by the server as a JSON
 * `<script id="flow-boot-error">` (only under the dev worker). Read it on init and raise the same
 * error overlay an action throw would — so the very first paint failing lands in the overlay too.
 */
function _checkBootError(): void {
  const el = document.getElementById("flow-boot-error");
  if (!el) return;
  try {
    const info = JSON.parse(el.textContent ?? "{}") as {
      message?: string;
      name?: string;
      stack?: string;
      action?: string;
      component?: string;
    };
    if (info.message) showErrorOverlay({ ...info, message: info.message });
  } catch {
    /* malformed boot-error payload — ignore */
  }
}

export function initBridge(): void {
  _injectFlowStyles();
  _checkBootError(); // dev-only: an initial-render throw is embedded on the page → show the overlay
  _scanComponents();
  _processHead(); // hoist any SSR <Head> content into document.head
  _connect();
  _setupEventDelegation();
  _setupNavigationLinks();
  _setupModalEscape();
}
