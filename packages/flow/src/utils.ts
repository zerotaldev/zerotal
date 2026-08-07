/**
 * Serialise a value for embedding inside a `<script type="application/json">` island.
 *
 * `JSON.stringify` alone is **not** safe here: JSON does not escape `<`, and the HTML
 * tokenizer ends a `<script>` element at the first `</script` regardless of the element's
 * `type` attribute. So any string in the payload containing `</script>` breaks out of the
 * island and everything after it is parsed as HTML. Flow dehydrates every `@expose` and
 * `@locked` property, and `_seedUrlProps` copies query-string values straight into `@url`
 * props, so the payload routinely carries attacker-controlled strings.
 *
 * Escaping `<` to `\u003c` is valid JSON — it re-parses to the identical string — and closes
 * the breakout. U+2028 and U+2029 are escaped too: both are legal inside a JSON string but are
 * line terminators in JavaScript, so they break any consumer that evaluates rather than parses.
 *
 * @param value - Any JSON-serialisable value.
 * @returns JSON text that is safe to interpolate between `<script>` tags.
 * @category Rendering
 * @internal
 */
export function toScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Encode a value as a JavaScript string literal for embedding in an Alpine expression.
 *
 * An `x-on:click` / `x-show` / `:class` attribute is *executable code*, not display text, so
 * HTML escaping is the wrong tool: `escapeAttr` lets an expression through intact and the
 * browser hands Alpine exactly what was written. Interpolating a value into `'…'` by hand
 * therefore turns any user-controlled string — a workspace slug, a tab name — into stored
 * XSS against every viewer. `JSON.stringify` produces a literal with quotes, backslashes and
 * line terminators already escaped; the surrounding attribute escaping then handles the HTML
 * layer, and Alpine sees the original value.
 *
 * @param value - The value to embed.
 * @returns A JavaScript string literal, quotes included.
 *
 * @example
 * "x-on:click": `tab = ${jsLiteral(name)}`   // tab = "my-tab"
 */
export function jsLiteral(value: unknown): string {
  return JSON.stringify(String(value));
}

/** Generate a stable-looking but unique component ID. */
export function randomComponentId(name: string): string {
  // crypto.randomUUID() uses the platform CSPRNG — safe for use as DOM IDs.
  // Slice the last 8 chars of the UUID to keep IDs short but unguessable.
  const suffix = crypto.randomUUID().slice(-8);
  return `${name.toLowerCase()}-${suffix}`;
}

// -- flow() unified modifier chain ------------------------------------------

/**
 * The fluent modifier chain returned by {@link flow}. Each accessor/method appends a
 * directive modifier and returns the same chain, so calls compose left-to-right; the
 * chain is a no-op transparent Proxy at runtime and is consumed by the JSX compiler,
 * which reads `__isFlow`/`__target`/`__modifiers`/`__key` to emit the `flow:*` attributes.
 *
 * Generic over `T` so the compiler preserves the wrapped target's type (a bound property,
 * an `@expose` method, or a client arrow-function expression).
 *
 * @typeParam T - The wrapped target: a bound value, an `@expose` method reference, or a
 *   client callback (`() => …`).
 *
 * @example
 * ```tsx
 * // Binding modifiers on an input, and event modifiers on a form/button:
 * <input bind={flow(this.query).live} />                 // flow:model.live="query"
 * <form onSubmit={flow(this.save).prevent}>…</form>       // flow:submit.prevent="save"
 * <button onClick={flow(this.refresh).debounce(300)}>↻</button>
 * ```
 *
 * Binding modifiers  (bind={flow(this.field)...})
 *   .live            sync on every keystroke  (flow:model.live)
 *   .blur            sync on blur             (flow:model.blur)
 *   .lazy            defer until explicit save (flow:model.lazy)
 *   .fill            also fill sibling fields  (flow:model.fill)
 *   .debounce(ms)    debounce by ms            (flow:model.debounce.300ms)
 *   .throttle(ms)    throttle by ms            (flow:model.throttle.300ms)
 *
 * Server event modifiers  (onClick={flow(this.method)...})
 *   .prevent         event.preventDefault()    (flow:click.prevent)
 *   .stop            event.stopPropagation()   (flow:click.stop)
 *   .once            remove after first fire   (flow:click.once)
 *   .self            target === currentTarget  (flow:click.self)
 *   .window          attach to window          (flow:keydown.window)
 *   .document        attach to document        (flow:keydown.document)
 *   .outside         click outside element     (flow:click.outside)
 *   .passive         addEventListener passive  (flow:scroll.passive)
 *   .capture         addEventListener capture  (flow:click.capture)
 *   .camel           camelCase event name      (flow:custom-event.camel)
 *   .debounce(ms)    debounce action           (flow:click.debounce.300ms)
 *   .throttle(ms)    throttle action           (flow:click.throttle.300ms)
 *   .confirm(msg)    confirm dialog first      (flow:click.confirm)
 *
 * Client expressions  (onClick={flow(() => this.expr)})
 *   An anonymous arrow function as target signals a client-side expression.
 *   `this.` is rewritten to `$flow.` so TypeScript checks the access against
 *   the Component class while the browser evaluates it via the reactive proxy.
 *   Emits flow:click (not x-on:click) — the bridge detects `$flow` and
 *   evaluates it in Alpine context instead of sending a WebSocket action.
 *   All event modifiers still apply.
 *
 *   <button onClick={flow(() => (this.ticks = 0))}>Reset</button>
 *     → flow:click="($flow.ticks = 0)"
 *
 *   <button onClick={flow(() => this.increment()).stop}>+</button>
 *     → flow:click.stop="$flow.increment()"  (calls server via $flow proxy)
 *
 * Usage:
 *   <input bind={flow(this.query).live} />
 *   <form onSubmit={flow(this.save).prevent}>...</form>
 *   <span text={flow(this.clock)} />
 *   import { flow as _ } from '@zerotal/flow'; // shorthand alias
 */
export interface FlowChain<T> {
  // Binding modifiers
  readonly live: FlowChain<T>;
  readonly blur: FlowChain<T>;
  readonly lazy: FlowChain<T>;
  readonly fill: FlowChain<T>;

  // Event modifiers
  readonly prevent: FlowChain<T>;
  readonly stop: FlowChain<T>;
  readonly once: FlowChain<T>;
  readonly self: FlowChain<T>;
  readonly window: FlowChain<T>;
  readonly document: FlowChain<T>;
  readonly outside: FlowChain<T>;
  readonly passive: FlowChain<T>;
  readonly capture: FlowChain<T>;
  readonly camel: FlowChain<T>;

  // Parametric modifiers
  debounce(ms: string | number): FlowChain<T>;
  throttle(ms: string | number): FlowChain<T>;
  confirm(message: string): FlowChain<T>;

  // Internal -- read by the JSX compiler
  readonly __isFlow: true;
  readonly __target: T;
  readonly __modifiers: string[];
  readonly __key: string | undefined;
}

/**
 * Wrap an `@expose` method, a bound property, or a client callback to attach Flow
 * directive modifiers, returning a fluent {@link FlowChain} that the JSX compiler reads.
 *
 * The returned chain is a transparent Proxy that is a no-op at runtime (safe during SSR):
 * it carries only the wrapped target and the list of appended modifiers. The JSX runtime
 * reads `__isFlow`, `__target`, and `__modifiers` to emit the correct `flow:*` attributes.
 * Import it aliased as `_` for a terser call site: `import { flow as _ } from '@zerotal/flow'`.
 *
 * @typeParam T - The wrapped target's type, preserved on the returned chain for type-checking.
 * @param target - The bound value, `@expose` method reference, or client arrow function
 *   (`() => …`, whose `this.` is rewritten to `$flow.` for browser evaluation) to wrap.
 * @returns A {@link FlowChain} of `T` — chain modifiers off it (`.live`, `.prevent`,
 *   `.debounce(300)`, …).
 *
 * @example
 * ```tsx
 * <input bind={flow(this.query).live} />                 // flow:model.live="query"
 * <form onSubmit={flow(this.save).prevent}>…</form>       // flow:submit.prevent="save"
 * <span text={flow(this.clock)} />                        // flow:text="clock"
 * <button onClick={flow(() => (this.count = 0))}>Reset</button>       // flow:click="($flow.count = 0)"
 * <button onClick={flow(() => this.increment()).stop}>+</button>       // flow:click.stop="$flow.increment()"
 * ```
 */
// Shared capture variable: set by instrumented @expose getters in jsx-runtime,
// consumed immediately by flow() to embed __key in the chain.
let _exposedKeyCapture: string | undefined;
export function _setExposedKeyCapture(k: string | undefined): void {
  _exposedKeyCapture = k;
}
export function _consumeExposedKeyCapture(): string | undefined {
  const k = _exposedKeyCapture;
  _exposedKeyCapture = undefined;
  return k;
}

export function flow<T>(target: T): FlowChain<T> {
  const modifiers: string[] = [];
  // Capture immediately so subsequent prop evaluations cannot clobber it.
  const _capturedKey = _exposedKeyCapture;
  _exposedKeyCapture = undefined;

  function makeChain(): FlowChain<T> {
    return new Proxy(function flowProxy() {}, {
      get(_t, prop: string | symbol) {
        if (prop === "__isFlow") return true;
        if (prop === "__target") return target;
        if (prop === "__modifiers") return modifiers;
        if (prop === "__key") return _capturedKey;
        if (typeof prop === "symbol") return undefined;
        modifiers.push(prop as string);
        return makeChain();
      },
      apply(_t, _thisArg, args) {
        // Called as e.g. .debounce('300ms') -- append ".300ms" to last modifier.
        if (args.length > 0 && (typeof args[0] === "string" || typeof args[0] === "number")) {
          modifiers[modifiers.length - 1] += "." + String(args[0]);
        }
        return makeChain();
      },
    }) as unknown as FlowChain<T>;
  }

  return makeChain();
}
