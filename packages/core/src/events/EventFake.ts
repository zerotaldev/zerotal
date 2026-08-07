/**
 * The testing counterpart to {@link Emitter}: records emitted events instead of
 * running their listeners, so a test can assert that an action announced what it
 * did without also running everything that reacts to it.
 */
import type { Application } from "../application/Application.ts";
import { currentApp } from "../application/currentApp.ts";
import type { Binding } from "../container/types.ts";
import { Emitter } from "./Emitter.ts";

/** An event's class, as the assertions receive it. */
type EventClass<T extends object> = (abstract new (...args: never[]) => T) & {
  readonly name: string;
};

/**
 * Drop-in replacement for {@link Emitter} that captures emitted events instead
 * of dispatching them to listeners. Install at the start of a test, restore
 * after.
 *
 * Faking the emitter is what lets a test assert "publishing a post announces
 * `PostPublished`" without the listeners for that event — mail, search
 * indexing, cache invalidation — running as a side effect. To test a listener,
 * do not fake: construct the listener and hand it an event directly.
 *
 * @example
 * const events = EventFake.install();
 *
 * await post.publish();
 *
 * events.assertEmitted(PostPublished);
 * events.assertEmitted(PostPublished, (e) => e.postId === post.id);
 * events.assertNotEmitted(PostDeleted);
 *
 * events.restore(); // call in afterEach
 */
export class EventFake extends Emitter {
  private readonly _emitted: object[] = [];

  private constructor(
    private readonly _app: Application,
    private readonly _original: Binding<unknown> | undefined,
  ) {
    super();
  }

  /** Replace the `events` container binding with this fake. */
  static install(): EventFake {
    const app = currentApp();
    const fake = new EventFake(app, app.container.registry.get("events"));
    app.container.value("events", fake);
    return fake;
  }

  /** Restore the original `events` binding. Call in afterEach. */
  restore(): void {
    if (this._original !== undefined) {
      this._app.container.registry.set("events", this._original);
    } else {
      this._app.container.registry.delete("events");
    }
  }

  // ── Emitter interface ─────────────────────────────────────────────────

  /** Capture the event — its listeners do NOT run. */
  override async emit<T extends object>(event: T): Promise<void> {
    this._emitted.push(event);
  }

  /** Capture the event — its listeners do NOT run. */
  override async emitSync<T extends object>(event: T): Promise<void> {
    this._emitted.push(event);
  }

  /** Discard the captured events, and any listeners registered on the fake. */
  override clear(): void {
    super.clear();
    this._emitted.length = 0;
  }

  // ── Inspection ────────────────────────────────────────────────────────

  /** Every event captured, in emit order. */
  emitted(): object[] {
    return [...this._emitted];
  }

  /** The captured events of the given class, narrowed to its type. */
  emittedOf<T extends object>(EventType: EventClass<T>): T[] {
    return this._emitted.filter((e): e is T => e instanceof EventType);
  }

  // ── Assertions ────────────────────────────────────────────────────────

  /**
   * Assert an event of the given class was emitted, optionally one matching
   * `filter`.
   *
   * @example
   * events.assertEmitted(OrderPlaced);
   * events.assertEmitted(OrderPlaced, (e) => e.total === 4999);
   */
  assertEmitted<T extends object>(EventType: EventClass<T>, filter?: (event: T) => boolean): void {
    const matches = this.emittedOf(EventType);
    if (matches.length === 0) {
      throw new Error(
        `assertEmitted: expected ${_name(EventType)} to be emitted, but ${this._summary()}`,
      );
    }
    if (filter && !matches.some(filter)) {
      throw new Error(
        `assertEmitted: ${matches.length} ${_name(EventType)} event(s) were emitted, but none ` +
          `matched the filter. Emitted: ${JSON.stringify(matches)}.`,
      );
    }
  }

  /** Assert no event of the given class was emitted. */
  assertNotEmitted<T extends object>(
    EventType: EventClass<T>,
    filter?: (event: T) => boolean,
  ): void {
    const matches = this.emittedOf(EventType);
    const offending = filter ? matches.filter(filter) : matches;
    if (offending.length > 0) {
      throw new Error(
        `assertNotEmitted: expected no ${_name(EventType)} but ${offending.length} were emitted: ` +
          `${JSON.stringify(offending)}.`,
      );
    }
  }

  /** Assert exactly `count` events of the given class were emitted. */
  assertEmittedCount<T extends object>(EventType: EventClass<T>, count: number): void {
    const actual = this.emittedOf(EventType).length;
    if (actual !== count) {
      throw new Error(
        `assertEmittedCount: expected ${count} ${_name(EventType)} event(s) but got ${actual}.`,
      );
    }
  }

  /** Assert no events at all were emitted. */
  assertNothingEmitted(): void {
    if (this._emitted.length > 0) {
      throw new Error(`assertNothingEmitted: ${this._summary()}`);
    }
  }

  private _summary(): string {
    if (this._emitted.length === 0) return "no events were emitted at all.";
    const names = this._emitted.map((e) => e.constructor.name);
    return `the events emitted were [${names.join(", ")}].`;
  }
}

function _name(EventType: EventClass<object>): string {
  return EventType.name;
}
