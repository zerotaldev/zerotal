/**
 * Lightweight synchronous event bus for framework instrumentation.
 *
 * ORM, Mail, Cache, and Queue emit lifecycle events here.
 * Infrastructure packages (DevTools, Logging, Metrics) subscribe to react.
 *
 * Handlers fire synchronously in the emitter's call stack — keep them fast
 * and side-effect-free (buffer pushes, counter increments). For I/O or heavy
 * work, dispatch a queue job from inside the handler instead.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic "any event class" constructor bound; the args are never read through this type
type EventCtor = new (...args: any[]) => object;
type Handler<E> = (event: E) => void;

// Events are keyed two ways: by class identity (subscribe with the class) and by
// a stable string "kind" (subscribe with the string). Code that owns an event
// subscribes with the class; a decoupled observer that must not import the class
// — telemetry, the monitor — subscribes by kind. An event's kind is its optional
// `static kind`, defaulting to the class name.
const _byClass = new Map<EventCtor, Set<Handler<object>>>();
const _byKind = new Map<string, Set<Handler<object>>>();

/** The stable string key for an event class: its `static kind`, or its class name. */
function _kindOf(ctor: EventCtor): string {
  return (ctor as { kind?: string }).kind ?? ctor.name;
}

/**
 * The framework instrumentation event bus — subscribe with `on`, fire with
 * `emit`. Separate from the class-based {@link Emitter} used for application
 * events: this bus is synchronous, static, and carries the framework's own
 * lifecycle signals ({@link QueryExecuted}, {@link RequestHandled},
 * {@link JobRan}, …) that observability packages subscribe to.
 *
 * @example
 * ```ts
 * import { FrameworkEvents, QueryExecuted } from "@zerotal/core";
 *
 * // In a provider's onBooting(): watch every SQL query.
 * const off = FrameworkEvents.on(QueryExecuted, (e) => {
 *   if (e.durationMs > 100) console.warn(`slow query (${e.durationMs}ms): ${e.sql}`);
 * });
 *
 * // In onStopping(): unsubscribe to avoid handler leaks.
 * off();
 * ```
 */
export const FrameworkEvents = {
  /**
   * Subscribe to a framework event. Returns an unsubscribe function —
   * call it in provider.onStopping() to avoid handler leaks.
   *
   * Pass the **event class** to listen by identity (the usual case, when you own
   * or can import the class), or a **string kind** to listen without importing
   * the class — the way a decoupled observer (telemetry, the monitor) subscribes
   * to a satellite package's events.
   *
   * @param target   The event class to listen for, or its string {@link _kindOf | kind}.
   * @param handler  Synchronous callback invoked with each emitted instance.
   * @returns A function that removes this subscription when called.
   * @category Subscription
   */
  on<E extends object>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic "any event class" constructor bound
    target: (new (...args: any[]) => E) | string,
    handler: Handler<E>,
  ): () => void {
    const handlers = ((): Set<Handler<object>> => {
      if (typeof target === "string") {
        const existing = _byKind.get(target);
        if (existing) return existing;
        const set = new Set<Handler<object>>();
        _byKind.set(target, set);
        return set;
      }
      const ctor = target as EventCtor;
      const existing = _byClass.get(ctor);
      if (existing) return existing;
      const set = new Set<Handler<object>>();
      _byClass.set(ctor, set);
      return set;
    })();
    handlers.add(handler as Handler<object>);
    return () => {
      handlers.delete(handler as Handler<object>);
    };
  },

  /**
   * Emit a framework event synchronously to all registered handlers — both those
   * subscribed by class identity and those subscribed by the event's kind string.
   * Errors from handlers are swallowed — subscribers must never affect the caller.
   *
   * @param event  The event instance; its constructor (and kind) select the handlers.
   * @category Dispatch
   */
  emit<E extends object>(event: E): void {
    const ctor = event.constructor as EventCtor;
    const classHandlers = _byClass.get(ctor);
    const kindHandlers = _byKind.get(_kindOf(ctor));
    if (!classHandlers?.size && !kindHandlers?.size) return;
    const fire = (handler: Handler<object>): void => {
      try {
        handler(event);
      } catch {
        // Subscriber errors must never propagate back to the emitting code.
      }
    };
    if (classHandlers) for (const handler of classHandlers) fire(handler);
    if (kindHandlers) for (const handler of kindHandlers) fire(handler);
  },

  /**
   * Remove all subscriptions. Call in tests to reset state between suites.
   * @category Subscription
   */
  clear(): void {
    _byClass.clear();
    _byKind.clear();
  },

  /**
   * Total number of registered handlers across all event types (class- and
   * kind-keyed). Intended for tests to assert subscriptions were cleaned up.
   *
   * @returns The count of live handlers across every event type.
   * @category Subscription
   */
  handlerCount(): number {
    let count = 0;
    for (const handlers of _byClass.values()) count += handlers.size;
    for (const handlers of _byKind.values()) count += handlers.size;
    return count;
  },

  /**
   * Which events currently have subscribers, and how many each has.
   *
   * The bus is the framework's nervous system and has been invisible: "does
   * anything actually listen to `ModelChanged`" was a question you answered by
   * reading every package. Sorted by name so two calls are comparable.
   *
   * Class- and kind-keyed subscriptions are merged, because a subscriber that
   * listened by string and one that imported the class are subscribed to the
   * same event and a reader does not care which door they came through.
   *
   * @returns One row per event with at least one live handler.
   * @category Subscription
   */
  subscriptions(): Array<{ event: string; handlers: number }> {
    const counts = new Map<string, number>();
    for (const [ctor, handlers] of _byClass) {
      if (handlers.size)
        counts.set(_kindOf(ctor), (counts.get(_kindOf(ctor)) ?? 0) + handlers.size);
    }
    for (const [kind, handlers] of _byKind) {
      if (handlers.size) counts.set(kind, (counts.get(kind) ?? 0) + handlers.size);
    }
    return [...counts.entries()]
      .map(([event, handlers]) => ({ event, handlers }))
      .sort((a, b) => a.event.localeCompare(b.event));
  },
};

// ── Framework event types ─────────────────────────────────────────────────────

// ── Application lifecycle ──────────────────────────────────────────────────────

/**
 * Emitted once when the application finishes booting — all providers registered
 * and booted and conventions wired. `durationMs` is the wall-clock boot time, so
 * observers (Health page, telemetry, logger) can surface startup cost.
 *
 * @category Application lifecycle
 * @example
 * ```ts
 * FrameworkEvents.on(AppBooted, (e) => {
 *   console.log(`booted in ${e.durationMs}ms (${e.providerCount} providers)`);
 * });
 * ```
 */
export class AppBooted {
  constructor(
    readonly durationMs: number,
    /** Application environment, e.g. "web" | "worker" | "console" | "test" | "repl". */
    readonly environment: string,
    /** Number of active service providers that booted. */
    readonly providerCount: number,
  ) {}
}

/**
 * Emitted after a complete HTTP request–response cycle.
 * Fired by Application after the middleware pipeline resolves.
 *
 * @category HTTP
 * @example
 * ```ts
 * FrameworkEvents.on(RequestHandled, (e) => {
 *   metrics.observe("http.duration_ms", e.durationMs);
 * });
 * ```
 */
export class RequestHandled {
  constructor(
    /** HttpContext — typed as object to avoid cross-package circular deps. */
    readonly ctx: object,
    readonly startMs: number,
    readonly durationMs: number,
  ) {}
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

/**
 * Emitted after an outgoing HTTP request made through the `Http` client
 * completes or finally fails. Powers outgoing-dependency dashboards (per-host
 * call counts, p95 latency, error rate). `status` is 0 when the request never
 * got a response (network error / timeout).
 *
 * @category HTTP
 */
export class OutgoingRequestCompleted {
  constructor(
    readonly host: string,
    readonly method: string,
    readonly url: string,
    readonly status: number,
    readonly durationMs: number,
    readonly ok: boolean,
  ) {}
}

/**
 * Emitted after an HTTP request fails (an error propagated out of the pipeline).
 * Fired by the route dispatcher and the server fallback catch blocks.
 *
 * @category HTTP
 */
export class RequestFailed {
  constructor(
    /** HttpContext — typed as object to avoid cross-package circular deps. */
    readonly ctx: object,
    readonly startMs: number,
    readonly durationMs: number,
    readonly error: string,
    readonly status: number,
    /**
     * The error's class name, when the failure was an `Error`.
     *
     * `message` alone cannot tell a `ValidationError` from a `TypeError`, and
     * which one it was is usually the first thing you want to know.
     */
    readonly type?: string,
    /**
     * The raw `Error.stack`, for subscribers that render a trace.
     *
     * Carried as the unparsed string: the shape differs between runtimes, and
     * this event should not be the thing that decides how a frame is spelled.
     */
    readonly stack?: string,
  ) {}
}

/**
 * Emitted when a middleware short-circuits the pipeline (skips downstream).
 * @category HTTP
 */
export class MiddlewareSkipped {
  constructor(
    readonly name: string,
    readonly reason: string,
    readonly ctx: object,
  ) {}
}

// ── Console / commands ────────────────────────────────────────────────────────

/**
 * Emitted after a console (Artisan-style) command finishes — whether run from the
 * CLI or in-process via `Artisan.call()`. Powers the panel's Commands feed.
 *
 * @category Console
 */
export class CommandRan {
  constructor(
    readonly name: string,
    readonly durationMs: number,
    readonly exitCode: number,
    readonly ok: boolean,
    readonly error?: string,
  ) {}
}
