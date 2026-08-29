/**
 * The class-based, typed application event emitter: events are plain classes,
 * listeners are classes with a `handle()` method, and dispatch can run async
 * (fire-and-forget), synchronously, or be deferred to a queue.
 */
import { CallQueuedListener } from "./CallQueuedListener.ts";
import type { ClassRef } from "../support/classRef.ts";

type EventClass<T extends object> = new (...args: unknown[]) => T;
type ListenerClass<T extends object> = new (...args: unknown[]) => {
  handle(event: T): Promise<void> | void;
  queue?: boolean | string;
  maxAttempts?: number;
  retryDelay?: number;
};

/**
 * A listener that opts into deferred execution by declaring a `queue` target.
 *
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the event payload type is listener-specific and not known at this boundary.
export interface QueuedListener<T = any> {
  queue: boolean | string;
  maxAttempts?: number;
  retryDelay?: number;
  handle(event: T): Promise<void> | void;
}

/**
 * The class-based application event emitter: register listener classes against
 * event classes, then dispatch event instances to them.
 *
 * Events are plain classes and listeners are classes exposing a
 * `handle(event)` method. Dispatch can run concurrently and fire-and-forget
 * ({@link Emitter.emit}), one-at-a-time ({@link Emitter.emitSync}), or be
 * deferred to the queue when a listener declares a `queue` target and a queue
 * manager is registered. Listener failures during {@link Emitter.emit} are
 * isolated and logged, never rethrown to the caller.
 *
 * Reached in applications through the `Events` facade; construct directly only
 * in tests or bespoke wiring.
 *
 * @example
 * ```ts
 * import { Emitter } from "@zerotal/core";
 *
 * class UserRegistered {
 *   constructor(readonly userId: string) {}
 * }
 *
 * class SendWelcomeEmail {
 *   async handle(event: UserRegistered): Promise<void> {
 *     // await mail.to(event.userId).send(new Welcome());
 *   }
 * }
 *
 * const emitter = new Emitter();
 * emitter.on(UserRegistered, SendWelcomeEmail);
 * await emitter.emit(new UserRegistered("u_123"));
 * ```
 */
export class Emitter {
  private _listeners = new Map<ClassRef, ListenerClass<object>[]>();
  private _listenerByName = new Map<string, ListenerClass<object>>();

  // Holds the application so the emitter can resolve the queue manager lazily.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Application is typed elsewhere; depending on it here would create a cross-module cycle.
  private _application: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see _application above.
  constructor(application?: any) {
    this._application = application;
  }

  // Broadcaster hook, owned per emitter (i.e. per application). @zerotal/broadcasting's
  // provider installs it so emitting a broadcastable event (one with a `broadcastOn()`
  // method) also broadcasts it, keeping core broadcasting-free via this indirection.
  private _broadcaster: ((event: object) => void) | null = null;

  /**
   * Install the hook that broadcasts emitted events implementing `broadcastOn()`.
   * Set by `@zerotal/broadcasting`'s provider on the application's emitter; apps
   * never call this. Pass `null` to disable.
   *
   * @internal
   */
  setBroadcaster(fn: ((event: object) => void) | null): void {
    this._broadcaster = fn;
  }

  private _maybeBroadcast(event: object): void {
    if (!this._broadcaster) return;
    if (typeof (event as { broadcastOn?: unknown }).broadcastOn !== "function") return;
    try {
      this._broadcaster(event);
    } catch (error) {
      console.error("[Zerotal] broadcaster hook failed:", error);
    }
  }

  // ── Registration ──────────────────────────────────────────────────────

  /**
   * Register a listener class to run whenever the given event class is emitted.
   * The same event may have many listeners; they run in registration order.
   *
   * @param eventClass     The event class to listen for.
   * @param listenerClass  A class with a `handle(event)` method.
   * @category Subscription
   */
  on<T extends object>(eventClass: EventClass<T>, listenerClass: ListenerClass<T>): void {
    const existing = this._listeners.get(eventClass) ?? [];
    existing.push(listenerClass as ListenerClass<object>);
    this._listeners.set(eventClass, existing);

    // A queued listener crosses the queue boundary as a bare class name, so the name→class
    // index is how a worker finds it again. Two listeners sharing a name — `SendNotification`
    // in two modules is not a stretch — silently overwrote each other, so every queued job
    // for one ran the other's handler. There is no way to tell them apart after
    // serialisation, so the collision is refused where it can still be pointed at.
    const registered = this._listenerByName.get(listenerClass.name);
    if (registered && registered !== listenerClass) {
      throw new Error(
        `[Zerotal] Two listener classes are both named "${listenerClass.name}".\n` +
          `A queued listener is dispatched by class name, so the second registration would ` +
          `silently take over the first one's jobs. Rename one of them.`,
      );
    }
    this._listenerByName.set(listenerClass.name, listenerClass as ListenerClass<object>);
  }

  /**
   * Remove a previously registered listener for the given event class. No-op if
   * the listener was never registered.
   *
   * @category Subscription
   */
  off<T extends object>(eventClass: EventClass<T>, listenerClass: ListenerClass<T>): void {
    const existing = this._listeners.get(eventClass);
    if (!existing) return;
    const updated = existing.filter((listener) => listener !== listenerClass);
    if (updated.length === 0) {
      this._listeners.delete(eventClass);
    } else {
      this._listeners.set(eventClass, updated);
    }

    // Drop the name index too, once nothing is listening through this class. Leaving it
    // meant a de-registered listener still ran for every queued job that named it — `off()`
    // looked like it worked and did not — and the index grew without bound.
    const stillRegistered = [...this._listeners.values()].some((listeners) =>
      listeners.includes(listenerClass as ListenerClass<object>),
    );
    if (!stillRegistered) this._listenerByName.delete(listenerClass.name);
  }

  // ── Dispatch ──────────────────────────────────────────────────────────

  /**
   * Dispatch an event to all its listeners concurrently, deferring any listener
   * that declares a `queue` target to the queue manager when one is available.
   * Listener failures are isolated and logged, never rethrown to the caller.
   * Broadcastable events (those with a `broadcastOn()` method) are broadcast
   * first, so they fire even when no listeners are registered.
   *
   * @param event  The event instance; its constructor selects the listeners.
   * @returns Resolves once every listener has settled (queued ones once enqueued).
   * @category Dispatch
   */
  async emit<T extends object>(event: T): Promise<void> {
    // Broadcast first (synchronously) so it fires even for events with no listeners.
    this._maybeBroadcast(event);

    // A snapshot, not the live array: a listener that registers another listener for the
    // same event otherwise extends the array being iterated. One emit ran handle() 100,000
    // times that way.
    const listenerClasses = [...(this._listeners.get(event.constructor as ClassRef) ?? [])];

    if (listenerClasses.length === 0) return;

    await Promise.allSettled(
      listenerClasses.map(async (ListenerClass) => {
        const listener = new ListenerClass();

        if (listener.queue) {
          let queueManager;
          if (typeof this._application?.container?.make === "function") {
            try {
              queueManager = await this._application.container.make("queue");
            } catch {
              // No queue manager is registered; fall through to synchronous execution.
            }
          }

          if (queueManager) {
            const job = new CallQueuedListener(
              ListenerClass.name,
              event.constructor.name,
              event,
              listener.queue,
              listener.maxAttempts,
              listener.retryDelay,
            );
            await queueManager.dispatch(job);
            return;
          }
        }

        // Run inline when the listener is not queued, or no queue manager exists.
        try {
          await listener.handle(event);
        } catch (error) {
          console.error(
            `[Zerotal] Event listener ${ListenerClass.name} threw for ${event.constructor.name}:`,
            error,
          );
        }
      }),
    );
  }

  /**
   * Dispatch an event to its listeners one at a time, awaiting each in turn.
   * Unlike {@link Emitter.emit}, listeners run inline (never queued) and a
   * thrown error is not caught — it propagates to the caller.
   *
   * @param event  The event instance; its constructor selects the listeners.
   * @category Dispatch
   */
  async emitSync<T extends object>(event: T): Promise<void> {
    this._maybeBroadcast(event);

    // A snapshot, not the live array: a listener that registers another listener for the
    // same event otherwise extends the array being iterated. One emit ran handle() 100,000
    // times that way.
    const listenerClasses = [...(this._listeners.get(event.constructor as ClassRef) ?? [])];

    for (const ListenerClass of listenerClasses) {
      const listener = new ListenerClass();
      await listener.handle(event);
    }
  }

  /**
   * Run a deferred listener by name with its raw payload. Called by the queue
   * worker, not application code.
   *
   * @param listenerName  The registered listener class name.
   * @param eventPayload  The raw payload handed straight to `handle()` (for most
   *                      listeners the payload is the event).
   * @throws {Error} If no listener is registered under `listenerName`.
   * @category Dispatch
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the payload type is listener-specific and lost across the queue boundary.
  async dispatchQueuedListener(listenerName: string, eventPayload: any): Promise<void> {
    const ListenerClass = this._listenerByName.get(listenerName);
    if (!ListenerClass) {
      throw new Error(`Listener ${listenerName} not found in Emitter registry.`);
    }

    const listener = new ListenerClass();

    // Without an event-class registry we can't rebuild the original event, so we
    // hand the listener the raw payload — for most listeners the payload is the event.
    await listener.handle(eventPayload);
  }

  /**
   * Whether any listener is registered for the given event class.
   * @category Subscription
   */
  hasListeners<T extends object>(eventClass: EventClass<T>): boolean {
    return (this._listeners.get(eventClass)?.length ?? 0) > 0;
  }

  /**
   * Every event with a listener, and the listeners it has, by name.
   *
   * The wiring between an application's events and what reacts to them is
   * spread across every provider that calls `listen()`, so "what happens when an
   * order is placed" is a question you answer by searching. This is that map,
   * and it is what the inspector's Events tab draws.
   *
   * Names rather than classes, because the answer is read by a human or crosses
   * a wire — and a listener class is not serialisable either way.
   *
   * @returns One row per event with at least one listener, sorted by name.
   * @category Subscription
   */
  registrations(): Array<{ event: string; listeners: string[] }> {
    return [...this._listeners.entries()]
      .filter(([, listeners]) => listeners.length > 0)
      .map(([eventClass, listeners]) => ({
        event: (eventClass as { name?: string }).name ?? String(eventClass),
        listeners: listeners.map((listener) => listener.name),
      }))
      .sort((a, b) => a.event.localeCompare(b.event));
  }

  /**
   * Remove every registered listener.
   * @category Subscription
   */
  clear(): void {
    this._listeners.clear();
    this._listenerByName.clear();
  }
}
