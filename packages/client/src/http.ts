import { ApiClientError } from "./errors.ts";
import { CircuitBreakerOpenError } from "./CircuitBreaker.ts";

// ── Path & query ───────────────────────────────────────────────────────────────

/** Replace `{param}` placeholders in a path; throws on a missing param. */
export function interpolatePath(
  path: string,
  params: Record<string, string | number> | undefined,
): string {
  if (!params) return path;
  return path.replace(/\{(\w+)\}/g, (_, key: string) => {
    const val = params[key];
    if (val === undefined) {
      throw new ApiClientError(0, "Bad Request", `Missing path parameter: "${key}"`);
    }
    return String(val);
  });
}

/**
 * Serialize a query object to a string, supporting nested arrays/objects with bracket notation:
 *   { ids: [1, 2] }                 → ids[]=1&ids[]=2
 *   { filter: { status: "open" } }  → filter[status]=open
 *   { page: 2, active: true }       → page=2&active=true
 * `undefined` and `null` values are skipped.
 */
export function serializeQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return "";
  const pairs: [string, string][] = [];
  for (const [key, value] of Object.entries(query)) _appendQuery(pairs, key, value);
  if (pairs.length === 0) return "";
  return "?" + new URLSearchParams(pairs).toString();
}

function _appendQuery(pairs: [string, string][], key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) _appendQuery(pairs, `${key}[]`, item);
  } else if (typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      _appendQuery(pairs, `${key}[${k}]`, v);
    }
  } else {
    pairs.push([key, value instanceof Date ? value.toISOString() : String(value)]);
  }
}

export function buildUrl(base: string, path: string, query?: Record<string, unknown>): string {
  return base.replace(/\/+$/, "") + path + serializeQuery(query);
}

// ── Body serialization ──────────────────────────────────────────────────────────

/**
 * Turn a request body into a `BodyInit`. Plain objects/arrays are JSON-encoded (and get a JSON
 * Content-Type); `FormData`, `Blob`/`File`, `URLSearchParams`, `ArrayBuffer`/typed arrays, and
 * raw strings pass straight through so `fetch` can set the appropriate Content-Type itself
 * (e.g. multipart boundaries for `FormData`).
 */
export function serializeBody(body: unknown): { body: BodyInit | undefined; contentType?: string } {
  if (body === undefined || body === null) return { body: undefined };
  if (typeof body === "string") return { body };
  if (
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  ) {
    return { body: body as BodyInit };
  }
  return { body: JSON.stringify(body), contentType: "application/json" };
}

// ── Timeout / abort ──────────────────────────────────────────────────────────────

/** Combine a caller-supplied signal with a timeout into one `AbortSignal` (fresh per attempt). */
export function timeoutSignal(
  timeoutMs?: number,
  userSignal?: AbortSignal,
): AbortSignal | undefined {
  const signals: AbortSignal[] = [];
  if (userSignal) signals.push(userSignal);
  if (timeoutMs && timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs));
  if (signals.length === 0) return undefined;
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

// ── Cookies ──────────────────────────────────────────────────────────────────────

/** Read a cookie value from `document.cookie` (URL-decoded), or undefined outside the browser.
 *  Local parser by design: this package runs in browsers and cannot import
 *  server-side @zerotal/core (whose parseCookieHeader covers the server case). */
export function readCookie(name: string): string | undefined {
  const doc = (globalThis as { document?: { cookie?: string } }).document;
  if (!doc?.cookie) return undefined;
  for (const part of doc.cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

// ── Retry policy ───────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Max retry attempts after the first try. Default: 2. */
  attempts?: number;
  /** HTTP methods eligible for retry. Default: idempotent verbs (GET/PUT/DELETE/HEAD/OPTIONS). */
  methods?: string[];
  /** HTTP statuses that should be retried. Default: 408, 425, 429, 500, 502, 503, 504. */
  statuses?: number[];
  /** Honor a `Retry-After` header when present. Default: true. */
  respectRetryAfter?: boolean;
  /** Compute the delay (ms) before attempt N. Default: exponential backoff + jitter. */
  backoff?: (attempt: number, retryAfterMs: number | null) => number;
}

const DEFAULT_RETRY: Required<Omit<RetryOptions, "backoff">> & Pick<RetryOptions, "backoff"> = {
  attempts: 2,
  methods: ["GET", "PUT", "DELETE", "HEAD", "OPTIONS"],
  statuses: [408, 425, 429, 500, 502, 503, 504],
  respectRetryAfter: true,
};

/** Resolve a `retry` config value to concrete options, or `null` when retry is disabled. */
export function resolveRetry(
  retry: number | RetryOptions | false | undefined,
  method: string,
): Required<Omit<RetryOptions, "backoff">> & Pick<RetryOptions, "backoff"> {
  if (retry === undefined || retry === false || retry === 0) {
    return { ...DEFAULT_RETRY, attempts: 0 };
  }
  const opts = typeof retry === "number" ? { attempts: retry } : retry;
  const merged = { ...DEFAULT_RETRY, ...opts };
  // Methods are matched case-insensitively.
  if (!merged.methods.some((m) => m.toUpperCase() === method.toUpperCase())) {
    return { ...merged, attempts: 0 };
  }
  return merged;
}

function _defaultBackoff(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) return Math.min(retryAfterMs, 30_000);
  const base = Math.min(1000 * 2 ** attempt, 30_000); // 1s, 2s, 4s, …
  return base + Math.floor(base * 0.2 * Math.random()); // up to +20% jitter
}

function _isRetryable(
  err: unknown,
  statuses: number[],
): { retry: false } | { retry: true; retryAfterMs: number | null } {
  // Circuit-breaker fast-fail — never retry.
  if (err instanceof CircuitBreakerOpenError) return { retry: false };
  // HTTP error with a retryable status.
  if (err instanceof ApiClientError) {
    return statuses.includes(err.status)
      ? { retry: true, retryAfterMs: err.retryAfterMs }
      : { retry: false };
  }
  // Abort: a timeout is transient (retry); a caller cancellation is not.
  if (err instanceof Error && err.name === "TimeoutError")
    return { retry: true, retryAfterMs: null };
  if (err instanceof Error && err.name === "AbortError") return { retry: false };
  // Anything else thrown by fetch is a network/transport error → retry.
  return { retry: true, retryAfterMs: null };
}

/** Run `fn`, retrying transient failures per `policy`. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: Required<Omit<RetryOptions, "backoff">> & Pick<RetryOptions, "backoff">,
): Promise<T> {
  const backoff = policy.backoff ?? _defaultBackoff;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= policy.attempts) throw err;
      const verdict = _isRetryable(err, policy.statuses);
      if (!verdict.retry) throw err;
      const retryAfter = policy.respectRetryAfter ? verdict.retryAfterMs : null;
      await new Promise((r) => setTimeout(r, backoff(attempt, retryAfter)));
      attempt++;
    }
  }
}
