import type { SessionDriver } from "./drivers/CookieDriver.ts";
import type { SessionContract } from "@zerotal/core/contracts";

/**
 * Per-request session store — the concrete object behind `ctx.session`.
 *
 * Created by {@link SessionMiddleware} at the start of every request (its data
 * loaded from the configured {@link SessionDriver}) and attached to the
 * `HttpContext`. Exposes a small Map-like API over a plain
 * `Record<string, unknown>`, plus flash storage and ID regeneration. All
 * mutations happen in memory; the middleware persists them after the response.
 *
 * @remarks
 * `SessionAccessor` (the `Session` facade / `ctx.session` surface most code
 * uses) forwards to this class, so the public methods here mirror that API.
 * Flash handling relies on two internal key-sets: keys flashed in the previous
 * request are swept after the current response, and keys flashed in the current
 * request are recorded (under `_flash_keys`) for the next request to sweep.
 *
 * @example
 * ```ts
 * const session = new SessionManager(id, data, driver);
 * session.set("user_id", 42);
 * session.flash("status", "Saved!");   // available on the next request only
 * const status = session.pull("status"); // read once, then removed
 * ```
 *
 * Do not instantiate directly — use the SessionMiddleware or Session facade.
 *
 * @category Lifecycle
 */
export class SessionManager implements SessionContract {
  /** @internal — read by the middleware when saving to the response */
  _id: string;
  /** @internal */
  _data: Record<string, unknown>;
  /** @internal */
  _driver: SessionDriver;

  // Keys that were flashed in the PREVIOUS request — swept after this response.
  readonly #sweepKeys: Set<string>;
  // Keys flashed in THIS request — written to `_flash_keys` by _prepareForSave().
  readonly #flashKeys = new Set<string>();

  constructor(id: string, data: Record<string, unknown>, driver: SessionDriver) {
    this._id = id;
    this._data = { ...data };
    this._driver = driver;

    // Keys stored under '_flash_keys' by the previous request's _prepareForSave()
    // will be swept after this request's response is sent.
    const prev = (this._data["_flash_keys"] as string[] | undefined) ?? [];
    this.#sweepKeys = new Set(prev);
    delete this._data["_flash_keys"];
  }

  // ── Public API ────────────────────────────────────────────────────────

  /**
   * The current session ID.
   * @category Reading
   */
  id(): string {
    return this._id;
  }

  /**
   * Read the value stored under `key`, or `undefined` if absent.
   * @category Reading
   */
  get(key: string): unknown {
    return this._data[key];
  }

  /**
   * Read the value under `key` and delete it in one step (also clears any flash
   * marker on that key).
   * @returns The stored value, or `undefined` if absent.
   * @category Flash data
   */
  pull(key: string): unknown {
    const value = this._data[key];
    delete this._data[key];
    this.#flashKeys.delete(key);
    return value;
  }

  /**
   * Store `value` under `key`, overwriting any existing entry.
   * @category Writing
   */
  set(key: string, value: unknown): void {
    this._data[key] = value;
  }

  /**
   * Report whether `key` is present in the session data.
   * @category Reading
   */
  has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this._data, key);
  }

  /**
   * Remove a single key from the session (also clears its flash marker).
   * @category Writing
   */
  forget(key: string): void {
    delete this._data[key];
    this.#flashKeys.delete(key);
  }

  /**
   * Discard all session data and pending flash markers. The ID is unchanged.
   * @category Writing
   */
  flush(): void {
    this._data = {};
    this.#flashKeys.clear();
  }

  /**
   * Store a value that survives for exactly ONE subsequent request.
   *
   * The value is written now and marked so that the next request's
   * {@link _prepareForSave} sweeps it after that request's response is sent.
   * Reading it early with {@link pull} removes both the value and its marker.
   * Used internally by `ctx.flash()`.
   *
   * @param key - Key to flash.
   * @param value - Value to make available on the next request only.
   * @category Flash data
   */
  flash(key: string, value: unknown): void {
    this._data[key] = value;
    this.#flashKeys.add(key);
  }

  /**
   * @internal — session IDs replaced by {@link regenerate} during this request.
   * SessionMiddleware destroys their server-side records after saving, so a
   * pre-regeneration ID (e.g. one planted before login) cannot stay valid in a
   * backing store like Redis until its TTL expires.
   */
  readonly _abandonedIds: string[] = [];

  /**
   * Issue a new session ID (keeping the current data), recording the old ID in
   * {@link _abandonedIds} so the middleware can destroy its server-side record.
   * Call on privilege changes such as login to prevent session-fixation attacks.
   * @category Lifecycle
   */
  regenerate(): void {
    this._abandonedIds.push(this._id);
    this._id = crypto.randomUUID();
  }

  /**
   * @internal — called by SessionMiddleware in the finally block.
   *
   * 1. Sweeps keys that were flashed in the previous request.
   * 2. Records keys flashed in this request so the next request can sweep them.
   * Returns the mutated _data for the driver to persist.
   */
  _prepareForSave(): Record<string, unknown> {
    for (const key of this.#sweepKeys) {
      delete this._data[key];
    }
    if (this.#flashKeys.size > 0) {
      this._data["_flash_keys"] = [...this.#flashKeys];
    }
    return this._data;
  }
}
