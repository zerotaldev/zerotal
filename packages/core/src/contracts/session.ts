/**
 * The session contract — the interface the kernel consumes so that
 * `HttpContext.flash()` / `flashed()` and any session-aware code depend on a
 * *shape*, never on `@zerotal/session`.
 *
 * `@zerotal/session` provides the implementation (`SessionManager` is what
 * lands on `ctx.session`; `SessionAccessor` backs the `Session` facade). A third
 * party can ship an alternative store and satisfy the same contract, and core is
 * none the wiser.
 *
 * @remarks
 * This file has **zero** runtime code and imports nothing — it is pure type
 * surface. The extension point is an interface the compiler enforces, so a
 * miswired implementation is a build error rather than a runtime surprise.
 *
 * @category Contracts
 */
export interface SessionContract {
  /**
   * The current session ID.
   */
  id(): string;

  /**
   * Read the value stored under `key`, or `undefined` if absent.
   *
   * Defaults to `unknown`, so the safe form — read, then narrow — still works
   * and is still the honest one for anything that came off the wire. The
   * optional `<T>` is the caller asserting a shape they control, and it lives
   * here rather than only on the facade because `ctx.session` is typed as this
   * contract: without it, `ctx.session.get<number>(k)` was a compile error while
   * `ctx.flashed<T>(k)` on the same object was not.
   *
   * Two overloads rather than one defaulted parameter: `T = unknown` would make
   * the return `T | undefined`, which is *not* the same type as `unknown` at a
   * call site TypeScript has to resolve an overload against — enough to break
   * existing `expect(session.get(k))` assertions. The un-parameterised form
   * therefore keeps its exact original signature.
   *
   * @example
   * const issuedAt = ctx.session.get<number>(SESSION_ISSUED_AT);
   * const raw = ctx.session.get(SOMETHING_EXTERNAL);   // still exactly `unknown`
   */
  get(key: string): unknown;
  get<T>(key: string): T | undefined;

  /**
   * Read the value under `key` and remove it in one step ("read once").
   * Returns the stored value, or `undefined` if absent.
   */
  pull(key: string): unknown;
  pull<T>(key: string): T | undefined;

  /**
   * Store `value` under `key`, overwriting any existing entry.
   */
  set(key: string, value: unknown): void;

  /**
   * Report whether `key` is present in the session.
   */
  has(key: string): boolean;

  /**
   * Remove a single value from the session.
   */
  forget(key: string): void;

  /**
   * Remove every value from the session. The session ID is left unchanged.
   */
  flush(): void;

  /**
   * Store a value that survives for exactly one subsequent request.
   * Backs `ctx.flash()`.
   */
  flash(key: string, value: unknown): void;

  /**
   * Issue a fresh session ID while preserving the current session data.
   * Call on any privilege change (login) to defend against session fixation.
   */
  regenerate(): void;
}
