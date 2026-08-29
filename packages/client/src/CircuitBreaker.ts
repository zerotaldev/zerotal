import { ZerotalError } from "@zerotal/core/errors";
import { ApiClientError } from "./ApiClient.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /**
   * Number of consecutive failures required to open the circuit.
   * Default: `5`.
   */
  threshold?: number | undefined;
  /**
   * Milliseconds to wait in the open state before allowing a single probe
   * request through (transition to half-open). Default: `30_000` (30 s).
   */
  resetTimeout?: number | undefined;
  /**
   * Predicate that decides whether a thrown error counts as a failure.
   * By default, network errors and `ApiClientError` responses with status ≥ 500
   * are failures; 4xx errors are not (they indicate client mistakes, not
   * upstream outages).
   */
  isFailure?: ((error: unknown) => boolean) | undefined;
}

// ── Error thrown when the circuit is open ─────────────────────────────────────

export class CircuitBreakerOpenError extends ZerotalError {
  constructor() {
    super(
      "Circuit breaker is open — upstream service is currently unavailable",
      "E_CIRCUIT_OPEN",
      503,
    );
  }
}

// ── CircuitBreaker ────────────────────────────────────────────────────────────

/**
 * A three-state circuit breaker that wraps async operations.
 *
 * | State      | Behaviour                                                         |
 * |------------|-------------------------------------------------------------------|
 * | `closed`   | Requests pass through; consecutive failures are counted.          |
 * | `open`     | All calls immediately throw `CircuitBreakerOpenError`.            |
 * | `half-open`| One probe request is allowed through to test recovery.            |
 *
 * State transitions:
 * - **closed → open** when failure count reaches `threshold`
 * - **open → half-open** after `resetTimeout` ms have elapsed
 * - **half-open → closed** on a successful probe
 * - **half-open → open** on a failed probe (resets the timeout)
 *
 * @example
 * const breaker = new CircuitBreaker({ threshold: 3, resetTimeout: 10_000 });
 *
 * const client = createApiClient({
 *   baseUrl: 'https://api.example.com',
 *   circuitBreaker: breaker,
 * });
 */
export class CircuitBreaker {
  private _state: CircuitState = "closed";
  private _failures: number = 0;
  private _openedAt: number | undefined;
  private _probing: boolean = false; // guards a single half-open probe

  private readonly _threshold: number;
  private readonly _resetTimeout: number;
  private readonly _isFailure: (error: unknown) => boolean;

  constructor(options: CircuitBreakerOptions = {}) {
    this._threshold = options.threshold ?? 5;
    this._resetTimeout = options.resetTimeout ?? 30_000;
    this._isFailure = options.isFailure ?? _defaultIsFailure;
  }

  get state(): CircuitState {
    return this._state;
  }
  get failures(): number {
    return this._failures;
  }

  /**
   * Wrap `fn` in the circuit breaker. Throws `CircuitBreakerOpenError` when
   * the circuit is open and the reset timeout has not yet elapsed.
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this._state === "open") {
      if (Date.now() - this._openedAt! < this._resetTimeout) {
        throw new CircuitBreakerOpenError();
      }
      // Timeout elapsed — allow one probe
      this._state = "half-open";
    }

    if (this._state === "half-open") {
      // Reject concurrent calls while a probe is already in flight
      if (this._probing) throw new CircuitBreakerOpenError();
      this._probing = true;
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      if (this._isFailure(err)) {
        this._onFailure();
      }
      throw err;
    } finally {
      // Unconditional. The guard used to be `if (this._state !== "half-open")`, which released
      // the flag only when there was nothing to release: a probe that failed with a
      // non-counted error (_isFailure is `status >= 500`, so every 4xx) skipped both
      // _onSuccess and _onFailure, left the state at "half-open" with _probing stuck true, and
      // the `state === "open"` timeout branch was never reachable again. A healthy upstream
      // then 503'd forever until someone called reset().
      this._probing = false;
    }
  }

  /** Manually reset to the closed state (useful in tests or admin endpoints). */
  reset(): void {
    this._state = "closed";
    this._failures = 0;
    this._openedAt = undefined;
    this._probing = false;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _onSuccess(): void {
    this._state = "closed";
    this._failures = 0;
    this._openedAt = undefined;
    this._probing = false;
  }

  private _onFailure(): void {
    this._probing = false;

    if (this._state === "half-open") {
      // Failed probe — back to open, reset the timeout
      this._state = "open";
      this._openedAt = Date.now();
      return;
    }

    this._failures++;
    if (this._failures >= this._threshold) {
      this._state = "open";
      this._openedAt = Date.now();
    }
  }
}

// ── Default failure predicate ─────────────────────────────────────────────────

function _defaultIsFailure(error: unknown): boolean {
  if (error instanceof ApiClientError) {
    return error.status >= 500;
  }
  // Network errors, timeouts, DNS failures, etc.
  return true;
}
