// ── @zerotal/flow JSX runtime ───────────────────────────────────────────────────
//
// The `@zerotal/flow/jsx-runtime` entry — the automatic-JSX factory module the
// TypeScript/Bun toolchain resolves to when compiling `.tsx`. Configured via tsconfig:
// `{ "jsxImportSource": "@zerotal/flow" }`. It renders JSX straight to an HTML string
// (server-side), wiring Flow directives and embedding child Component placeholders.
// Apps do not call `jsx`/`jsxs` directly — the compiler emits those calls; the public
// surface here is the `HtmlNode` type and `Fragment`.

import { AsyncLocalStorage } from "node:async_hooks";
import { escapeHtml } from "@zerotal/core/helpers";
import { getExposedProps, getLockedProps } from "./decorators.ts";
import {
  _setExposedKeyCapture,
  _consumeExposedKeyCapture,
  _consumeExposedKeyReads,
} from "./utils.ts";
import { URL_ATTRIBUTES, sanitizeUrl } from "./urlSafety.ts";

/** The rendered output of a JSX element: an object carrying its serialized HTML string. */
export type HtmlNode = { html: string };

interface FlowDirectives {
  /** error={this.errors.field} — shows the field's first validation message, reactively. */
  error?: any;
  /** Input sync timing for value={…}/checked={…}: `live` syncs each keystroke, `blur` on blur. */
  live?: boolean;
  blur?: boolean;
  /** Coerce the bound value to a number before syncing (value={…} number). */
  number?: boolean;
  /** Trim whitespace from the bound value before syncing (value={…} trim). */
  trim?: boolean;
  /** Persist an unsubmitted input value to localStorage under this key (draft="post-body"). */
  draft?: string;
  /** Focus this field on mount, morph-safe (autoFocus). */
  autoFocus?: boolean;
  /** After a patch, focus this field if it becomes invalid — WCAG first-error focus (focusOnError). */
  focusOnError?: boolean;
  bindClass?: string | false | null | undefined;
  bindStyle?: Record<string, string | number>;
  bindHref?: string;
  bindAttr?: Record<string, string | number | boolean>;

  showOnLoading?: boolean | string;
  hideOnLoading?: boolean;
  loadingClass?: string;
  loadingClassRemove?: string;
  loadingAttr?: string;
  loadingTarget?: any;
  loadingTargetExcept?: any;
  delay?: boolean | string;

  showOnDirty?: boolean;
  hideOnDirty?: boolean;
  dirtyClass?: string;
  dirtyClassRemove?: string;
  dirtyAttr?: string;
  dirtyTarget?: any;

  navigate?: boolean;
  navigateHover?: boolean;
  navigatePreserveScroll?: boolean;
  current?: string;
  currentExact?: boolean;
  currentStrict?: boolean;

  cloak?: boolean;

  /** Move this element to a target selector on the client (e.g. teleport="body"). */
  teleport?: string;

  // ── Tier 3 UI plugins ───────────────────────────────────────────────────────
  /** Input mask, e.g. mask="(999) 999-9999" (@alpinejs/mask → x-mask). */
  mask?: string;
  /** Trap focus while the expression is truthy, e.g. trap="$flow.open" (x-trap). */
  trap?: string;
  /** Animate show/hide height — pair with a native x-show (@alpinejs/collapse → x-collapse). */
  collapse?: boolean;
  /** Position relative to another element, e.g. anchor="$refs.btn" (@alpinejs/anchor → x-anchor). */
  anchor?: string;

  /**
   * Gate the action behind a styled confirmation dialog. A string is the body
   * text; the object form configures the dialog (title, button labels, a `danger`
   * variant, a custom `icon`, or a type-to-confirm `prompt`).
   *
   * @example confirm="Delete this item?"
   * @example confirm={{ title: "Delete project", message: "This can't be undone.", danger: true, confirm: "Delete" }}
   * @example confirm={{ message: "Type the repo name to confirm.", prompt: "acme/web" }}
   */
  confirm?:
    | string
    | {
        message: string;
        title?: string;
        /** Confirm button label. */
        confirm?: string;
        /** Cancel button label. */
        cancel?: string;
        /** Visual style — `danger` (red, destructive) or `primary` (default). */
        variant?: "danger" | "primary";
        /** Shorthand for `variant: "danger"`. */
        danger?: boolean;
        /** Custom icon (emoji/text/SVG), or `false` to hide it. */
        icon?: string | false;
        /** Show a type-to-confirm input; Confirm unlocks when the value matches this. */
        prompt?: string;
      };

  /** Animate a show= element's enter/leave: `transition` (fade) or a preset string
   *  ("fade" | "scale" | "slide-up" | "slide-down" | "slide-left" | "slide-right"). */
  transition?: boolean | string | Record<string, any>;
  transitionIn?: Record<string, any>;
  transitionOut?: Record<string, any>;

  onInit?: any;
  onIntersect?: any;
  onIntersectLeave?: any;
  /** Fire onIntersect only once, then stop observing (x-intersect `.once`). */
  intersectOnce?: boolean;
  /** IntersectionObserver rootMargin, e.g. "200px" to fire before the element enters view. */
  intersectMargin?: string;
  /** How much must be visible before onIntersect fires: "half" | "full" | a 0..1 number. */
  intersectThreshold?: string | number;

  poll?:
    boolean | string | { every?: string; action?: any; keepAlive?: boolean; visible?: boolean };

  showOnOffline?: boolean;
  hideOnOffline?: boolean;
  offlineClass?: string;
  offlineClassRemove?: string;
  offlineAttr?: string;

  /** Show this element after an action fails (optimistic failed state); pair with `hideOnError`. */
  showOnError?: boolean;
  hideOnError?: boolean;

  ignore?: boolean;
  ignoreSelf?: boolean;

  ref?: any;

  replace?: boolean;
  replaceSelf?: boolean;

  show?: any;
  showImportant?: boolean;

  onSort?: any;
  sortItem?: any;
  sortGroup?: string;
  sortGroupId?: any;
  sortHandle?: boolean;
  sortIgnore?: boolean;

  stream?: string;
  streamReplace?: boolean;

  text?: any;

  // Fallbacks for the older flow:* syntax just in case
  [key: `flow:${string}`]: any;
}

// TypeScript resolves JSX element/attribute types by looking up a JSX namespace —
// there is no module-shaped way to provide it.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace JSX {
  export type Element = HtmlNode;

  export interface ElementChildrenAttribute {
    children: unknown;
  }

  /** Class components must look like a Flow Component (have render()). */
  export interface ElementClass {
    render(): unknown;
  }

  /** `key` is accepted on every element/component; `slots` supplies named slot content to child components. */
  export interface IntrinsicAttributes {
    key?: string | number;
    /** A child component's default slot — its plain children. */
    children?: unknown;
    /** Defer a child component's mount until its placeholder enters the viewport. */
    lazy?: boolean;
    /** Mount a child component right after the first paint (non-blocking). */
    defer?: boolean;
    /**
     * Render a child component's placeholder now and its real markup later on the
     * same response — no second round trip. For content that is definitely needed
     * and merely slow; use `lazy`/`defer` for content that may never be needed.
     */
    stream?: boolean;
    /**
     * Named slot content for a child component: `slots={{ header: <h2>…</h2>, footer: … }}`.
     * The child places each with `this.slot("header")`; its plain children are the default slot.
     */
    slots?: Record<string, Element | string | number | boolean | null | undefined>;
  }

  /**
   * Props for class components: every own field of the Component subclass becomes
   * an optional prop — `<CounterWidget label="…" step={5} />` seeds those
   * fields before onMount(). Base Component internals are excluded.
   */
  export type LibraryManagedAttributes<C, P> = C extends new () => infer I
    ? Partial<Omit<I, keyof import("./Component.ts").Component>> & IntrinsicAttributes
    : P;

  export interface IntrinsicElements {
    [tag: string]: Record<string, unknown> &
      FlowDirectives & {
        onClick?: any;
        onSubmit?: any;
        onChange?: any;
        onKeyDown?: any;
        onKeyUp?: any;
        onScroll?: any;
        // ... add others if needed, React types usually cover this but we don't depend on React types here
        [key: `on${string}`]: any;
      };
  }
}

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// Text-child escaping delegates to the framework's one escaper
// (@zerotal/core/helpers, Bun.escapeHTML underneath). It escapes quotes as
// well as & < > — a superset of what text nodes strictly need, which is
// harmless in content and keeps every runtime's output consistent.
// Attribute values still go through escapeAttr below, whose contract is
// coupled to this renderer's double-quoted-attribute splicing model.

/**
 * Escape a value for use inside a double-quoted HTML attribute — which is the only form
 * this renderer emits, so `'` needs no escaping.
 *
 * `<` and `>` do, and used not to be covered. A user-controlled attribute is spliced into
 * finished HTML alongside the child-placeholder comment (`<!--flow-child:…-->`), which a
 * blind `split`/`join` replaces wherever it appears — including inside an attribute value,
 * where the substituted child markup's own quotes then terminate the attribute early and
 * everything after it is parsed as markup.
 *
 * This is not what keeps a value out of an Alpine expression: an `x-on:*` / `:*` attribute
 * is executable code, and the browser hands Alpine the *decoded* value. Use
 * {@link jsLiteral} to embed a value in one.
 */
function escapeAttr(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Render context ────────────────────────────────────────────────────────────
// Scoped per-render via AsyncLocalStorage so concurrent top-level renders
// (e.g. two simultaneous GET requests each awaiting DB calls) cannot
// cross-contaminate their page reference or child-thunk lists.

/**
 * How a failed child render is rendered instead of propagating.
 *
 * Installed by `<ErrorBoundary>` onto the thunks whose tokens appear in its
 * children — see `_protectThunks`.
 */
export interface _ThunkBoundary {
  fallback: (error: unknown) => string;
}

interface _Thunk {
  token: string;
  run: () => Promise<HtmlNode>;
  boundary?: _ThunkBoundary;
}

interface _RenderCtx {
  page: Record<string, unknown>;
  thunks: _Thunk[];
  seq: number;
  /**
   * Per-render random suffix on the child-placeholder token.
   *
   * The splice that resolves child components is a blind `split`/`join` over finished HTML,
   * so any occurrence of the token gets replaced — including one a user put in a string.
   * Escaping in `escapeAttr`/`escapeHtml` is the actual control; this makes the token
   * unguessable so a path that ever misses an escape still cannot be aimed at.
   */
  nonce: string;
}

const _renderCtxStorage = new AsyncLocalStorage<_RenderCtx>();

/** @internal — returns the render context for the current async execution. */
function _getRenderCtx(): _RenderCtx | undefined {
  return _renderCtxStorage.getStore();
}

// ── Nested component thunks ───────────────────────────────────────────────────
// <CounterWidget step={5} /> can't render inline: jsx() is synchronous but a
// child render is async (onMount, dehydrate). jsx() therefore emits a unique
// comment token and queues a thunk; _renderFlowPage() runs the thunks
// SEQUENTIALLY after the parent render completes (sequential execution keeps
// the render context from interleaving) and splices the html in.

/**
 * Render a Component to HTML: establishes a per-request render context via
 * AsyncLocalStorage, awaits the page's render(), then resolves any nested
 * `<Component />` children queued during evaluation.
 * Used by the route handler, the WS dispatcher, and Component.child() (recursion
 * handles grandchildren — each recursive call gets its own ALS scope).
 */
export async function _renderFlowPage(
  page: object,
  render: () => Promise<HtmlNode>,
): Promise<string> {
  // Lifecycle: rendering() before, rendered(html) after — covers every render
  // path (initial GET, WS patch, nested children, tests) since they all route here.
  const hooks = page as {
    onRendering?: () => Promise<void>;
    onRendered?: (html: string) => Promise<void>;
  };
  if (typeof hooks.onRendering === "function") await hooks.onRendering();

  // Scope @computed memoization to this render pass: getters cache their result
  // while __flowComputing is set, and the cache is discarded when the pass ends.
  const _cc = page as Record<string, unknown>;
  _cc["__flowComputing"] = true;
  _cc["__flowComputed"] = new Map();
  const _endComputed = () => {
    _cc["__flowComputing"] = false;
    _cc["__flowComputed"] = undefined;
  };

  // ── AOT-compiled fast path ────────────────────────────────────────────────
  // Compiled render() functions emit HTML via string concatenation, bypassing
  // jsx(), getter instrumentation, and the thunk/token system entirely.
  if ((page.constructor as { __flowCompiled?: boolean }).__flowCompiled) {
    try {
      const node = await render();
      if (typeof hooks.onRendered === "function") await hooks.onRendered(node.html);
      return node.html;
    } finally {
      _endComputed();
    }
  }

  const ctx: _RenderCtx = {
    page: page as Record<string, unknown>,
    thunks: [],
    seq: 0,
    nonce: crypto.randomUUID().slice(0, 8),
  };

  let rendered: string;
  try {
    rendered = await _renderCtxStorage.run(ctx, async () => {
      // Temporarily instrument snapshot props so _resolveBindName can detect
      // which property was accessed when flow(this.prop) is evaluated.
      // We instrument both @expose and @locked (locked is in exposed by design).
      const exposed = getExposedProps(page);
      const savedDescs: Map<string, PropertyDescriptor | null> = new Map();
      for (const key of exposed) {
        const desc = Object.getOwnPropertyDescriptor(page, key);
        if (!desc) continue; // not an own property — cannot instrument
        if (desc.get) {
          // Already has a getter (e.g. Bun Stage 3 auto-accessor for decorated fields).
          // Wrap it so the key capture still fires on access.
          const origGet = desc.get;
          savedDescs.set(key, desc);
          Object.defineProperty(page, key, {
            ...desc,
            get() {
              _setExposedKeyCapture(key);
              return origGet.call(this);
            },
          });
        } else {
          // Plain data property — replace with a capture getter.
          const captured = desc.value as unknown;
          savedDescs.set(key, desc);
          Object.defineProperty(page, key, {
            get() {
              _setExposedKeyCapture(key);
              return captured;
            },
            set(v: unknown) {
              Object.defineProperty(page, key, {
                value: v,
                writable: true,
                configurable: true,
                enumerable: true,
              });
            },
            configurable: true,
            enumerable: true,
          });
        }
      }

      // Instrument Form fields too, so a nested binding (value={this.form.email})
      // captures the full path "form.email" — enabling Form binding in the runtime
      // renderer (the compiler resolves it from the AST instead).
      const savedFormDescs: Array<{
        form: Record<string, unknown>;
        field: string;
        desc: PropertyDescriptor;
      }> = [];
      for (const [key, savedDesc] of savedDescs) {
        // Read the ORIGINAL value (not the instrumented getter) to avoid polluting capture.
        const fv = savedDesc && !savedDesc.get ? savedDesc.value : undefined;
        if (
          !fv ||
          typeof fv !== "object" ||
          (fv as { __isFlowForm?: unknown }).__isFlowForm !== true
        )
          continue;
        const form = fv as Record<string, unknown>;
        for (const field of Object.keys(form)) {
          if (field.startsWith("_") || field === "rules" || typeof form[field] === "function")
            continue;
          const fdesc = Object.getOwnPropertyDescriptor(form, field);
          if (!fdesc || fdesc.get) continue;
          const fcap = `${key}.${field}`;
          const captured = fdesc.value as unknown;
          savedFormDescs.push({ form, field, desc: fdesc });
          Object.defineProperty(form, field, {
            get() {
              _setExposedKeyCapture(fcap);
              return captured;
            },
            set(v: unknown) {
              Object.defineProperty(form, field, {
                value: v,
                writable: true,
                configurable: true,
                enumerable: true,
              });
            },
            configurable: true,
            enumerable: true,
          });
        }
      }

      try {
        const node = await render();
        let html = node.html;
        for (const { token, run, boundary } of ctx.thunks) {
          let childHtml: string;
          try {
            childHtml = (await run()).html;
          } catch (error) {
            // Unprotected children still take the page down — a boundary is the
            // opt-in, and swallowing errors by default would hide real bugs.
            if (!boundary) throw error;
            childHtml = boundary.fallback(error);
          }
          html = html.split(token).join(childHtml);
        }
        return html;
      } finally {
        for (const [key, desc] of savedDescs) {
          if (desc) Object.defineProperty(page, key, desc);
        }
        for (const { form, field, desc } of savedFormDescs) {
          Object.defineProperty(form, field, desc);
        }
      }
    });
  } finally {
    _endComputed();
  }

  if (typeof hooks.onRendered === "function") await hooks.onRendered(rendered);
  return rendered;
}

/**
 * Resolve `bind={this.draft}` (a value) or `bind="draft"` (a name) to the
 * snapshot property name it refers to.
 *
 * `@locked` props are registered in BOTH `_exposedProps` and `_lockedProps`
 * by the @locked decorator (so they appear in the snapshot). This means
 * `getExposedProps()` already includes locked props.
 *
 * @param allowLocked - When false (default — for two-way bind attrs), locked
 *   props are filtered out of the search so they cannot be bound. When true
 *   (read-only attrs like `text`), the full exposed set (which includes locked)
 *   is used.
 */
export function _resolveBindName(
  value: unknown,
  attr: string,
  hint?: string,
  allowLocked = false,
): string {
  const page = _getRenderCtx()?.page ?? null;
  if (!page) {
    throw new Error(
      `[Flow] ${attr}={...} used outside a Component render. ` +
        `Use {...this.bind('propName')} instead.`,
    );
  }

  const exposed = getExposedProps(page); // already includes @locked props

  // When allowLocked = false (two-way bind), exclude @locked keys so they
  // can't be bound. When allowLocked = true (text, show…), use the full set.
  const keys = allowLocked
    ? exposed
    : (() => {
        const locked = getLockedProps(page);
        return locked.size === 0 ? exposed : new Set([...exposed].filter((k) => !locked.has(k)));
      })();

  // Name form: text="ticks" or bind="draft".
  if (typeof value === "string" && keys.has(value)) return value;

  // Capture fast path: the instrumented getter set _exposedKeyCapture when
  // this.propName was evaluated in the template. It's a single slot, and *all*
  // of an element's props are evaluated before jsx() runs — so a later binding
  // (e.g. class={"x " + this.accent}) overwrites the capture that text={this.count}
  // set. Guard with a value-identity check: only trust the captured key when its
  // current value is the one we're resolving, so text always binds to its own
  // property regardless of sibling bindings on the same element. A mismatch (a
  // stale capture, or a flow(expr) whose computed value differs from the property)
  // falls through to value-scan and the hint fallback below.
  const capturedKey = _consumeExposedKeyCapture();
  if (
    capturedKey &&
    keys.has(capturedKey) &&
    Object.is((page as Record<string, unknown>)[capturedKey], value)
  ) {
    return capturedKey;
  }

  // Value form fallback: text={someExpr} — match by identity.
  // When allowLocked is true we also explicitly scan @locked props in case
  // the Bun runtime's decorator implementation didn't register them in
  // _exposedProps (defence against any Stage 3 decorator edge-cases).
  const scanKeys = allowLocked ? new Set([...keys, ...getLockedProps(page)]) : keys;

  const candidates: string[] = [];
  for (const key of scanKeys) {
    if (Object.is((page as Record<string, unknown>)[key], value)) candidates.push(key);
  }

  // Deduplicate (a key may appear in both exposed and locked).
  const unique = [...new Set(candidates)];
  if (unique.length === 1) return unique[0]!;

  if (unique.length > 1) {
    if (hint && unique.includes(hint)) return hint;
    throw new Error(
      `[Flow] ${attr}={...} is ambiguous — multiple @expose props currently hold ` +
        `the same value (${unique.join(", ")}). ` +
        `Disambiguate with ${attr}="propName".`,
    );
  }

  // Last-chance: trust the hint key directly when value-identity matching
  // produced no candidates. This handles text={flow(expr)} where the
  // expression reads a property (capturing __key) but doesn't return the
  // property value itself (e.g. a conditional or computed string).
  if (hint && scanKeys.has(hint)) return hint;

  throw new Error(
    `[Flow] ${attr}={...} does not match any @expose property on ` +
      `${page.constructor?.name ?? "the page"}. ` +
      `Pass the property itself (e.g. ${attr}={this.draft}) or its name (${attr}="draft").`,
  );
}

/**
 * Non-throwing resolver for `value={this.x}` / `checked={this.x}` input bindings.
 * Returns the snapshot prop the value came from (confirmed via the instrumented-getter
 * capture AND a value-identity match, so a literal or server value never false-positives),
 * or null when the attribute is just an ordinary server-rendered value.
 * `locked` distinguishes @locked (read-only, reactive) from @expose (two-way).
 *
 * @remarks
 * The getter capture is a single slot and *all* of an element's props are evaluated
 * before `jsx()` runs, so any later prop that reads an exposed property clobbers it —
 * `value={this.destination} disabled={this.notSure}` leaves the capture pointing at
 * `notSure`. The freshness check then fails and the element renders with no
 * `flow:model` at all: the field accepts typing and nothing ever reaches the server.
 * When the capture is unusable we therefore fall back to a value-identity scan over
 * the exposed props, exactly as `_resolveBindName` does — binding correctly whenever
 * the answer is unambiguous, rather than silently dropping the binding.
 */
function _resolveValueBind(value: unknown): { name: string; locked: boolean } | null {
  const page = _getRenderCtx()?.page ?? null;
  if (!page) return null;
  const cap = _consumeExposedKeyCapture();
  const exposed = getExposedProps(page); // includes @locked

  // Dotted capture (e.g. "form.email") — a Form field. The root must be an exposed
  // prop and the nested value must identity-match (freshness guard). Form fields
  // are always writable (two-way), so locked is false.
  if (cap && cap.includes(".")) {
    const root = cap.slice(0, cap.indexOf("."));
    if (!exposed.has(root)) return null;
    const nested = cap
      .split(".")
      .reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), page);
    if (!Object.is(nested, value)) return null;
    return { name: cap, locked: false };
  }

  // Capture fast path: trust it only when it is fresh for THIS value (guards against
  // a stale capture lingering from a previous element that didn't consume it).
  if (cap && exposed.has(cap) && Object.is((page as Record<string, unknown>)[cap], value)) {
    _consumeExposedKeyReads(); // this element is resolved; don't leak reads to the next
    return { name: cap, locked: getLockedProps(page).has(cap) };
  }

  // The single slot was clobbered by a later prop on the same element (the B2 case:
  // `value={this.destination} disabled={this.notSure}`). Fall back to the keys actually
  // read while this element's props were evaluated, most recent first, and take the one
  // whose current value IS this value.
  //
  // Crucially this is NOT a scan of every exposed prop: a key only qualifies if it was
  // genuinely read through a `this.` getter, so a literal `value="CUSTOM"` that happens
  // to equal some property's current value still binds nothing.
  const reads = _consumeExposedKeyReads();
  for (const key of reads) {
    if (key === cap) continue; // already rejected above
    if (!exposed.has(key)) continue;
    if (!Object.is((page as Record<string, unknown>)[key], value)) continue;
    return { name: key, locked: getLockedProps(page).has(key) };
  }
  return null;
}

/**
 * Read a compiler-injected bind key for a binding prop off a component's props.
 *
 * The AOT bind-injection pass emits `__flowBinds={{ show: "sheetOpen" }}` for
 * `show={this.sheetOpen}` (and `bind`/`query`) on component elements, so a
 * binding component resolves its bound property statically — reliable even when
 * the runtime getter-capture was clobbered by a sibling/child binding, and
 * unambiguous when several props share a value (e.g. two `false`s). Binding
 * components consult this before `name=`/value-identity resolution. Returns null
 * when no injection is present (hand-written JSX, or a non-compiled page).
 */
export function _injectedBindKey(props: unknown, attr: string): string | null {
  const binds = (props as { __flowBinds?: Record<string, string> } | null)?.__flowBinds;
  const key = binds && binds[attr];
  return typeof key === "string" ? key : null;
}

/**
 * @internal Resolve a reactive prop value (e.g. `this.open`) to its snapshot
 * property name, or null when the value isn't a bound @expose/@locked prop.
 *
 * Native components (e.g. <Modal show={this.open} />) are plain functions that
 * receive their children already-evaluated, so the getter capture for `show` is
 * usually clobbered by a reactive child (e.g. an inner value={this.x}). We
 * therefore try the (freshness-checked) capture first, then fall back to a
 * value-identity match over the exposed props — unambiguous in the common case
 * where the bound prop's current value is unique among exposed props. When the
 * page was compiled, `_injectedBindKey` (consulted by the component first) makes
 * this path a fallback for hand-written / non-compiled JSX only.
 */
export function _resolveReactiveName(value: unknown): string | null {
  const viaCapture = _resolveValueBind(value);
  if (viaCapture) {
    // _resolveValueBind's freshness check re-reads the prop through the
    // instrumented getter, which re-arms the capture. Clear it so a following
    // sibling (e.g. a <Select>'s <option value> that equals the bound value)
    // can't falsely inherit this binding.
    _consumeExposedKeyCapture();
    return viaCapture.name;
  }

  const page = _getRenderCtx()?.page ?? null;
  if (!page) return null;
  const matches: string[] = [];
  for (const key of getExposedProps(page)) {
    try {
      if (Object.is((page as Record<string, unknown>)[key], value)) matches.push(key);
    } catch {
      /* skip throwing getters */
    }
  }
  _consumeExposedKeyCapture(); // the loop above re-armed the capture; clear it
  if (matches.length === 1) return matches[0]!;
  // Ambiguous: two+ @expose props currently hold this value (e.g. two `null`s), so
  // we can't tell which the binding meant. Drop it rather than guess — but WARN, since
  // a silently-unbound control is a nasty surprise. Pass an explicit name to fix it.
  if (matches.length > 1) {
    console.warn(
      `[Flow] A component binding is ambiguous: @expose props [${matches.join(", ")}] ` +
        `currently share the same value, so the bound prop can't be resolved by value. ` +
        `The control will render unbound. Pass an explicit \`name=\`/\`queryName=\` (or give the ` +
        `props distinct initial values) on ${page.constructor?.name ?? "the page"}.`,
    );
  }
  return null;
}

const PULSE_PROP_MAP: Record<string, string> = {
  poll: "flow:poll",
  confirm: "flow:confirm",
  bindClass: "flow:bind:class",
  bindHref: "flow:bind:href",
  showOnLoading: "flow:loading",
  hideOnLoading: "flow:loading.remove",
  loadingClass: "flow:loading.class",
  loadingClassRemove: "flow:loading.class.remove",
  loadingAttr: "flow:loading.attr",
  loadingTarget: "flow:target",
  loadingTargetExcept: "flow:target.except",
  delay: "flow:loading.delay",
  showOnDirty: "flow:dirty",
  hideOnDirty: "flow:dirty.remove",
  dirtyClass: "flow:dirty.class",
  dirtyClassRemove: "flow:dirty.class.remove",
  dirtyAttr: "flow:dirty.attr",
  dirtyTarget: "flow:target",
  navigate: "flow:navigate",
  navigateHover: "flow:navigate.hover",
  // One word on purpose: toFlowHtmlAttr() rewrites every `-` in a flow: attribute
  // to a `.`, so a hyphenated modifier would reach the DOM under a different name
  // here than the compiler emits.
  navigatePreserveScroll: "flow:navigate.preserve",
  current: "flow:current",
  currentExact: "flow:current.exact",
  currentStrict: "flow:current.strict",
  cloak: "flow:cloak",
  teleport: "flow:teleport",
  mask: "x-mask",
  trap: "x-trap",
  collapse: "x-collapse",
  anchor: "x-anchor",
  onInit: "flow:init",
  onIntersect: "flow:intersect",
  onIntersectLeave: "flow:intersect.leave",
  intersectOnce: "flow:intersect.once",
  intersectMargin: "flow:intersect.margin",
  intersectThreshold: "flow:intersect.threshold",
  showOnOffline: "flow:offline",
  hideOnOffline: "flow:offline.remove",
  offlineClass: "flow:offline.class",
  offlineClassRemove: "flow:offline.class.remove",
  offlineAttr: "flow:offline.attr",
  showOnError: "flow:failed",
  hideOnError: "flow:failed.remove",
  ignore: "flow:ignore",
  ignoreSelf: "flow:ignore.self",
  ref: "flow:ref",
  replace: "flow:replace",
  replaceSelf: "flow:replace.self",
  show: "flow:show",
  showImportant: "flow:show.important",
  transition: "flow:transition",
  autoFocus: "flow:autofocus",
  focusOnError: "flow:focus-error",
  draft: "flow:draft",
  onSort: "flow:sort",
  sortItem: "flow:sort:item",
  sortGroup: "flow:sort:group",
  sortGroupId: "flow:sort:group-id",
  sortHandle: "flow:sort:handle",
  sortIgnore: "flow:sort:ignore",
  stream: "flow:stream",
  streamReplace: "flow:stream.replace",
  text: "flow:text",
};

function toFlowHtmlAttr(k: string): string {
  if (!k.startsWith("flow:")) return k;
  const local = k.slice("flow:".length);
  return "flow:" + local.replace(/-/g, ".");
}

/**
 * Render a JSX child to its HTML string, escaping anything that is not already
 * an {@link HtmlNode}.
 *
 * @internal Exported for built-in components that need their children as markup
 * before the wrapper element is built — `<ErrorBoundary>` inspects the result
 * for child tokens, `<SectionContent>` publishes it elsewhere entirely.
 */
export function _renderChild(child: unknown): string {
  return renderChild(child);
}

/**
 * Route failures of the child components in `html` through `fallback`.
 *
 * `jsx()` has already queued a thunk for every `<Component />` encountered while
 * building `html`, but none of them have run yet — they resolve after the parent
 * render finishes. Matching on the tokens embedded in `html` is therefore enough
 * to say which pending children sit inside this boundary, without the boundary
 * needing to be told about them.
 *
 * A thunk already claimed by an inner boundary keeps it, so the nearest boundary
 * wins.
 *
 * @internal
 */
export function _protectThunks(html: string, fallback: (error: unknown) => string): void {
  const ctx = _getRenderCtx();
  if (!ctx) return;
  for (const thunk of ctx.thunks) {
    if (thunk.boundary === undefined && html.includes(thunk.token)) {
      thunk.boundary = { fallback };
    }
  }
}

function renderChild(child: unknown): string {
  if (child === null || child === undefined || child === false) return "";
  if (child === true) return "";
  if (typeof child === "string") return escapeHtml(child);
  if (typeof child === "number") return String(child);
  if (Array.isArray(child)) return child.map(renderChild).join("");
  if (typeof child === "object" && "html" in (child as object)) {
    return (child as HtmlNode).html;
  }
  return escapeHtml(String(child));
}

/**
 * Serialise a client-handler function to its source, verbatim, rewriting `this.`→`$flow.`
 * so it evaluates against the Alpine reactive proxy. The whole arrow ships (params + body);
 * the bridge auto-invokes it with the DOM event, mirroring Alpine's `x-on` semantics.
 *   () => this.x = 0          → "() => $flow.x = 0"
 *   (e) => { this.save(e) }   → "(e) => { $flow.save(e) }"
 *
 * Special case — a zero-arg arrow that is a single `this.method(...)` call commonly
 * closes over a loop variable:
 *   RANGES.map((r) => <button onClick={() => this.setRange(r)} />)
 * `toString()` only sees the *name* `r`, not its per-iteration value, so every button
 * would ship the same broken `$flow.setRange(r)` referencing a server-only variable.
 * {@link _captureLoopCall} resolves the real captured arguments and inlines them, so the
 * four buttons correctly emit `$flow.setRange('live')`, `'1h'`, `'24h'`, `'7d'`.
 */
function _clientExprFromFn(fn: { toString(): string }): string {
  const src = fn.toString();
  const call = /^\s*\(\s*\)\s*=>\s*this\.([A-Za-z_$][\w$]*)\s*\((.*)\)\s*;?\s*$/.exec(src);
  // Skip when the argument list itself reads `this` — that's a reactive client value
  // (e.g. `this.range`) which must stay an expression, not be frozen to a snapshot.
  if (call && typeof fn === "function" && !/\bthis\b/.test(call[2] ?? "")) {
    const inlined = _captureLoopCall(fn as () => void, call[1]!);
    if (inlined !== null) return inlined;
  }
  return _normaliseBooleanShorthand(src.replace(/\bthis\./g, "$flow."));
}

/**
 * Restore `false`/`true` from the `!1`/`!0` shorthand a JS engine's transpiler
 * may emit for boolean literals (Bun does this), so the client expression shipped
 * in the DOM is deterministic and readable regardless of how the handler source
 * was transpiled. Semantics are identical; only the surface form changes. The
 * `(?!\d)` guard keeps `!10`/`!17` (negated numbers) untouched.
 */
function _normaliseBooleanShorthand(expr: string): string {
  return expr.replace(/!1(?!\d)/g, "false").replace(/!0(?!\d)/g, "true");
}

/**
 * Resolve a `() => this.method(loopVar)` handler to `$flow.method(<value>)` by capturing
 * the real arguments. The arrow's lexical `this` is the component currently rendering
 * ({@link _getRenderCtx}.page), so we temporarily replace `method` on that instance with
 * a recorder and invoke the arrow: the closed-over args evaluate to their real values and
 * are recorded **without running the real action**. Returns null if capture isn't possible
 * (no render context, or the arrow's `this` isn't the active page) → caller falls back to
 * verbatim serialisation.
 */
function _captureLoopCall(fn: () => void, method: string): string | null {
  const page = _getRenderCtx()?.page;
  if (!page) return null;

  const target = page as Record<string, unknown>;
  const hadOwn = Object.prototype.hasOwnProperty.call(target, method);
  const original = target[method];
  let captured: unknown[] | null = null;
  try {
    target[method] = (...args: unknown[]): void => {
      captured = args;
    };
    fn();
  } catch {
    captured = null; // unexpected shape → fall back, never inline a guess
  } finally {
    if (hadOwn) target[method] = original;
    else delete target[method];
  }

  if (!captured) return null;
  return `$flow.${method}(${(captured as unknown[]).map(_jsLiteral).join(", ")})`;
}

/** Render a captured argument as a JS literal safe inside a (double-quoted, escaped) attribute. */
function _jsLiteral(v: unknown): string {
  if (typeof v === "string") return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (v === undefined) return "undefined";
  return JSON.stringify(v);
}

/**
 * The automatic-JSX element factory. Emitted by the compiler for every JSX element — not
 * called directly by application code. Renders an intrinsic tag (or a Flow Component /
 * function component) to an {@link HtmlNode}, applying `flow:*` directives along the way.
 * @internal
 */
export function jsx(
  type: string | ((props: Record<string, unknown>) => HtmlNode),
  props: Record<string, unknown> | null,
  _key?: unknown,
): HtmlNode {
  const p = props ?? {};

  if (typeof type === "function") {
    // Class component — a Flow Component used declaratively:
    //   <CounterWidget key="a" label="…" step={5} />
    // Detected by the $set built-in on the prototype (every Component has it).
    // Queued as a thunk and rendered by _renderFlowPage after the parent.
    if (
      (type as { prototype?: { __isFlowPage?: true } }).prototype?.__isFlowPage ||
      (type as { prototype?: { $set?: unknown } }).prototype?.$set
    ) {
      const renderCtx = _getRenderCtx();
      const parent = renderCtx?.page as unknown as
        | {
            child(
              c: unknown,
              o: {
                key?: string | number;
                props?: Record<string, unknown>;
                slots?: Record<string, string>;
                lazy?: boolean;
                defer?: boolean;
                stream?: boolean;
              },
            ): Promise<HtmlNode>;
          }
        | undefined;
      if (!parent || typeof parent.child !== "function") {
        throw new Error(
          `[Flow] <${(type as { name?: string }).name ?? "Component"} /> used outside a Component render.`,
        );
      }
      // Slots: the child's plain children become the "default" slot; a `slots={{ … }}`
      // prop supplies named slots. Both are rendered here — in the PARENT's scope — to
      // HTML, then handed to child() and carried in the child's snapshot. The child
      // places them with `this.slot(name)`.
      // `lazy`/`defer` control child-loading (they map to child() options, not props);
      // `children`/`slots` become slot content. Everything else is a prop for the child.
      const {
        children: _defaultSlot,
        slots: _namedSlots,
        lazy: _lazy,
        defer: _defer,
        stream: _stream,
        ...componentProps
      } = p;
      const slots: Record<string, string> = {};
      if (_defaultSlot !== undefined) {
        const rendered = renderChild(_defaultSlot);
        if (rendered) slots["default"] = rendered;
      }
      if (_namedSlots && typeof _namedSlots === "object") {
        for (const [name, node] of Object.entries(_namedSlots as Record<string, unknown>)) {
          if (node === undefined || node === null) continue;
          slots[name] = renderChild(node);
        }
      }
      const token = `<!--flow-child:${renderCtx!.nonce}:${renderCtx!.seq++}-->`;
      renderCtx!.thunks.push({
        token,
        run: () =>
          parent.child(type, {
            ...(_key !== undefined && _key !== null ? { key: _key as string | number } : {}),
            props: componentProps,
            ...(_lazy ? { lazy: true } : {}),
            ...(_defer ? { defer: true } : {}),
            ...(_stream ? { stream: true } : {}),
            ...(Object.keys(slots).length ? { slots } : {}),
          }),
      });
      return { html: token };
    }

    // Plain function component
    return type(p);
  }

  const attrs: string[] = [];
  let children = "";
  let hasChildren = false;
  let textAutoChild: string | null = null;
  // For `<select value={...}>`: a literal `value` attribute on a <select> is non-standard and
  // ignored by browsers — the displayed/submitted option is the one marked `selected`. We capture
  // the intended value here and mark the matching <option selected> after children are built.
  let selectValue: string | undefined;
  let textareaValue: string | undefined;

  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null) continue;

    // Internal: the compiler's bind-name injection (see _injectedBindKey). Consumed by
    // binding components to resolve their bound prop statically; never an HTML attribute.
    if (k === "__flowBinds") continue;

    if (k === "children") {
      children = renderChild(v);
      hasChildren = true;
      continue;
    }

    // One-way reactive text — text={this.time}:
    //   <div text={this.time} />  →  <div flow:text="time">15:33:59</div>
    // Emits the client directive AND injects the server value as children, so
    // the first paint shows real data and the bridge keeps it live (DRY: the
    // property is declared exactly once).
    if (k === "text") {
      let textV: unknown = v;
      let textHint: string | undefined =
        typeof p.name === "string" ? p.name : typeof p.id === "string" ? p.id : undefined;
      let isFlowChain = false;
      if (v && typeof v === "function" && (v as any).__isFlow) {
        const target = (v as any).__target;
        textV = typeof target === "function" ? (target as () => unknown)() : target;
        textHint = ((v as any).__key as string | undefined) ?? textHint;
        isFlowChain = true;
      }
      const name = _resolveBindName(textV, "text", textHint, true);
      const page = _getRenderCtx()?.page;
      // When flow() wraps a conditional/computed expression, the resolved property
      // value won't match the evaluated string (e.g. ticks=0 but textV="Reset").
      // In that case skip the flow:text directive and emit the evaluated text as
      // static content — the bridge has no way to re-evaluate the expression.
      if (isFlowChain && typeof textV === "string" && String(page?.[name] ?? "") !== textV) {
        textAutoChild = escapeHtml(textV);
      } else {
        attrs.push(`flow:text="${escapeAttr(name)}"`);
        textAutoChild = escapeHtml(String(page?.[name] ?? ""));
      }
      continue;
    }

    if (k === "dangerouslySetInnerHTML" && typeof v === "object") {
      children = (v as Record<string, string>)["__html"] ?? "";
      continue;
    }

    // error={this.errors.email} — the ErrorField sentinel carries its own field + message,
    // so no name recovery is needed. Emits flow:error + flow:show; SSR text = first message.
    if (k === "error" && v && typeof v === "object" && (v as any).__isErrorField === true) {
      const errField = (v as any).__field as string;
      const errValue = (v as any).__value as string;
      attrs.push(`flow:error="${escapeAttr(errField)}"`);
      attrs.push(`flow:show="errors.${escapeAttr(errField)}"`);
      textAutoChild = escapeHtml(errValue);
      continue;
    }

    // flow() proxy wrapper — flow(this.add).debounce('500ms'), flow(this.reset)…
    if (v && typeof v === "function" && (v as any).__isFlow) {
      const target = (v as any).__target;
      const modifiers = ((v as any).__modifiers || []).join(".");

      // Client expression — flow(() => this.ticks = 0) / flow(() => this.reset())
      // An anonymous arrow function signals a client-side expression.
      // The body is extracted via .toString() and `this.` is rewritten to `$flow.`
      // so it evaluates against the component's reactive proxy in the browser.
      // Emitted as flow:{event} so the bridge detects the $flow prefix and
      // evaluates it via Alpine instead of sending a WebSocket action.
      if (typeof target === "function" && !target.name && k.startsWith("on")) {
        const body = _clientExprFromFn(target as Function);
        const event = k.slice(2).toLowerCase();
        const base = `flow:${event}`;
        const attr = modifiers ? `${base}.${modifiers}` : base;
        attrs.push(`${attr}="${escapeAttr(body)}"`);
        continue;
      }

      let baseKey = "";
      if (k.startsWith("on")) {
        baseKey = `flow:${k.slice(2).toLowerCase()}`;
      } else if (PULSE_PROP_MAP[k]) {
        baseKey = PULSE_PROP_MAP[k];
      } else {
        baseKey = `flow:${k}`;
      }

      // Methods carry their own name; property values resolve against the page's @expose props.
      const targetName =
        typeof target === "function"
          ? target.name || ""
          : _resolveBindName(
              target,
              k,
              ((v as unknown as Record<string, unknown>)["__key"] as string | undefined) ??
                (typeof p.name === "string" ? p.name : typeof p.id === "string" ? p.id : undefined),
            );

      const attrName = modifiers ? `${baseKey}.${modifiers}` : baseKey;
      attrs.push(`${attrName}="${escapeAttr(targetName)}"`);
      continue;
    }

    // Standard event handlers (non-flow() functions; flow() values are handled above).
    // Bare `submit={this.method}` on a <form> is shorthand for onSubmit (→ flow:submit).
    if ((k.startsWith("on") || k === "submit") && typeof v === "function") {
      const event = k === "submit" ? "submit" : k.slice(2).toLowerCase();
      const src = Function.prototype.toString.call(v);
      // Detect an inline arrow by its SOURCE, not by `.name`: an arrow passed as a JSX prop
      // (onClick={() => …}) gets its name *inferred* from the prop ("onClick"), so `.name`
      // can't distinguish it from a real method reference. Method refs stringify as
      // `name(...) {…}` / `function …`; arrows stringify as `(…) => …` / `x => …`.
      const isArrow =
        !src.startsWith("function") && /^\s*(async\s+)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(src);
      const fnName = (v as { name?: string }).name;
      if (!isArrow && fnName && fnName !== "anonymous" && fnName !== "") {
        // Method reference — onClick={this.save} → server action.
        attrs.push(`flow:${event}="${escapeAttr(fnName)}"`);
      } else {
        // Inline arrow — onClick={(e) => this.x = 0} → client expression, emitted verbatim
        // (this.→$flow.); the bridge auto-invokes it with the event.
        attrs.push(
          `flow:${event}="${escapeAttr(_clientExprFromFn(v as (...a: unknown[]) => unknown))}"`,
        );
      }
      continue;
    }

    // `live` / `blur` (sync timing) and `number` / `trim` (value coercion) are input-binding
    // modifiers consumed by the value/checked handler below, never emitted as standalone attrs.
    if (k === "live" || k === "blur" || k === "number" || k === "trim") continue;

    // value={this.x} / checked={this.x} — the input binding (replaces `bind`).
    // @expose → two-way (flow:model[.live|.blur]); @locked → reactive read-only (:value + readonly).
    if (k === "value" || k === "checked") {
      // <select value={...}>: remember the value so the matching <option> can be marked `selected`
      // after children are built. A literal `value` attr on a <select> does not select an option.
      if (type === "select" && k === "value") selectValue = String(v ?? "");
      // <textarea value={...}>: same problem as <select>. A textarea has no `value`
      // content attribute — its value is its text content — so a literal one is
      // inert and the box renders empty until the client happens to sync it.
      // Remember it and emit it as the element's text below.
      if (type === "textarea" && k === "value") textareaValue = String(v ?? "");
      // An <option value={...}> is a plain attribute, never a two-way binding. Resolving it as one
      // would consume the value-capture meant for the enclosing <select> — leaving the <select>
      // unbound (or mis-attaching flow:model to the first option whose value matches). Emit it as an
      // ordinary attribute so the capture survives intact for the select that follows.
      if (type === "option" && k === "value") {
        attrs.push(`value="${escapeAttr(String(v ?? ""))}"`);
        continue;
      }
      // A radio's `value` is the option's identifier and its `checked` is a per-option
      // boolean — neither is a two-way binding target, and inferring one is actively
      // wrong. In a group rendered from a .map() the inference lands on whichever single
      // option currently equals the bound property, so that one radio claims the whole
      // group's model and overwrites the user's pick on every flush. Bind a radio group
      // explicitly with {...this.bind('prop', 'optionValue')}, which knows the group is
      // addressed as a unit.
      if (type === "input" && String(p["type"] ?? "") === "radio") {
        if (k === "value") attrs.push(`value="${escapeAttr(String(v ?? ""))}"`);
        else if (v) attrs.push("checked");
        continue;
      }
      const bound = _resolveValueBind(v);
      if (bound) {
        if (bound.locked) {
          attrs.push(`:${k}="$flow.${bound.name}"`);
          if (k === "value") attrs.push(`value="${escapeAttr(String(v ?? ""))}" readonly`);
          else {
            attrs.push("disabled");
            if (v) attrs.push("checked");
          }
        } else {
          const mod = p["blur"] ? ".blur" : p["live"] ? ".live" : "";
          attrs.push(`flow:model${mod}="${escapeAttr(bound.name)}"`);
          if (p["number"]) attrs.push("data-flow-number"); // `number` modifier → bridge coerces
          if (p["trim"]) attrs.push("data-flow-trim"); // `trim` modifier → bridge trims
          if (k === "value") attrs.push(`value="${escapeAttr(String(v ?? ""))}"`);
          else if (v) attrs.push("checked");
        }
        continue;
      }
      // else: ordinary server value — fall through to default attribute handling.
    }

    // show={this.x} / showImportant={this.x} — reactive visibility. The prop is evaluated to a
    // boolean before we see it, so capture the snapshot prop NAME (like value/checked) and emit
    // flow:show="<prop>"; the bridge then toggles display reactively off comp.reactive[prop].
    // Without this the generic boolean branch would emit a valueless `flow:show` and never react.
    if (k === "show" || k === "showImportant") {
      const bound = _resolveValueBind(v);
      if (bound) {
        attrs.push(`${PULSE_PROP_MAP[k]}="${escapeAttr(bound.name)}"`);
        continue;
      }
      // else: a literal/computed boolean (not a snapshot prop) — fall through; static show/hide.
    }

    // class={['base', condition && 'extra', ...]} — filter falsy, join
    if (k === "class" && Array.isArray(v)) {
      const cls = (v as unknown[]).filter(Boolean).join(" ");
      attrs.push(`class="${escapeAttr(cls)}"`);
      continue;
    }
    if (k === "className") {
      attrs.push(`class="${escapeAttr(String(v))}"`);
      continue;
    }
    if (k === "htmlFor") {
      attrs.push(`for="${escapeAttr(String(v))}"`);
      continue;
    }

    // A mapped value is the attribute name the compiler emits and the bridge queries
    // for, so it goes out verbatim. Running it through toFlowHtmlAttr() rewrote the
    // hyphen in `flow:focus-error` to a dot, and the runtime path then emitted an
    // attribute nothing listens for: `focusOnError` worked on a compiled page and did
    // nothing at all on one that fell back to the runtime, with no error either way.
    // The kebab→dot rewrite is for hand-written `flow:*` attributes only.
    const mapped = PULSE_PROP_MAP[k];
    const htmlKey = mapped ?? toFlowHtmlAttr(k);

    // Special object formatting for `confirm={{ message, title?, confirm?, cancel?,
    // variant?, danger?, icon?, prompt? }}`. The bare {message} and {message,prompt}
    // shapes keep their legacy attribute encoding; any richer object is serialised to
    // a single flow:confirm.opts JSON attribute that the styled dialog reads.
    if (k === "confirm" && typeof v === "object" && v !== null && "message" in v) {
      const cv = v as any;
      const rich =
        "title" in cv ||
        "confirm" in cv ||
        "cancel" in cv ||
        "variant" in cv ||
        "danger" in cv ||
        "icon" in cv;
      if (rich) {
        const opts: Record<string, unknown> = { message: cv.message };
        if (cv.title) opts["title"] = cv.title;
        if (cv.confirm) opts["confirmLabel"] = cv.confirm;
        if (cv.cancel) opts["cancelLabel"] = cv.cancel;
        if (cv.variant) opts["variant"] = cv.variant;
        else if (cv.danger) opts["variant"] = "danger";
        if (cv.icon !== undefined) opts["icon"] = cv.icon;
        if (cv.prompt) opts["prompt"] = cv.prompt;
        attrs.push(`${htmlKey}.opts="${escapeAttr(JSON.stringify(opts))}"`);
      } else if (cv.prompt) {
        attrs.push(`${htmlKey}.prompt="${escapeAttr(cv.message + "|" + cv.prompt)}"`);
      } else {
        attrs.push(`${htmlKey}="${escapeAttr(cv.message)}"`);
      }
      continue;
    }

    // Special formatting for `poll={{ every: '5s', action: this.refresh, ... }}`
    if (k === "poll" && typeof v === "object" && v !== null) {
      const pv = v as any;
      let finalKey = htmlKey;
      if (pv.every) finalKey += `.${pv.every}`;
      if (pv.keepAlive) finalKey += `.keep-alive`;
      if (pv.visible) finalKey += `.visible`;
      const actionName = pv.action?.name || "$refresh";
      attrs.push(`${finalKey}="${escapeAttr(actionName)}"`);
      continue;
    }

    // Reactive attribute binding — bindAttr={{ disabled: 'isSaving', title: 'tooltip' }}
    // Emitted as JSON (attr → state property name); the client bridge keeps the
    // attributes in sync with the component's reactive state.
    if (k === "bindAttr" && typeof v === "object" && v !== null) {
      attrs.push(`flow:bind:attr="${escapeAttr(JSON.stringify(v))}"`);
      continue;
    }

    // Style binding
    if (k === "bindStyle" && typeof v === "object" && v !== null) {
      const styleParts = [];
      for (const [sk, sv] of Object.entries(v as Record<string, string>)) {
        const kebab = sk.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
        // Escape single quotes in both key and value so the Alpine expression
        // string is always well-formed: bindStyle={{ color: "O'Brien red" }}
        const safeKey = kebab.replace(/'/g, "\\'");
        const safeVal = String(sv).replace(/'/g, "\\'");
        styleParts.push(`'${safeKey}': '${safeVal}'`);
      }
      attrs.push(`flow:bind:style="{ ${styleParts.join(", ")} }"`);
      continue;
    }

    // style={{ display: 'none', fontSize: '12px' }} → style="display: none; font-size: 12px"
    if (k === "style" && typeof v === "object" && v !== null) {
      const css = Object.entries(v as Record<string, string | number>)
        .map(([sk, sv]) => `${sk.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}: ${sv}`)
        .join("; ");
      attrs.push(`style="${escapeAttr(css)}"`);
      continue;
    }

    if (typeof v === "boolean") {
      if (v) attrs.push(htmlKey);
      continue;
    }

    // A URL-bearing attribute is executed, not just displayed, when its scheme says so —
    // `<a href={this.profile.website}>` with a `javascript:` value is one-click XSS from a
    // field a user typed into. Escaping does nothing about scheme; the scheme is checked.
    const raw = String(v);
    attrs.push(`${htmlKey}="${escapeAttr(URL_ATTRIBUTES.has(htmlKey) ? sanitizeUrl(raw) : raw)}"`);
  }

  if (textAutoChild !== null && !hasChildren) {
    children = textAutoChild;
  }

  // <select value={x}>: browsers ignore a literal `value` attribute on a <select> — the shown and
  // submitted option is the one carrying `selected`. Mark the matching <option> so the server-
  // rendered select reflects its bound value (otherwise it always falls back to the first option).
  if (type === "select" && selectValue !== undefined) {
    children = _selectMatchingOption(children, selectValue);
  }

  // <textarea value={x}>: the value is the element's text content. Written here
  // rather than as an attribute so the server-rendered box holds its value on
  // first paint — before any client sync, and with JavaScript off entirely.
  if (type === "textarea" && textareaValue !== undefined) {
    children = escapeHtml(textareaValue);
  }

  const a = attrs.length ? " " + attrs.join(" ") : "";

  return VOID_ELEMENTS.has(type)
    ? { html: `<${type}${a}>` }
    : { html: `<${type}${a}>${children}</${type}>` };
}

/**
 * Mark the first `<option>` whose value equals `value` as `selected`, so a server-rendered
 * `<select>` displays and submits its bound value. An option's value is its `value` attribute, or
 * (per HTML) its trimmed text content when no `value` attribute is present. If the author already
 * hard-coded a `selected` option, the markup is left untouched. No-op when nothing matches.
 */
function _selectMatchingOption(optionsHtml: string, value: string): string {
  if (/<option\b[^>]*\bselected\b/.test(optionsHtml)) return optionsHtml;
  const want = escapeAttr(value);
  let done = false;
  return optionsHtml.replace(
    /<option\b([^>]*)>([\s\S]*?)<\/option>/g,
    (full, optAttrs: string, inner: string) => {
      if (done) return full;
      const m = optAttrs.match(/\bvalue="([^"]*)"/);
      const optVal = m ? m[1] : escapeAttr(inner.trim());
      if (optVal === want) {
        done = true;
        return `<option${optAttrs} selected>${inner}</option>`;
      }
      return full;
    },
  );
}

/**
 * The multi-child variant of {@link jsx} (elements with static children). Aliased to `jsx`;
 * emitted by the compiler, not called directly.
 * @internal
 */
export const jsxs = jsx;

/**
 * JSX Fragment (`<>…</>`) — renders its children to a single {@link HtmlNode} with no
 * wrapper element.
 */
export function Fragment({ children }: { children?: unknown }): HtmlNode {
  return { html: renderChild(children) };
}

/** Extract the raw HTML string from a rendered {@link HtmlNode}. */
export function renderToString(node: HtmlNode): string {
  return node.html;
}
