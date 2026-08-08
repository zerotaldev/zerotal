/**
 * `@zerotal/flow/testing` — in-process test helpers for Flow components.
 *
 * Runs the full server-side Flow request pipeline in-process for Bun's test runner:
 * no WebSocket connection is opened — actions are dispatched directly against a mounted
 * page instance, driving its real lifecycle hooks (boot/mount/hydrate/update). The entry
 * point is {@link FlowTest.mount}, which returns a chainable {@link FlowTest} exposing
 * state-driving actions (`set`/`update`/`call`) and fluent assertions (`assertSee`,
 * `assertRedirectedTo`, `assertHasErrors`, `assertFlashed`, …). `hydrate` is re-exported
 * for advanced snapshot-level tests.
 *
 * @example
 * ```ts
 * import { FlowTest } from '@zerotal/flow/testing';
 *
 * const t = await FlowTest.mount(LoginPage);
 * await t.set('email', 'test@example.com');
 * await t.set('password', 'secret');
 * await t.call('login');
 * t.assertRedirectedTo('/dashboard');
 * ```
 *
 * @example
 * ```ts
 * const t = await FlowTest.mount(CreatePostPage);
 * await t.call('save');
 * t.assertHasErrors('title');
 * t.assertSee('The title field is required.');
 * ```
 *
 * @packageDocumentation
 */

import type { Component } from "./Component.ts";
import type { FlowEffects } from "./Component.ts";
import { _renderFlowPage } from "./jsx-runtime.ts";
import { dehydrate, hydrate } from "./dehydrate.ts";
import { ValidationError } from "./validation.ts";
import type { Snapshot } from "./types.ts";

type PageClass<T extends Component> = new () => T;

/**
 * A fluent test harness around a single mounted Flow page/component. Obtain one with
 * {@link FlowTest.mount}, drive state with `set`/`update`/`call`, then chain assertions
 * against the rendered HTML, redirects, validation errors, flashes, and dispatched events.
 * Every action and assertion returns `this` (or a Promise of it) for chaining.
 *
 * @typeParam T - The Component subclass under test.
 */
export class FlowTest<T extends Component> {
  private _page: T;
  private _html: string = "";
  private _effects: FlowEffects | null = null;
  private _snapshot: Snapshot | null = null;
  private _name: string;
  /** Set by {@link tolerateErrors}: capture action errors instead of rethrowing them. */
  private _tolerateErrors = false;
  /** The last non-validation error an action threw, when {@link tolerateErrors} is on. */
  private _lastError: Error | null = null;

  private constructor(page: T, name: string) {
    this._page = page;
    this._name = name;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  /**
   * Mount a page: instantiate it, seed optional props, run its initial-request lifecycle
   * (`onBoot()` then `onMount()`), render once, and return the harness for chaining.
   *
   * @param PageClass - The Component subclass to mount.
   * @param props - Optional initial property values assigned before `onMount()` runs.
   * @returns A resolved {@link FlowTest} wrapping the mounted page.
   * @category Lifecycle
   *
   * @example
   * ```ts
   * const t = await FlowTest.mount(DashboardPage);
   * ```
   */
  static async mount<T extends Component>(
    PageClass: PageClass<T>,
    props: Partial<T> = {},
  ): Promise<FlowTest<T>> {
    const page = new PageClass();
    page._flowId = `test-${PageClass.name.toLowerCase()}`;
    page._flowPath = "/test";

    Object.assign(page, props);
    // Initial request lifecycle: boot() runs on every request, then mount() once.
    await page.onBoot();
    await page.onMount();

    const t = new FlowTest<T>(page, PageClass.name);
    await t._render();
    return t;
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Set a property value directly (state seeding) and re-render, then return for
   * chaining. Does NOT fire the updating/updated hooks — use `update()` to
   * simulate a client-driven property change.
   *
   * The re-render is the point: without it `html()` and every assertion that reads
   * it would still describe the render from *before* the assignment, so a test
   * would silently assert against stale markup. Use {@link seed} when you are
   * assigning several properties and only want to pay for one render.
   * @category Actions
   */
  async set(prop: keyof T, value: unknown): Promise<this> {
    (this._page as Record<string, unknown>)[prop as string] = value;
    await this._render();
    return this;
  }

  /**
   * Assign a property without re-rendering — the batching form of {@link set}.
   * Nothing reads the new value until the next `set`/`update`/`call` (or an
   * explicit {@link render}) produces a fresh render.
   * @category Actions
   *
   * @example
   * ```ts
   * await t.seed('step', 3);
   * await t.seed('mode', 'advanced');
   * await t.render();          // one render for both
   * ```
   */
  async seed(prop: keyof T, value: unknown): Promise<this> {
    (this._page as Record<string, unknown>)[prop as string] = value;
    return this;
  }

  /** Re-render the page without changing state (pairs with {@link seed}). @category Actions */
  async render(): Promise<this> {
    await this._render();
    return this;
  }

  /**
   * Simulate a client-driven property update (as a `value`/`checked` input or
   * `$flow.$set` would produce): routes through the allowlist and fires the
   * `onUpdating()` / `onUpdated()` hooks (and their per-property variants), then
   * re-renders.
   * @category Actions
   */
  async update(prop: keyof T, value: unknown): Promise<this> {
    await this._page._applyClientUpdate(prop as string, value);
    await this._render();
    return this;
  }

  /**
   * Opt out of the rethrow in {@link call}: a throwing action is captured on the
   * harness instead of failing the test, so the error path itself can be asserted.
   *
   * Only for tests *about* error handling. Leaving it off is what makes a broken
   * action fail its test rather than look like a no-op.
   * @category Actions
   *
   * @example
   * ```ts
   * const t = (await FlowTest.mount(CheckoutPage)).tolerateErrors();
   * await t.call('submit');
   * t.assertErrored(/payment gateway/);
   * ```
   */
  tolerateErrors(): this {
    this._tolerateErrors = true;
    return this;
  }

  /** The last non-validation error an action threw, or null. @category Actions */
  lastError(): Error | null {
    return this._lastError;
  }

  /**
   * Assert the last action threw, optionally matching its message.
   * Requires {@link tolerateErrors} — without it a throwing action fails the test outright.
   * @category Assertions
   */
  assertErrored(match?: string | RegExp): this {
    if (!this._lastError) {
      throw new Error(
        `[FlowTest] Expected the last action on ${this._name} to throw, but it did not.`,
      );
    }
    if (match !== undefined) {
      const message = this._lastError.message;
      const ok = typeof match === "string" ? message.includes(match) : match.test(message);
      if (!ok) {
        throw new Error(
          `[FlowTest] Expected the error message to match ${String(match)}, but got: ${message}`,
        );
      }
    }
    return this;
  }

  /**
   * Call an action method and re-render. Simulates a subsequent (WebSocket) request:
   * runs `onBoot()` + `onHydrate()`, invokes the method, then `onUpdate()` and re-render.
   *
   * A `ValidationError` is an expected outcome: the errors are stored and the page
   * re-renders with the error bag populated, exactly as in production.
   *
   * Any other error is routed to `onError()` (mirroring production) and then
   * **rethrown**, so a broken action fails its test instead of silently rendering
   * an unchanged page. Call {@link tolerateErrors} first when the error path is
   * what you are testing.
   *
   * @param method - Name of the method to invoke on the page.
   * @param args - Arguments forwarded to the method.
   * @throws If `method` is not a function on the page instance.
   * @throws Whatever the action threw, unless it was a `ValidationError` or
   *   {@link tolerateErrors} is on.
   * @category Actions
   */
  async call(method: string, ...args: unknown[]): Promise<this> {
    const fn = (this._page as Record<string, unknown>)[method];
    if (typeof fn !== "function") {
      throw new Error(`[FlowTest] Method "${method}" not found on ${this._name}`);
    }

    // Each call simulates a subsequent (WebSocket) request: boot() then hydrate().
    await this._page.onBoot();
    await this._page.onHydrate();

    this._lastError = null;
    let thrown: Error | null = null;

    try {
      await (fn as (...a: unknown[]) => unknown).apply(this._page, args);
    } catch (error) {
      if (error instanceof ValidationError) {
        // Errors already stored on page._errors — a normal, assertable outcome.
      } else {
        thrown = error instanceof Error ? error : new Error(String(error));
        this._lastError = thrown;
        // Run the production error hook so its side effects (the default flashes
        // the message) are observable either way. An onError that itself throws
        // replaces the original — surfacing the deeper bug rather than hiding it.
        try {
          await this._page.onError(thrown);
        } catch (hookError) {
          thrown = hookError instanceof Error ? hookError : new Error(String(hookError));
          this._lastError = thrown;
        }
      }
    }

    await this._page.onUpdate();
    this._effects = this._page._drainEffects();
    await this._render();

    // Rethrow after the re-render, so an opted-in test still sees the rendered
    // error state and a non-opted-in test gets the real stack.
    if (thrown && !this._tolerateErrors) throw thrown;
    return this;
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  private async _render(): Promise<void> {
    const compId = this._page._flowId;

    if (!this._effects) {
      this._html = await _renderFlowPage(this._page, () => this._page.render()).catch(() => "");
    } else {
      if (!this._effects.redirectUrl) {
        this._html = await _renderFlowPage(this._page, () => this._page.render()).catch(() => "");
      }
    }

    // dehydrate() hook runs at the end of the request, before serialisation.
    await this._page.onDehydrate();
    this._snapshot = dehydrate(this._page, {
      id: compId,
      name: this._name,
      path: this._page._flowPath,
    });
  }

  // ── HTML assertions ────────────────────────────────────────────────────────

  /**
   * Assert the rendered HTML contains the given string.
   * @category Assertions
   */
  assertSee(text: string): this {
    if (!this._html.includes(text)) {
      throw new Error(
        `[FlowTest] Expected to see "${text}" but it was not found in:\n${this._html}`,
      );
    }
    return this;
  }

  /**
   * Assert the rendered HTML does NOT contain the given string.
   * @category Assertions
   */
  assertDontSee(text: string): this {
    if (this._html.includes(text)) {
      throw new Error(`[FlowTest] Expected NOT to see "${text}" but it was found in the HTML.`);
    }
    return this;
  }

  // ── Redirect assertions ────────────────────────────────────────────────────

  /**
   * Assert the last action redirected to the given URL.
   * @category Assertions
   */
  assertRedirectedTo(url: string): this {
    const actual = this._effects?.redirectUrl;
    if (actual !== url) {
      throw new Error(`[FlowTest] Expected redirect to "${url}" but got: ${actual ?? "(none)"}`);
    }
    return this;
  }

  /**
   * Assert the last action did NOT redirect.
   * @category Assertions
   */
  assertNotRedirected(): this {
    if (this._effects?.redirectUrl) {
      throw new Error(`[FlowTest] Expected no redirect but got: ${this._effects.redirectUrl}`);
    }
    return this;
  }

  // ── Validation assertions ──────────────────────────────────────────────────

  /**
   * Assert that a validation error exists for the given field, optionally that one of
   * its messages contains `message`.
   * @category Assertions
   */
  assertHasErrors(field: string, message?: string): this {
    const errors = this._page._errors;
    if (!errors[field] || errors[field]!.length === 0) {
      throw new Error(`[FlowTest] Expected validation error for "${field}" but none found.`);
    }
    if (message && !errors[field]!.some((m) => m.includes(message))) {
      throw new Error(
        `[FlowTest] Expected error for "${field}" to contain "${message}" but got: ${errors[field]!.join(", ")}`,
      );
    }
    return this;
  }

  /**
   * Assert no validation errors exist.
   * @category Assertions
   */
  assertNoErrors(): this {
    const count = Object.keys(this._page._errors).length;
    if (count > 0) {
      const summary = Object.entries(this._page._errors)
        .map(([f, msgs]) => `  ${f}: ${msgs.join(", ")}`)
        .join("\n");
      throw new Error(`[FlowTest] Expected no validation errors but found:\n${summary}`);
    }
    return this;
  }

  // ── Flash assertions ───────────────────────────────────────────────────────

  /**
   * The full flash payloads emitted by the last action (title/position/duration/…).
   * @category Assertions
   */
  flashes(): FlowEffects["flashes"] {
    return this._effects?.flashes ?? [];
  }

  /**
   * Assert a flash notification was emitted, optionally filtered by `level` and/or a
   * substring of its `message`.
   * @category Assertions
   */
  assertFlashed(level?: string, message?: string): this {
    const flashes = this._effects?.flashes ?? [];
    const match = flashes.find(
      (f) => (!level || f.level === level) && (!message || f.message.includes(message)),
    );
    if (!match) {
      const desc = [level, message].filter(Boolean).join("/");
      throw new Error(
        `[FlowTest] Expected flash "${desc}" but flashes were: ${JSON.stringify(flashes)}`,
      );
    }
    return this;
  }

  // ── Event assertions ───────────────────────────────────────────────────────

  /**
   * Assert a cross-component event was dispatched by the last action.
   * @category Assertions
   */
  assertDispatched(eventName: string): this {
    const events = this._effects?.events ?? [];
    if (!events.some((e) => e.name === eventName)) {
      throw new Error(
        `[FlowTest] Expected event "${eventName}" to be dispatched but it wasn't. Events: ${events.map((e) => e.name).join(", ") || "(none)"}`,
      );
    }
    return this;
  }

  // ── State accessors ────────────────────────────────────────────────────────

  /**
   * Get the rendered HTML.
   * @category State
   */
  html(): string {
    return this._html;
  }

  /**
   * Get the last drained effects (flashes, events, redirect, downloads).
   * @category State
   */
  effects(): FlowEffects | null {
    return this._effects;
  }

  /**
   * Get the current page state snapshot.
   * @category State
   */
  snapshot(): Snapshot | null {
    return this._snapshot;
  }

  /**
   * Get the current page instance (for direct property inspection).
   * @category State
   */
  page(): T {
    return this._page;
  }

  /**
   * Get current validation errors.
   * @category State
   */
  errors(): Record<string, string[]> {
    return this._page._errors;
  }
}

// ── Re-export hydrate for advanced use ────────────────────────────────────────
export { hydrate } from "./dehydrate.ts";
