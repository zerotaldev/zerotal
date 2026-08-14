import type { HtmlNode } from "./jsx-runtime.ts";
import type {
  FlashLevel,
  FlashMessage,
  FlashPosition,
  FlashAction,
  FlashActionStyle,
  FlashCallback,
} from "./types.ts";
import type { CurrentUrlOptions } from "./client/url.ts";
import {
  getExposedProps,
  getLockedProps,
  getValidateRules,
  getReactiveProps,
  getModelableProps,
} from "./decorators.ts";
import { _renderFlowPage } from "./jsx-runtime.ts";
import { getStreamStore, queueStream } from "./streaming.ts";
import { RuleBuilder, runValidationAsync } from "@zerotal/validator";
import type { Schema, FieldRuleDefinition } from "@zerotal/validator";
import type { ValidateBuilder } from "./decorators.ts";
import { ValidationError } from "./validation.ts";
import type { ValidationRules } from "./validation.ts";
import { resolveUploadValue } from "./uploads/TemporaryUploadedFile.ts";
import { toScriptJson } from "./utils.ts";
import { _compose } from "./mixins.ts";
import type { Compose } from "./mixins.ts";
import { _validateEventPayload } from "./events.ts";
import type { FlowEvents, EventName, EventArgs } from "./events.ts";
import { route, request, safeRedirectPath, HttpContext } from "@zerotal/core";

/**
 * Convert the validator's one-message-per-field result (`Record<string, string>`) into
 * Flow's error bag (`Record<string, string[]>`), which the `$errors` proxy + client expect.
 */
function _toErrorBag(errors: Record<string, string>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [field, msg] of Object.entries(errors)) out[field] = [msg];
  return out;
}

/** A signal that never aborts — returned by `Component.signal` outside a running `@task`. */
const _NEVER_ABORT: AbortSignal = new AbortController().signal;

// ── ErrorField sentinel ──────────────────────────────────────────────────────

/**
 * Sentinel returned by the {@link Component.errors} proxy when a field is accessed as a property
 * (`this.errors.email`). The JSX compiler detects `__isErrorField` and emits `flow:error` +
 * `flow:show`, so `error={this.errors.email}` wires up display of that field's first message.
 */
export class ErrorField {
  readonly __isErrorField = true as const;
  readonly __field: string;
  readonly __value: string;
  constructor(field: string, messages: string[]) {
    this.__field = field;
    this.__value = messages[0] ?? "";
  }
}

// ── ErrorsProxy ───────────────────────────────────────────────────────────────
// Returned by Component.errors. Provides:
//   this.errors.has("field")   → boolean
//   this.errors.field          → ErrorField (for error={this.errors.field})

export interface ErrorsProxy {
  /** True when the given field has at least one error. */
  has(field: string): boolean;
  /** True when any field has an error. */
  any(): boolean;
  /**
   * Add one or more validation errors manually.
   *
   * @example
   * this.errors.add("email", "Invalid email or password.");
   * this.errors.add({ email: "Invalid email or password." });
   * this.errors.add({ password: ["Too short", "Needs a number"] });
   */
  add(field: string, message: string): void;
  add(errors: Record<string, string | string[]>): void;
  /** Clear errors — all fields, or just the named one. */
  clear(field?: string): void;
  // Field access (`this.errors.email`) returns an ErrorField for `error={…}`.
  [field: string]: ErrorField | ((...args: never[]) => unknown);
}

interface ErrorsProxyHooks {
  read(): Record<string, string[]>;
  add(field: string, message: string): void;
  clear(field?: string): void;
}

function _makeErrorsProxy(hooks: ErrorsProxyHooks): ErrorsProxy {
  return new Proxy({} as ErrorsProxy, {
    get(_t, prop: string | symbol) {
      if (typeof prop !== "string") return undefined;
      if (prop === "has") {
        return (field: string) => {
          const msgs = hooks.read()[field];
          return Array.isArray(msgs) && msgs.length > 0;
        };
      }
      if (prop === "any") {
        return () => {
          const errors = hooks.read();
          return Object.keys(errors).some(
            (key) => Array.isArray(errors[key]) && errors[key].length > 0,
          );
        };
      }
      if (prop === "add") {
        return (fieldOrMap: string | Record<string, string | string[]>, message?: string) => {
          if (typeof fieldOrMap === "string") {
            hooks.add(fieldOrMap, message ?? "");
            return;
          }
          for (const [field, msg] of Object.entries(fieldOrMap)) {
            for (const m of Array.isArray(msg) ? msg : [msg]) hooks.add(field, m);
          }
        };
      }
      if (prop === "clear") {
        return (field?: string) => hooks.clear(field);
      }
      const msgs = hooks.read()[prop] ?? [];
      return new ErrorField(prop, msgs);
    },
  });
}

/** Escape a JSON string for embedding inside a single-quoted HTML attribute.
 *  The browser decodes the entities back to valid JSON in `el.dataset`. */
function _attrJson(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;");
}

// ── Internal effect bags ──────────────────────────────────────────────────────

/**
 * The bag of side effects an action queued (flashes, a redirect, client scripts, events,
 * downloads, a title, and the current error bag). Drained by {@link Component._drainEffects}
 * and read by the WebSocket handler to build the response frames sent to the client.
 */
export interface FlowEffects {
  flashes: FlashMessage[];
  redirectUrl: string | null;
  shouldRefresh: boolean;
  scripts: string[];
  errors: Record<string, string[]>;
  events: Array<{ name: string; data: Record<string, unknown>; to?: string; self?: boolean }>;
  downloads: Array<{ filename: string; content: string; mime: string }>;
  title: string | null;
}

// ── Redirect builder ───────────────────────────────────────────────────────────

/**
 * Builder returned by {@link Component.redirect} (and `redirectRoute`/`redirectIntended`) so a
 * flash can be chained onto the redirect, mirroring the HTTP ResponseBuilder API.
 *
 * @example
 * ```ts
 * return this.redirect("/", 303).withSuccess("Welcome back.");
 * ```
 */
export interface RedirectFlash {
  withSuccess(message: string): this;
  withError(message: string): this;
  withInfo(message: string): this;
  withWarning(message: string): this;
  /** Flash with an explicit level. */
  with(message: string, level: FlashLevel): this;
}

/**
 * Options accepted by `this.flash(message, options)` — the object form of the
 * fluent builder, for when config is computed dynamically. `type` is an alias
 * for `level` (Tailwind/Notyf parlance).
 */
export interface FlashOptions {
  level?: FlashLevel;
  /** Alias for `level`. */
  type?: FlashLevel;
  title?: string;
  position?: FlashPosition;
  /** Auto-dismiss after N ms. `0` keeps the toast until dismissed. */
  duration?: number;
  dismissible?: boolean;
  /** Custom icon (emoji/text), or `false` to hide the status icon. */
  icon?: string | false;
  progressBar?: boolean;
  /** Action buttons that each invoke a `@expose` method on click. */
  actions?: FlashAction[];
  /** A `@expose` method invoked when the toast is dismissed. */
  onClose?: FlashCallback;
}

/**
 * Fluent toast builder returned by `this.flash(...)`. Each setter mutates the
 * queued flash in place and returns the builder, so calls chain:
 *
 * @example
 * this.flash("Post deleted")
 *   .title("Removed")
 *   .warning()
 *   .position("top-center")
 *   .duration(8000)
 *   .progressBar();
 */
export interface FlashBuilder {
  /** Set the status level explicitly. */
  level(level: FlashLevel): this;
  success(): this;
  error(): this;
  warning(): this;
  info(): this;
  /** Bold header above the message. */
  title(title: string): this;
  /** Anchor this toast at a screen corner (overrides the `<Flash>` default). */
  position(position: FlashPosition): this;
  /** Auto-dismiss after `ms`. Pass `0` to keep it until the user dismisses it. */
  duration(ms: number): this;
  /** Keep the toast until dismissed (equivalent to `duration(0)`). */
  noAutoDismiss(): this;
  /** Show/hide the close (×) button. Defaults to `true`. */
  dismissible(value?: boolean): this;
  /** Override the status icon with emoji/text, or pass `false` to hide it. */
  icon(icon: string | false): this;
  /** Show a countdown progress bar. Defaults to `true`. */
  progressBar(value?: boolean): this;
  /**
   * Add an action button that invokes a `@expose` method on click (then dismisses).
   * Call it more than once to render multiple buttons. `method` is the method name;
   * `args` are forwarded to it; `style` is a color shorthand or a {@link FlashActionStyle}.
   *
   * @example
   * this.flash("Post deleted")
   *   .action("Undo", "restorePost", [postId], "info")
   *   .action("Delete forever", "purge", [postId], { color: "error", variant: "solid", uppercase: true });
   */
  action(label: string, method: string, args?: unknown[], style?: string | FlashActionStyle): this;
  /**
   * Invoke a `@expose` method when the toast is dismissed (timeout, ×, or action).
   *
   * @example this.flash("Heads up").noAutoDismiss().onClose("acknowledge");
   */
  onClose(method: string, args?: unknown[]): this;
}

// ── Component ──────────────────────────────────────────────────────────────────────

/**
 * Client-only URL helpers compile to `$flow.*` client expressions and never run on the
 * server. Reaching this means the call executed server-side — i.e. on a page the compiler
 * couldn't statically compile (so it fell back to the runtime renderer), or in a server action.
 */
function _clientOnlyUrlHelper(method: string): never {
  throw new Error(
    `[Flow] this.${method}() is client-only — the compiler rewrites it to \`$flow.${method}\`. ` +
      `It ran on the server, which means this page couldn't be statically compiled (e.g. it ` +
      `uses a construct the AOT compiler bails on) or you called it from a server action.`,
  );
}

/**
 * Base class for Flow pages — reactive server-side components rendered over a WebSocket.
 *
 * @remarks
 * A Flow component's state lives on the **server**. You subclass `Component`, hold state in
 * fields, and implement {@link render} to return an {@link HtmlNode} (authored in `.tsx` with
 * `jsxImportSource: "@zerotal/flow"`). The root element must carry `data-flow-root`.
 *
 * Only fields and methods the component opts into are reachable from the browser:
 * - `@expose` marks a field as reactive (streamed to the client, writable via `flow:model` /
 *   `$flow.$set`) or a method as a callable **action** (invoked over the socket, e.g. `flow:click`).
 * - `@locked` sends a field to the client read-only — it round-trips in the snapshot but the
 *   client cannot mutate it (enforced in {@link $set}).
 *
 * Between requests, the component is serialised into an **HMAC-signed snapshot** and rehydrated
 * on the next round-trip, so tampering with client-held state is rejected. When an action runs,
 * the server re-renders and streams a DOM diff that the browser applies via Alpine's morph —
 * only the changed HTML crosses the wire.
 *
 * Lifecycle hooks fire in order around each request: {@link onBoot} → ({@link onMount} on the
 * initial GET / {@link onHydrate} on round-trips) → property updates → the action →
 * {@link onUpdate} → {@link onRendering} → {@link render} → {@link onRendered} →
 * {@link onDehydrate}. Actions may emit side effects — flashes, redirects, events, downloads,
 * client scripts — which are drained after the action and folded into the response frame.
 *
 * @example
 * A counter with an exposed field and an action, bound reactively:
 * ```tsx
 * import { Component, expose } from "@zerotal/flow";
 *
 * export class Counter extends Component {
 *   @expose count = 0;
 *
 *   @expose increment() {
 *     this.count++;
 *   }
 *
 *   override async render() {
 *     return (
 *       <div data-flow-root>
 *         <p>{this.count}</p>
 *         <button flow:click="increment">+</button>
 *       </div>
 *     );
 *   }
 * }
 * ```
 *
 * @example
 * A form-style component with validation, a flash, and a redirect from an action:
 * ```tsx
 * import { Component, expose, locked } from "@zerotal/flow";
 *
 * export class ProfilePage extends Component {
 *   @locked userId = 0;
 *   @expose name = "";
 *
 *   @expose async save() {
 *     await this.validate({ name: (rule) => rule.required().min(2) });
 *     await User.update(this.userId, { name: this.name });
 *     return this.redirect("/dashboard").withSuccess("Profile saved.");
 *   }
 *
 *   override async render() {
 *     return (
 *       <div data-flow-root>
 *         <input {...this.bind("name")} />
 *         {this.errors.has("name") && <span>{this.errors.name}</span>}
 *         <button flow:click="save">Save</button>
 *       </div>
 *     );
 *   }
 * }
 * ```
 */
export abstract class Component {
  /**
   * Brand identifying Flow components — used for file-route detection.
   * @internal
   */
  static readonly __isFlowPage = true as const;

  /**
   * Compose one or more feature mixins onto this class, folding them left-to-right, so a page can
   * be built from focused, reusable behaviours instead of one bloated class.
   *
   * @remarks
   * Each mixin receives the accumulated base and returns an extended class, so `Component`'s full
   * surface (`flash()`, `redirect()`, `validate()`, the client magics, …) and every mixin's
   * `@expose`/`@locked` members flow through to the final page — fully type-checked. Mixin props
   * register on the mixin prototype, which sits in the page's prototype chain, so snapshot,
   * reactivity, client writes, and `@url` sync all work exactly as for props declared on the page.
   *
   * `using` composes onto whatever class it is called on, so it also works on an intermediate base
   * (`AdminPage.using(Pagination)` keeps `AdminPage` in the chain), and the composed class carries
   * `using` itself, so `Component.using(a, b).using(c)` chains past the 8-mixin overload set.
   *
   * Pages composed this way render via the runtime path rather than the AOT compiler (which only
   * statically sees a page's own `extends Component` plus locally-declared members) — the same
   * fallback complex pages already use; behaviour is identical, you just don't get the
   * ahead-of-time compile step for that page.
   *
   * @param mixins - Mixin factories applied left-to-right (each takes the prior result as its base).
   * @returns A class extending this one with every mixin's members mixed in.
   *
   * @example
   * ```tsx
   * // app/flow/mixins/pagination.ts
   * import { Component, expose, type Constructor } from "@zerotal/flow";
   *
   * export function Pagination<T extends Constructor<Component>>(Base: T) {
   *   abstract class WithPagination extends Base {
   *     @expose page = 1;
   *     @expose next() { this.page++; }
   *   }
   *   return WithPagination;
   * }
   *
   * // app/flow/UsersPage.tsx
   * class UsersPage extends Component.using(Pagination) {
   *   override async render() {
   *     return <div data-flow-root>Page {this.page}</div>;
   *   }
   * }
   * ```
   *
   * @category Composition
   */
  static using: Compose = _compose;

  // ── @internal: framework bookkeeping, not part of the developer API ──────────

  /** Set to true by hydrate() so the framework skips calling onMount(). @internal */
  _skipMount = false;

  /** Populated by flash() — read by the WS handler to emit flash frames. @internal */
  _flashes: FlashMessage[] = [];

  /** Set by redirect() — read by the WS handler to emit a redirect frame. @internal */
  _redirectUrl: string | null = null;

  /** Optional HTTP-style status passed to redirect() (advisory; client navigates regardless). @internal */
  _redirectStatus: number | null = null;

  /** Set by refresh() — re-runs onMount() before the action executes. @internal */
  _shouldRefresh = false;

  /**
   * Raw JS expressions queued by this.client() during an action.
   * Drained by _drainEffects() and forwarded to the client in the patch frame.
   * @internal
   */
  _clientScripts: string[] = [];

  /** Validation errors set by validate() / addError(). Included in the patch frame. @internal */
  _errors: Record<string, string[]> = {};

  /**
   * Typed access to this component's validation error bag.
   *
   * - `this.errors.has("field")` → `boolean`
   * - `this.errors.field` → an {@link ErrorField} for `error={this.errors.field}`
   * - `this.errors.add("field", "message")` → add an error manually
   * - `this.errors.add({ field: "message" })` → add several at once
   * - `this.errors.clear(field?)` → clear one field, or all
   *
   * @category Validation
   */
  get errors(): ErrorsProxy {
    return _makeErrorsProxy({
      read: () => this._errors,
      add: (field, message) => this.addError(field, message),
      clear: (field) => this.resetValidation(field),
    });
  }

  /** Cross-component events queued by dispatch(). Sent as EventFrames.
   *  `to` restricts delivery to components of that class name; `self` to this one. @internal */
  _events: Array<{ name: string; data: Record<string, unknown>; to?: string; self?: boolean }> = [];

  /** File downloads queued by download(). Sent as DownloadFrames. @internal */
  _downloads: Array<{ filename: string; content: string; mime: string }> = [];

  /** Dynamic document.title set by title(). Included in the patch frame. @internal */
  _titleValue: string | null = null;

  /** This component's id — set by the route handler (SSR) or the WS dispatcher. @internal */
  _flowId = "";

  /** The page route's path — inherited by nested children for middleware lookup. @internal */
  _flowPath = "";

  /** True when this instance was rebuilt from a snapshot (WS update render). @internal */
  _isHydrated = false;

  /** Child component ids collected during the current render (→ memo.children). @internal */
  _childIds: string[] = [];

  /** Child ids from the previous render (frame.snapshot.memo.children). @internal */
  _prevChildIds: string[] = [];

  /**
   * Named slot HTML this component received from its parent's template (`name → html`,
   * default slot keyed `"default"`). Populated by the parent's `child()` call and restored
   * from the snapshot on every round-trip. Read it in `render()` via `this.slot(name)`.
   * @internal
   */
  _flowSlots: Record<string, string> = {};

  /**
   * Live stream sender — attached by the WS dispatcher for the duration of an
   * action so this.stream() can push frames mid-execution. No-op during SSR.
   * @internal
   */
  _streamSender: ((ref: string, content: string, replace: boolean) => void) | null = null;

  /**
   * The cancellation signal for the currently-running `@task` action — attached by the WS
   * dispatcher for the task's duration, tripped when the client calls `this.cancel()`.
   * Null outside a task. Read it through {@link signal} / {@link cancelled}.
   * @internal
   */
  _taskSignal: AbortSignal | null = null;

  /**
   * The AbortSignal for the running `@task`. Pass it to `fetch`/an SDK, or check
   * `this.signal.aborted` in a loop, for cooperative cancellation. Outside a task it is an
   * already-inert signal that never aborts, so `@task` code reads the same regardless.
   *
   * @category Actions
   */
  get signal(): AbortSignal {
    return this._taskSignal ?? _NEVER_ABORT;
  }

  /**
   * True when the running `@task` has been cancelled from the client.
   * @category Actions
   */
  get cancelled(): boolean {
    return this._taskSignal?.aborted ?? false;
  }

  /**
   * Opt into durable/resumable snapshots: `static durable = true` (or `{ ttl, scope }`).
   * The signed snapshot is persisted server-side after every request, keyed by user (or
   * session) + route, and restored on a fresh GET so the user resumes exactly. See
   * {@link clearDurable} to drop the stored state on flow completion.
   *
   * @category State & exposure
   */
  static durable?: boolean | { ttl?: string; scope?: "user" | "session" };

  /** Set by {@link clearDurable}; the dispatcher deletes the durable entry after the request. @internal */
  _clearDurable = false;

  /**
   * Forget this component's durable snapshot at the end of the current request — call it when a
   * durable flow completes (a wizard finished, a form submitted) so the next visit starts fresh
   * instead of resuming the finished state. No-op unless the component opted into `static durable`.
   *
   * @category State & exposure
   */
  clearDurable(): void {
    this._clearDurable = true;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Called ONCE on the initial HTTP GET request.
   * Never called on subsequent WebSocket round trips (call `this.refresh()` to force it).
   *
   * Receives the route {@link HttpContext} — the same argument controllers get — so
   * dynamic-segment pages can read implicitly-bound models off `ctx.params`:
   *
   *     override async onMount(ctx: HttpContext) {
   *       this.accountId = (ctx.params.account as Account).id;
   *     }
   *
   * Bound models persist across WebSocket round-trips via Flow synths (store the model on a
   * `@locked`/`@expose` field), so they need not be re-resolved on every action.
   *
   * @param _ctx  the route {@link HttpContext} (initial GET only).
   * @category Lifecycle
   */
  async onMount(_ctx?: HttpContext): Promise<void> {}

  /**
   * Called once after the invoked action method completes, just before re-rendering.
   * Distinct from `onUpdated()`, which fires per client-driven property change.
   *
   * @category Lifecycle
   */
  async onUpdate(): Promise<void> {}

  /**
   * Called at the BEGINNING of every request for this component — both the initial
   * HTTP render and every subsequent WebSocket round-trip — after state is restored
   * (round-trips) or `@url`/`@session` seeded (initial), but before `onMount()` /
   * `onHydrate()`, property updates, and the action. Use for setup that must run on
   * every request. Receives the route {@link HttpContext} — note that on
   * WebSocket round-trips the URL is the stored route pattern, so raw `ctx.params` are
   * only populated on the initial GET; prefer `onMount()` for reading bound models.
   *
   * @category Lifecycle
   */
  async onBoot(_ctx?: HttpContext): Promise<void> {}

  /**
   * Called at the beginning of every SUBSEQUENT (WebSocket) request, right after the
   * component is rebuilt from its snapshot — never on the initial render (use
   * `onMount()` for that). Ideal for re-deriving non-persisted/protected state from
   * restored properties.
   *
   * @category Lifecycle
   */
  async onHydrate(): Promise<void> {}

  /**
   * Called at the END of every request, just before the component is serialised into
   * its snapshot. Use to normalise state back into a serialisable shape.
   *
   * @category Lifecycle
   */
  async onDehydrate(): Promise<void> {}

  /**
   * Called BEFORE a client-driven property update is applied (a `value`/`checked`
   * input or `$flow.$set`). Throw to reject the update. Only fires for writable
   * (`@expose`) properties. For a single property, define `onUpdating<Prop>(value, key?)`
   * — e.g. `onUpdatingEmail()`.
   *
   * @param prop  the property about to change
   * @param value the incoming value
   * @param key   for array properties, the element key being changed (else undefined)
   * @category Lifecycle
   */

  async onUpdating(_prop: string, _value: unknown, _key?: string): Promise<void> {}

  /**
   * Called AFTER a client-driven property update is applied. For a single property,
   * define `onUpdated<Prop>(value, key?)` — e.g. `onUpdatedUsername()` to normalise a
   * value such as lower-casing.
   *
   * @category Lifecycle
   */

  async onUpdated(_prop: string, _value: unknown, _key?: string): Promise<void> {}

  /**
   * Called BEFORE `render()` runs.
   *
   * @category Lifecycle
   */
  async onRendering(): Promise<void> {}

  /**
   * Called AFTER `render()` produces this component's HTML.
   * @param html the rendered HTML for this component
   * @category Lifecycle
   */

  async onRendered(_html: string): Promise<void> {}

  /**
   * Called when an action throws an unhandled error. Flow catches the error and
   * still re-renders; override to customise (log, swallow, re-flash). The default
   * flashes the message.
   *
   * @param error  the error thrown by the action.
   * @category Errors
   */
  async onError(error: Error): Promise<void> {
    this.flash(error.message, "error");
  }

  // ── Render ────────────────────────────────────────────────────────────────

  /**
   * Return the JSX that represents this page.
   * Must include a single root element with `data-flow-root`.
   *
   * @returns the rendered {@link HtmlNode} tree for this component.
   * @category Rendering
   */
  abstract render(): Promise<HtmlNode>;

  /**
   * Return the placeholder HTML shown while a lazy/deferred component loads.
   * Override this in child components that use `{ lazy: true }` or `{ defer: true }`.
   *
   * @example
   * override placeholder() {
   *   return <div class="skeleton animate-pulse h-24 w-full rounded-lg" />;
   * }
   *
   * @category Rendering
   */
  placeholder(): HtmlNode {
    return {
      html: '<div data-flow-lazy-placeholder style="min-height:1px;"></div>',
    };
  }

  /**
   * Wrap the rendered page root in a layout shell. `page` is the already-rendered
   * `<div data-flow-root>…</div>` node; return whatever JSX wraps it. The default is
   * no layout (returns `page` unchanged).
   *
   * This is the JSX-native alternative to `static layout = SomeLayout`: a layout is
   * just a component you wrap the page in, and its regions are ordinary props — the
   * same `Page.layout = (page) => <AppLayout>{page}</AppLayout>` convention the
   * framework's React/Inertia pages already use. `static layout` still works; when
   * both are present, this method wins.
   *
   * The shell renders once (on the initial GET) and stays outside the reactive root,
   * so it is not re-rendered or re-sent on WebSocket actions and survives SPA
   * navigation between pages that wrap with the same layout.
   *
   * @example
   * override layout(page: HtmlNode) {
   *   return <AppLayout title={ProfilePage.title} actions={<Save />}>{page}</AppLayout>;
   * }
   *
   * @param page  the already-rendered `<div data-flow-root>` page node to wrap.
   * @returns the wrapping shell (or `page` unchanged for no layout).
   * @category Rendering
   */
  layout(page: HtmlNode): HtmlNode | Promise<HtmlNode> {
    return page;
  }

  /**
   * Return the HTML the parent passed for a named slot, for placing inside this
   * component's `render()`. Call with no argument for the default slot (the child's
   * plain `children`), or a name for a named slot (`slots={{ header: … }}` on the parent).
   * Returns an empty node when the slot wasn't provided, so `{this.slot("footer")}`
   * is safe to leave in the template unconditionally.
   *
   * Slot content is rendered in the PARENT's scope and carried in this component's
   * snapshot, so it survives the child's own round-trips. Use `hasSlot()` to branch
   * on whether a slot was supplied (e.g. to omit a wrapping `<header>` entirely).
   *
   * @example
   * override async render() {
   *   return (
   *     <div class="card">
   *       {this.hasSlot("header") && <header>{this.slot("header")}</header>}
   *       <div class="body">{this.slot()}</div>
   *       {this.hasSlot("footer") && <footer>{this.slot("footer")}</footer>}
   *     </div>
   *   );
   * }
   *
   * @param name  the slot name; omit for the default slot.
   * @returns the slot's HTML, or an empty node when the slot was not provided.
   * @category Rendering
   */
  slot(name = "default"): HtmlNode {
    return { html: this._flowSlots[name] ?? "" };
  }

  /**
   * True when the parent supplied (non-empty) content for the given slot.
   * @category Rendering
   */
  hasSlot(name = "default"): boolean {
    const html = this._flowSlots[name];
    return typeof html === "string" && html.length > 0;
  }

  // ── Action helpers ────────────────────────────────────────────────────────

  /**
   * Emit a flash notification to the client.
   *
   * Returns a {@link FlashBuilder} so the toast can be configured fluently. The
   * second argument may also be a level string (back-compat) or a
   * {@link FlashOptions} object (for dynamic config):
   *
   * @example
   * this.flash("Saved");                              // success toast
   * this.flash("Bad input", "error");                 // level shorthand
   * this.flash("Saved", { type: "success", duration }); // options object
   * this.flash("Post deleted").warning().duration(8000).progressBar();
   *
   * @param message         the toast text.
   * @param optionsOrLevel  a {@link FlashLevel} shorthand or a {@link FlashOptions} object.
   * @returns a {@link FlashBuilder} for fluent configuration.
   * @category Actions
   */
  flash(message: string, optionsOrLevel: FlashLevel | FlashOptions = "success"): FlashBuilder {
    const payload: FlashMessage =
      typeof optionsOrLevel === "string"
        ? { message, level: optionsOrLevel }
        : { message, level: optionsOrLevel.level ?? optionsOrLevel.type ?? "success" };

    // Copy through any options provided on the object form.
    if (typeof optionsOrLevel === "object") {
      const o = optionsOrLevel;
      if (o.title !== undefined) payload.title = o.title;
      if (o.position !== undefined) payload.position = o.position;
      if (o.duration !== undefined) payload.duration = o.duration;
      if (o.dismissible !== undefined) payload.dismissible = o.dismissible;
      if (o.icon !== undefined) payload.icon = o.icon;
      if (o.progressBar !== undefined) payload.progressBar = o.progressBar;
      if (o.actions !== undefined) payload.actions = o.actions;
      if (o.onClose !== undefined) payload.onClose = o.onClose;
    }

    this._flashes.push(payload);

    // The builder mutates the queued payload in place — `_drainEffects` reads it
    // after the action returns, so chained setters land before it's serialized.
    const builder: FlashBuilder = {
      level: (l) => ((payload.level = l), builder),
      success: () => ((payload.level = "success"), builder),
      error: () => ((payload.level = "error"), builder),
      warning: () => ((payload.level = "warning"), builder),
      info: () => ((payload.level = "info"), builder),
      title: (t) => ((payload.title = t), builder),
      position: (p) => ((payload.position = p), builder),
      duration: (ms) => ((payload.duration = ms), builder),
      noAutoDismiss: () => ((payload.duration = 0), builder),
      dismissible: (v = true) => ((payload.dismissible = v), builder),
      icon: (i) => ((payload.icon = i), builder),
      progressBar: (v = true) => ((payload.progressBar = v), builder),
      action: (label, method, args, style) => {
        const s: FlashActionStyle = typeof style === "string" ? { color: style } : (style ?? {});
        (payload.actions ??= []).push({
          label,
          method,
          ...(args ? { args } : {}),
          ...(s.color ? { color: s.color } : {}),
          ...(s.variant ? { variant: s.variant } : {}),
          ...(s.uppercase ? { uppercase: true } : {}),
        });
        return builder;
      },
      onClose: (method, args) => (
        (payload.onClose = { method, ...(args ? { args } : {}) }),
        builder
      ),
    };
    return builder;
  }

  /**
   * Redirect the client to `url` after the current action completes.
   *
   * Returns a builder so a flash can be chained (mirrors the HTTP ResponseBuilder):
   *
   * @example
   * this.redirect("/dashboard");
   * return this.redirect(next || "/", 303).withSuccess("Welcome back.");
   * return this.redirect("/login").withError("Please sign in.");
   *
   * @param url     Destination URL.
   * @param status  Optional HTTP-style status (advisory — the client navigates regardless).
   * @returns a {@link RedirectFlash} builder for chaining a flash onto the redirect.
   * @category Navigation & redirects
   */
  redirect(url: string, status?: number): RedirectFlash {
    this._redirectUrl = url;
    this._redirectStatus = status ?? null;
    // Two `this` scopes meet here: the builder methods chain on the builder while
    // flashing through the component, so the alias is load-bearing.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const builder: RedirectFlash = {
      with(message: string, level: FlashLevel) {
        self.flash(message, level);
        return this;
      },
      withSuccess(message: string) {
        return this.with(message, "success");
      },
      withError(message: string) {
        return this.with(message, "error");
      },
      withInfo(message: string) {
        return this.with(message, "info");
      },
      withWarning(message: string) {
        return this.with(message, "warning");
      },
    };
    return builder;
  }

  /**
   * Redirect to a named route.
   * Route params fill `:segment` placeholders; any extra keys become query-string params.
   *
   * @example
   * return this.redirectRoute("profile", { id: 1 }).withSuccess("Saved.");
   * this.redirectRoute("posts.show", { slug: "hello", ref: "email" }); // /posts/hello?ref=email
   *
   * @param name    The route name registered with `.name(...)`.
   * @param params  Route + query params.
   * @param status  Optional HTTP-style status (advisory — the client navigates regardless).
   * @returns a {@link RedirectFlash} builder for chaining a flash onto the redirect.
   * @category Navigation & redirects
   */
  redirectRoute(
    name: string,
    params: Record<string, string | number> = {},
    status?: number,
  ): RedirectFlash {
    return this.redirect(route(name, params), status);
  }

  /**
   * Redirect the user back to where they were headed before being intercepted. Reads
   * (and clears) the `intended_url` stored in the session by `AuthMiddleware`, falling
   * back to `fallback` when none is stored or the stored URL is cross-origin
   * (open-redirect guard).
   *
   * @example
   * if (await Auth.attempt(creds)) return this.redirectIntended("/dashboard");
   *
   * @param fallback  URL to use when no intended URL is available. Defaults to `/`.
   * @param status    Optional HTTP-style status (advisory — the client navigates regardless).
   * @returns a {@link RedirectFlash} builder for chaining a flash onto the redirect.
   * @category Navigation & redirects
   */
  redirectIntended(fallback = "/", status?: number): RedirectFlash {
    const ctx = request() as unknown as {
      session?: { get<T>(k: string): T | undefined; forget(k: string): void };
      url?: { origin: string };
    };
    const stored = ctx.session?.get<string>("intended_url");
    if (stored) ctx.session?.forget("intended_url");
    const target = safeRedirectPath(stored, ctx.url?.origin ?? "") ?? fallback;
    return this.redirect(target, status);
  }

  /**
   * Force `onMount()` to run again on the CURRENT WebSocket round trip.
   * Use this to reload external data without requiring a full page reload.
   *
   * @category Actions
   */
  async refresh(): Promise<void> {
    this._shouldRefresh = true;
  }

  /**
   * Queue a raw JavaScript expression to be evaluated in the browser
   * after the current action's DOM patch is applied.
   *
   * The expression runs in the Alpine context of the component root element:
   * `$el`, `$refs`, and other Alpine magic properties are all available.
   *
   * Multiple calls are batched and executed in order after the single round trip.
   *
   * @example
   * this.client(`$refs.titleInput.focus()`);
   * this.client(`$el.querySelector('.toast').classList.add('visible')`);
   *
   * @security Never interpolate unescaped user input into the expression string.
   * @category Actions
   */
  client(script: string): void {
    this._clientScripts.push(script);
  }

  /**
   * Gets the current title value.
   * @category Actions
   */
  title(): string;

  /**
   * Update `document.title` in the browser after this action completes.
   *
   * @example
   * this.title(`Search: ${this.query}`);
   *
   * @category Actions
   */
  title(value: string): void;

  // Implementation signature (hidden from the public API)
  title(value?: string): void | string {
    if (value === undefined) {
      return this._titleValue ?? (this.constructor as { title?: string }).title ?? "";
    }
    this._titleValue = value;
  }

  // ── Validation ────────────────────────────────────────────────────────────

  /**
   * Validate page properties against rules. If validation fails, errors are
   * stored and a `ValidationError` is thrown (caught by the framework, which
   * re-renders the page with `$errors` populated client-side).
   *
   * Pass explicit rules or omit to use `@validate` decorator rules.
   *
   * **Error persistence:** validation errors survive across actions and are
   * re-sent on every patch until the next `validate()` call clears them (on
   * success) or `resetValidation()` is called explicitly. If you want errors
   * cleared at the start of every action, call `this.resetValidation()` before
   * the new `validate()` call.
   *
   * @example
   * async save() {
   *   this.validate({
   *     email:    (rule) => rule.required().email(),
   *     password: (rule) => rule.required().min(8),
   *   });
   *   // reaches here only if valid
   * }
   *
   * @param rulesOrForm  explicit per-field rules, a {@link Form} instance to validate, or
   *                     omit to use the component's `@validate` decorator rules.
   * @throws {ValidationError} when validation fails — the framework catches it and re-renders
   *   with `this.errors` populated.
   * @category Validation
   */
  async validate(
    rulesOrForm?:
      ValidationRules | { __isFlowForm: true; _validateToErrors(): Record<string, string[]> },
  ): Promise<void> {
    // Validating a Form object: delegate to its @zerotal/validator schema.
    if (rulesOrForm && typeof rulesOrForm === "object" && "__isFlowForm" in rulesOrForm) {
      const errors = (
        rulesOrForm as { _validateToErrors(): Record<string, string[]> }
      )._validateToErrors();
      if (Object.keys(errors).length > 0) {
        this._errors = errors;
        throw new ValidationError(errors);
      }
      this._errors = {};
      return;
    }

    // Use explicit per-field rules, or fall back to the @validate decorator rules. Both are
    // builders over @zerotal/validator's RuleBuilder — Flow delegates the engine.
    const builders: Map<string, ValidateBuilder> =
      rulesOrForm !== undefined
        ? new Map(Object.entries(rulesOrForm as ValidationRules))
        : getValidateRules(this);

    const schema = this._buildSchema(builders);

    // Validate against the full exposed-props data bag (so cross-field rules like `confirmed`
    // can see the other fields).
    const outcome = await runValidationAsync(schema, this._exposedData());

    if (!outcome.success) {
      this._errors = _toErrorBag(outcome.errors);
      throw new ValidationError(this._errors);
    }
    this._errors = {};
  }

  /** @internal Build a validator `Schema` from a field→builder map. */
  _buildSchema(builders: Map<string, ValidateBuilder>): Schema {
    const schema: Schema = {};
    const rule = new RuleBuilder();
    for (const [field, build] of builders) {
      schema[field] = build(rule)._def as FieldRuleDefinition;
    }
    return schema;
  }

  /** @internal Snapshot of every exposed prop's current value, for validation input. */
  _exposedData(): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const key of getExposedProps(this)) {
      data[key] = (this as Record<string, unknown>)[key];
    }
    return data;
  }

  /**
   * @internal Real-time validation of a SINGLE field against its `@validate` rule.
   * Sets or clears `this._errors[field]` without throwing, so it can run on
   * every client update. No-op for fields without a `@validate` rule.
   */
  async _validateField(field: string): Promise<void> {
    const build = getValidateRules(this).get(field);
    if (!build) return;

    const schema = this._buildSchema(new Map([[field, build]]));
    const outcome = await runValidationAsync(schema, this._exposedData());

    if (!outcome.success && outcome.errors[field]) {
      this._errors[field] = [outcome.errors[field]];
    } else {
      delete this._errors[field];
    }
  }

  /**
   * Manually add a validation error for a field.
   *
   * @example
   * this.addError('email', 'That email is already taken.');
   *
   * @category Validation
   */
  addError(field: string, message: string): void {
    if (!this._errors[field]) this._errors[field] = [];
    this._errors[field]!.push(message);
  }

  /**
   * Clear validation errors — all fields, or just the specified field.
   *
   * @example
   * this.resetValidation();          // clear all
   * this.resetValidation('email');   // clear email only
   *
   * @category Validation
   */
  resetValidation(field?: string): void {
    if (field) {
      delete this._errors[field];
    } else {
      this._errors = {};
    }
  }

  // ── Cross-component events ────────────────────────────────────────────────

  /**
   * Dispatch a named event to all other Flow components on the page.
   * Components with a matching `@on('event-name')` decorator will have
   * their listener method called automatically.
   *
   * @example
   * async save() {
   *   const post = await Post.create(this.form);
   *   this.dispatch('post-created', { id: post.id });
   * }
   *
   * @category Events
   */
  dispatch<K extends string>(
    name: K,
    ...args: K extends EventName ? EventArgs<FlowEvents[K]> : [payload?: Record<string, unknown>]
  ): void;
  dispatch(name: string, data: unknown = {}): void {
    _validateEventPayload(name, data);
    this._events.push({ name, data: (data ?? {}) as Record<string, unknown> });
  }

  /**
   * Dispatch an event ONLY to components of a given class name (skips all others
   * listening for the same event).
   *
   * @example
   * this.dispatchTo('Dashboard', 'post-created', { id: post.id });
   *
   * @category Events
   */
  dispatchTo<K extends string>(
    component: string,
    name: K,
    ...args: K extends EventName ? EventArgs<FlowEvents[K]> : [payload?: Record<string, unknown>]
  ): void;
  dispatchTo(component: string, name: string, data: unknown = {}): void {
    _validateEventPayload(name, data);
    this._events.push({ name, data: (data ?? {}) as Record<string, unknown>, to: component });
  }

  /**
   * Dispatch an event only to THIS component (it won't bubble to others).
   *
   * @example
   * this.dispatchSelf('refresh');
   *
   * @category Events
   */
  dispatchSelf<K extends string>(
    name: K,
    ...args: K extends EventName ? EventArgs<FlowEvents[K]> : [payload?: Record<string, unknown>]
  ): void;
  dispatchSelf(name: string, data: unknown = {}): void {
    _validateEventPayload(name, data);
    this._events.push({ name, data: (data ?? {}) as Record<string, unknown>, self: true });
  }

  // ── Client magics ───────────────────────────────────────────────────────────
  // `dispatch` / `dispatchTo` / `dispatchSelf` / `refresh` above are real methods, so
  // they're typesafe in both server actions AND client expressions (the `this.`→`$flow.`
  // rewrite resolves them to the matching client magic at runtime).
  //
  // Every OTHER client magic lives on the global `$flow` object, NOT on the component. The rule:
  // `this.name` is always YOUR member; `$flow.name` is always a framework helper — so the bare
  // names (`set`, `toggle`, `store`, `parent`, `on`, `watch`, `get`, `call`, …) stay free for
  // your own props and methods. Write the helpers bare; the AOT compiler rewrites them to their
  // `$`-form for the runtime:
  //
  //   onClick={() => $flow.set("open", true)}       // write + sync an @expose prop
  //   onClick={() => $flow.toggle("open")}
  //   onClick={() => $flow.parent.save()}           // call a parent action
  //   onClick={() => ($flow.store.ui.dark = true)}  // global client store
  //   $flow.get / $flow.call / $flow.on / $flow.watch / $flow.whisper / $flow.onWhisper /
  //   $flow.cancel / $flow.appendOptimistic / $flow.removeOptimistic / $flow.commit
  //
  // `$flow` is typed globally (see augment.ts); `$flow.store` is typed by `FlowStore`.

  /**
   * Build a URL from the current one with merged query params — client-only. Use it in a
   * JSX expression: `href={this.currentUrl({ query: this.q })}`, `class={this.currentUrl() === "/" ? "on" : ""}`,
   * or `{this.currentUrl(...)}`. The compiler rewrites `this.currentUrl` → `$flow.currentUrl`
   * so it runs on the client. It never runs on the server — hitting this throw means the call
   * reached server code (e.g. a page the compiler couldn't statically compile, or a server action).
   *
   * @throws {Error} when executed on the server (it is meant to be compiled to `$flow.currentUrl`).
   * @category Navigation & redirects
   */
  currentUrl(_options?: CurrentUrlOptions): string {
    return _clientOnlyUrlHelper("currentUrl");
  }

  /**
   * Build the URL as {@link currentUrl} does, then SPA-navigate to it — client-only. Use it in a
   * client handler: `onClick={() => this.navigateCurrent({ query: { page: 2 } })}`. The compiler
   * rewrites it to `$flow.navigateCurrent`. To navigate from server code, return a `redirect()`.
   *
   * @throws {Error} when executed on the server (it is meant to be compiled to `$flow.navigateCurrent`).
   * @category Navigation & redirects
   */
  navigateCurrent(_options?: CurrentUrlOptions): Promise<void> {
    return _clientOnlyUrlHelper("navigateCurrent");
  }

  // ── File downloads ────────────────────────────────────────────────────────

  /**
   * Trigger a browser file download.
   *
   * `content` is either text (CSV, JSON, an SVG) or the raw bytes of a binary
   * file. Text is encoded as UTF-8; bytes are sent exactly as given, which is
   * what a format like a spreadsheet or a PDF requires — passing those through
   * a string would re-encode every byte above 127 and corrupt the file.
   *
   * @example
   * async export() {
   *   const csv = this.buildCsv(this.items);
   *   this.download('export.csv', csv, 'text/csv;charset=utf-8');
   * }
   *
   * @param filename  the download's suggested file name.
   * @param content   text, or the file's raw bytes (base64-encoded to travel).
   * @param mime      the MIME type. Defaults to `application/octet-stream`.
   * @category Actions
   */
  download(
    filename: string,
    content: string | Uint8Array,
    mime = "application/octet-stream",
  ): void {
    const encoded = Buffer.from(content as Uint8Array).toString("base64");
    this._downloads.push({ filename, content: encoded, mime });
  }

  // ── Two-way model binding ─────────────────────────────────────────────────

  /**
   * Emit the HTML attributes needed for `flow:model` two-way binding.
   *
   * Pass `optionValue` for one member of a radio group: the radio carries that
   * fixed value and is `checked` only when the bound property currently equals it.
   * A radio group is addressed as a unit — every option binds the same property —
   * so `value={…}`/`checked={…}` on a radio never infers a binding by itself and
   * this is the way to bind one.
   *
   * @example
   * <input {...this.bind('name')} />
   * // → <input flow:model="name" value="Alice" />
   *
   * @example
   * // A radio group over a `type` property:
   * {['CUSTOM', 'ROUTE', 'TEAMS'].map((t) => (
   *   <label>
   *     <input type="radio" name="type" {...this.bind('type', t)} /> {t}
   *   </label>
   * ))}
   * // → <input type="radio" name="type" flow:model="type" value="ROUTE" checked>
   *
   * @param key  the `@expose` property to two-way bind.
   * @param optionValue  this radio's own value; omit for text/checkbox/select inputs.
   * @returns the `flow:model` + `value` (+ `checked`) attributes to spread onto an input.
   * @category State & exposure
   */
  bind(key: string, optionValue?: string): Record<string, unknown> {
    const current = (this as Record<string, unknown>)[key];
    if (optionValue !== undefined) {
      return {
        "flow:model": key,
        value: optionValue,
        // String-compare so a numeric property still matches its string option value —
        // the DOM only ever gives a radio's value back as a string.
        checked: String(current ?? "") === optionValue,
      };
    }
    return {
      "flow:model": key,
      value: current ?? "",
    };
  }

  // ── Nested components ─────────────────────────────────────────────────────

  /**
   * Embed another Component as a nested component with its own isolated state,
   * its own WebSocket update cycle, and its own snapshot.
   *
   * Children are islands: a parent re-render does NOT re-render existing
   * children (their DOM and state are preserved on the client), and a child
   * update never touches the parent. Use `key` when embedding the same
   * component class multiple times (e.g. in a loop).
   *
   * `props` are assigned to the child instance before `onMount()` runs.
   *
   * Pass `lazy: true` to use IntersectionObserver — `onMount()` is deferred
   * until the placeholder enters the viewport.
   * Pass `defer: true` to load immediately after page paint (no intersection check).
   * Pass `stream: true` to render the placeholder now and the real markup later
   * on the *same* response — no second round trip. Use it for content that is
   * definitely needed and merely slow; `lazy`/`defer` are for content that may
   * never be needed at all.
   *
   * @example
   * override async render() {
   *   return <div>
   *     <h1>Dashboard</h1>
   *     <StatsWidget />
   *     <CounterWidget key="a" step={5} />
   *     <SlowWidget lazy />
   *     <SalesReport stream />
   *   </div>;
   * }
   *
   * @param ChildClass  the child Component class to embed.
   * @param opts        `key` disambiguates repeated instances; `props` seed the child before
   *                    `onMount()`; `lazy`/`defer`/`stream` render a placeholder first; `slots`
   *                    pass named slot HTML.
   * @returns the child's rendered {@link HtmlNode} (root or placeholder).
   * @category Rendering
   */
  async child<C extends Component>(
    ChildClass: new () => C,
    opts: {
      key?: string | number;
      props?: Partial<C>;
      lazy?: boolean;
      defer?: boolean;
      /** Render the placeholder now, the real markup later on the same response. */
      stream?: boolean;
      /** Named slot HTML (`name → html`, default slot keyed `"default"`), rendered by the parent. */
      slots?: Record<string, string>;
    } = {},
  ): Promise<HtmlNode> {
    const name = ChildClass.name;
    const base = `${this._flowId}-${name.toLowerCase()}-`;
    // Deterministic id: explicit key, or occurrence index within this render.
    const keyPart =
      opts.key !== undefined
        ? String(opts.key).replace(/[^a-zA-Z0-9_-]/g, "")
        : String(this._childIds.filter((id) => id.startsWith(base)).length);
    const childId = `${base}${keyPart}`;

    this._childIds.push(childId);

    // Lazy-imported to keep Component.ts free of heavy static deps at class-load time.
    const { dehydrate } = await import("./dehydrate.ts");
    const { registerComponent } = await import("./registry.ts");
    registerComponent(ChildClass as never, this._flowPath);

    // ── Reactive / modelable bindings (Tier 1) ───────────────────────────────
    // `data-flow-props` carries the current value of each @reactive prop so the
    // client can detect a parent-pushed change and re-render the child. For each
    // @modelable prop, `data-flow-model` maps the child prop → the parent property
    // it syncs back to (resolved by value identity against the parent's props).
    const childProto = (ChildClass as { prototype: object }).prototype;
    const reactiveKeys = getReactiveProps(childProto);
    const modelableKeys = getModelableProps(childProto);
    const givenProps = (opts.props ?? {}) as Record<string, unknown>;
    let bindAttrs = "";
    if (reactiveKeys.size) {
      const propsObj: Record<string, unknown> = {};
      for (const k of reactiveKeys) if (k in givenProps) propsObj[k] = givenProps[k];
      if (Object.keys(propsObj).length) {
        bindAttrs += ` data-flow-props='${_attrJson(JSON.stringify(propsObj))}'`;
      }
    }
    if (modelableKeys.size) {
      const modelMap: Record<string, string> = {};
      const exposed = getExposedProps(this);
      const locked = getLockedProps(this);
      for (const mProp of modelableKeys) {
        const val = givenProps[mProp];
        for (const pk of exposed) {
          if (locked.has(pk)) continue;
          if (Object.is((this as Record<string, unknown>)[pk], val)) {
            modelMap[mProp] = pk;
            break;
          }
        }
      }
      if (Object.keys(modelMap).length) {
        bindAttrs += ` data-flow-model='${_attrJson(JSON.stringify(modelMap))}'`;
      }
    }

    // Parent re-render over WS: children that already exist client-side are
    // emitted as stubs — the client morph skips nested roots, so the child's live
    // DOM and state are preserved. The stub still carries
    // data-flow-props so reactive/modelable updates reach the existing child.
    if (this._isHydrated && this._prevChildIds.includes(childId)) {
      return {
        html: `<div data-flow-root x-data="{}" data-flow-id="${childId}" data-flow-name="${name}"${bindAttrs}></div>`,
      };
    }

    // Lazy / defer: render placeholder without calling onMount(). The client
    // will dispatch a $mount frame when ready (viewport entry or DOMContentLoaded).
    if (opts.lazy || opts.defer) {
      const childPage = new ChildClass();
      childPage._flowId = childId;
      childPage._flowPath = this._flowPath;
      if (opts.slots) childPage._flowSlots = opts.slots;
      if (opts.props) {
        for (const [k, v] of Object.entries(opts.props)) {
          if (!k.startsWith("_")) (childPage as Record<string, unknown>)[k] = v;
        }
      }
      // Don't call onMount() — placeholder only

      const placeholderNode = childPage.placeholder();
      const snapshot = dehydrate(childPage, {
        id: childId,
        name,
        path: this._flowPath,
      });

      const loadAttr = opts.lazy ? "data-flow-lazy" : "data-flow-defer";
      return {
        html:
          `<div data-flow-root x-data="{}" data-flow-id="${childId}" data-flow-name="${name}" ${loadAttr}${bindAttrs}>` +
          `${placeholderNode.html}` +
          `<script type="application/json" id="flow-state-${childId}">${toScriptJson(snapshot)}</script>` +
          `</div>`,
      };
    }

    // Streamed: paint the placeholder now and queue the real render to be
    // appended to this same response once the shell has been flushed. Only
    // possible during an initial GET — a WS patch has no open response to append
    // to, so `getStreamStore()` is undefined there and this falls through to the
    // ordinary inline render below.
    const streamStore = opts.stream ? getStreamStore() : undefined;
    if (streamStore) {
      const childPage = new ChildClass();
      childPage._flowId = childId;
      childPage._flowPath = this._flowPath;
      if (opts.slots) childPage._flowSlots = opts.slots;
      if (opts.props) {
        for (const [k, v] of Object.entries(opts.props)) {
          if (!k.startsWith("_")) (childPage as Record<string, unknown>)[k] = v;
        }
      }

      queueStream({
        childId,
        render: async () => {
          const streamCtx = HttpContext.tryGet();
          await childPage.onBoot(streamCtx);
          await childPage.onMount(streamCtx);
          const inner = await _renderFlowPage(childPage, () => childPage.render());
          await childPage.onDehydrate();
          const snap = dehydrate(childPage, { id: childId, name, path: this._flowPath });
          return (
            inner +
            `<script type="application/json" id="flow-state-${childId}">${toScriptJson(snap)}</script>`
          );
        },
      });

      return {
        html:
          `<div data-flow-root x-data="{}" data-flow-id="${childId}" data-flow-name="${name}" data-flow-streaming${bindAttrs}>` +
          `${childPage.placeholder().html}` +
          `</div>`,
      };
    }

    // Initial render (SSR) or a child newly added by this update: full render.
    const childPage = new ChildClass();
    childPage._flowId = childId;
    childPage._flowPath = this._flowPath;
    if (opts.slots) childPage._flowSlots = opts.slots;
    if (opts.props) {
      for (const [k, v] of Object.entries(opts.props)) {
        if (!k.startsWith("_")) (childPage as Record<string, unknown>)[k] = v;
      }
    }
    // A child is populated from its parent's props (assigned above), not from route segments,
    // but it still gets the request context — the same object the routed page received.
    const ctx = HttpContext.tryGet();
    await childPage.onBoot(ctx);
    await childPage.onMount(ctx);

    const innerHtml = await _renderFlowPage(childPage, () => childPage.render());

    await childPage.onDehydrate();
    const snapshot = dehydrate(childPage, {
      id: childId,
      name,
      path: this._flowPath,
    });

    return {
      html:
        `<div data-flow-root x-data="{}" data-flow-id="${childId}" data-flow-name="${name}"${bindAttrs}>` +
        `${innerHtml}` +
        `<script type="application/json" id="flow-state-${childId}">${toScriptJson(snapshot)}</script>` +
        `</div>`,
    };
  }

  // ── Streaming ─────────────────────────────────────────────────────────────

  /**
   * Push content to the client MID-ACTION — before the final patch — into any
   * element marked `flow:stream="ref"`. Appends by default; pass
   * `{ replace: true }` to overwrite instead.
   *
   * Works only during WebSocket actions (no-op during SSR).
   *
   * @security `content` is injected as raw innerHTML on the client. Never pass
   * unescaped user input directly — sanitize or escape it first, or use a
   * trusted HTML sanitizer (e.g. DOMPurify) client-side.
   *
   * @example
   * @expose async generate() {
   *   for await (const token of llm.stream(this.prompt)) {
   *     this.stream('answer', token);
   *   }
   * }
   *
   * @param ref      the `flow:stream="ref"` target element.
   * @param content  raw HTML appended (or replacing) inside the target.
   * @param opts     pass `{ replace: true }` to overwrite instead of append.
   * @category Actions
   */
  stream(ref: string, content: string, opts: { replace?: boolean } = {}): void {
    this._streamSender?.(ref, content, opts.replace ?? false);
  }

  // ── Built-in actions (invoked by the bridge, not user-callable) ───────────

  /**
   * @internal Handles flow:model updates from the client.
   * Silently ignores unexposed or @locked properties — both are defense-in-depth
   * against confused-deputy attacks (HMAC signing is the primary guard).
   */
  $set(key: string, value: unknown): void {
    const exposed = getExposedProps(this);
    const locked = getLockedProps(this);
    if (!exposed.has(key) && !locked.has(key)) return;
    if (locked.has(key)) return;
    // Form object: fill the existing instance instead of replacing it with a plain
    // object, so its class + methods survive a `value={this.form.field}` edit.
    const cur = (this as Record<string, unknown>)[key];
    if (
      cur &&
      typeof cur === "object" &&
      (cur as { __isFlowForm?: unknown }).__isFlowForm === true &&
      value &&
      typeof value === "object"
    ) {
      (cur as { fill(v: Record<string, unknown>): void }).fill(value as Record<string, unknown>);
      return;
    }
    // Signed upload references become TemporaryUploadedFile instances (signature verified);
    // all other values pass through unchanged.
    (this as Record<string, unknown>)[key] = resolveUploadValue(value);
  }

  /** @internal Triggers onMount re-run (used by $flow.refresh()). */
  $refresh(): void {
    this._shouldRefresh = true;
  }

  /**
   * @internal Apply a client-driven property update, firing the updating/updated
   * lifecycle hooks (generic + per-property) around the write. Only writable
   * (`@expose`, non-`@locked`) props fire hooks and get written; everything else
   * is silently ignored by `$set` (defense-in-depth). An `onUpdating` hook may
   * throw to reject the update.
   */
  async _applyClientUpdate(key: string, value: unknown, arrayKey?: string): Promise<void> {
    const exposed = getExposedProps(this);
    const locked = getLockedProps(this);
    if (!exposed.has(key) || locked.has(key)) {
      this.$set(key, value); // no-op for unknown/locked, kept for symmetry
      return;
    }
    await this._emitUpdateHook("onUpdating", key, value, arrayKey);
    this.$set(key, value);
    await this._emitUpdateHook("onUpdated", key, value, arrayKey);

    // Real-time validation: if this field carries a `@validate` rule, validate
    // just it now and set/clear its error. The changed value reaches here from `flow:model.live` /
    // `.blur` syncs (and dirty-field batches), so errors appear/clear as the user edits — the
    // refreshed `_errors` bag is sent to the client in this round-trip's patch. Never throws.
    await this._validateField(key);
  }

  /** @internal Fire a generic update hook + its per-property `on…<Prop>` variant. */
  async _emitUpdateHook(
    base: "onUpdating" | "onUpdated",
    prop: string,
    value: unknown,
    key?: string,
  ): Promise<void> {
    await (this[base] as (p: string, v: unknown, k?: string) => Promise<void>)(prop, value, key);
    const specific = `${base}${prop.charAt(0).toUpperCase()}${prop.slice(1)}`;
    const fn = (this as Record<string, unknown>)[specific];
    if (typeof fn === "function") {
      await (fn as (v: unknown, k?: string) => unknown).call(this, value, key);
    }
  }

  // ── Effect draining (called by WS handler after action) ──────────────────

  /** @internal — read by the WS handler after action execution. */
  _drainEffects(): FlowEffects {
    const effects: FlowEffects = {
      flashes: this._flashes.splice(0),
      redirectUrl: this._redirectUrl,
      shouldRefresh: this._shouldRefresh,
      scripts: this._clientScripts.splice(0),
      errors: this._errors,
      events: this._events.splice(0),
      downloads: this._downloads.splice(0),
      title: this._titleValue,
    };
    this._redirectUrl = null;
    this._redirectStatus = null;
    this._shouldRefresh = false;
    this._titleValue = null;
    // _errors intentionally NOT reset here: errors persist across actions so the
    // client continues showing field messages after e.g. a failed save that then
    // dispatches a flash. Call resetValidation() or a passing validate() to clear.
    return effects;
  }
}
