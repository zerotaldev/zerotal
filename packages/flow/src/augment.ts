import type { PageClassWithMeta } from "./registry.ts";
import type { MiddlewareClass, RouteRegistration } from "@zerotal/core";
import type { FlowStore } from "./store.ts";

// Augment the core RouterMacros interface so Router.flow() is fully typed.
declare module "@zerotal/core" {
  interface RouterMacros {
    /**
     * Register a Flow Component as a GET route.
     *
     * Middleware runs on the initial page load AND is re-applied on every
     * WebSocket update (persistent middleware).
     *
     * @example
     * Router.flow('/dashboard', Dashboard);
     * Router.flow('/admin', AdminPage, [RequireAuthMiddleware]);
     */
    flow(
      path: string,
      PageClass: PageClassWithMeta,
      middleware?: MiddlewareClass[],
    ): RouteRegistration;
  }
}

/**
 * $flow — the client runtime object, available directly in JSX client expressions
 * (event handlers, attribute bindings, text children) and `this.client()` scripts.
 *
 * It is the single home for all client-only magics, so the component class itself stays
 * clean. The rule: `this.name` is always YOUR member (state/action); `$flow.name` is always a
 * framework helper. You write the helpers BARE (`$flow.set`, `$flow.store`, `$flow.parent`) and
 * the AOT compiler rewrites each to its canonical `$`-form (`$flow.$set`, …) for the runtime.
 *
 *   $flow.set("open", true)           write + sync an @expose property
 *   $flow.toggle("open")              toggle + sync a boolean @expose property
 *   $flow.store.ui.dark               the global client store (typed by FlowStore)
 *   $flow.parent.save()               call an action / read state on the parent
 *   onClick={this.save}              dispatch YOUR server action `save`
 */
declare global {
  var $flow: {
    // Reactive property reads/writes ($flow.count) and dynamic action calls. `any` because this
    // object mixes dynamic members with the typed helpers below; the index signature can't be
    // narrower than both.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [member: string]: any;

    // Component identity (always $-prefixed — no bare form)
    readonly $el: HTMLElement;
    readonly $id: string;
    readonly $name: string;

    // Re-render
    refresh(): void;
    commit(): void;

    // Property helpers
    get(prop: string): unknown;
    set(prop: string, value: unknown): void;
    toggle(prop: string): void;

    // Explicit method call
    call(method: string, ...args: unknown[]): void;

    // Cross-component events
    dispatch(event: string, data?: Record<string, unknown>): void;
    dispatchTo(component: string, event: string, data?: Record<string, unknown>): void;
    dispatchSelf(event: string, data?: Record<string, unknown>): void;
    on(event: string, fn: (detail: unknown) => void): void;

    // Watch reactive property changes after server patches
    watch(prop: string, fn: (newVal: unknown, oldVal: unknown) => void): void;

    // Call actions on / read state from the parent component
    readonly parent: Record<string, ((...args: unknown[]) => void) & unknown>;

    // Global client store — app-wide, client-only reactive UI state (typed by FlowStore).
    readonly store: FlowStore;

    // Presence whispers (ephemeral peer state; never touches the server/DB)
    whisper(event: string, data: unknown): void;
    onWhisper(event: string, fn: (data: unknown) => void): void;

    // Stop this component's running @task
    cancel(): void;

    // Optimistic list mutations (reconciled when the next action lands)
    appendOptimistic<T>(prop: string, item: T): void;
    removeOptimistic<T>(prop: string, match: (item: T) => boolean): void;
  };
}

export {};
