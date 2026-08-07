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
   * Returns `unknown` — the caller asserts the stored shape. Higher-level
   * surfaces (the `Session` facade, `ctx.session` helpers) layer a generic
   * `<T>` cast on top.
   */
  get(key: string): unknown;

  /**
   * Read the value under `key` and remove it in one step ("read once").
   * Returns the stored value, or `undefined` if absent.
   */
  pull(key: string): unknown;

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
