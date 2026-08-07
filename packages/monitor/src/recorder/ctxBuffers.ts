/**
 * Per-request correlation buffers, keyed by the HttpContext object and GC'd with
 * it via WeakMap/WeakSet. Feature packages buffer their per-request signal here
 * (through {@link MonitorStore}'s thin delegating methods) while a request is in
 * flight; the request-lifecycle handler drains it when the request finalises so
 * the recorded row carries the real queries, N+1 flag, custom context, and payload
 * that occurred during it.
 *
 * This is the shared substrate that lets the monitor correlate cross-package
 * activity to a request without any package importing another: the ORM buffers
 * queries, the payload middleware attaches bodies, and the request/Flow-action
 * handlers collect the lot.
 */
import type { RequestQuery, RequestPayload } from "../store/types.ts";

const _ctxQueries = new WeakMap<object, RequestQuery[]>();
const _ctxNPlus = new WeakSet<object>();
const _ctxRecorded = new WeakSet<object>();
const _ctxContext = new WeakMap<object, Record<string, unknown>>();
const _ctxPayload = new WeakMap<object, RequestPayload>();

/** A request is an N+1 offender once its buffered query count crosses this. */
const NPLUS_QUERY_THRESHOLD = 25;

/** Buffer one query span against the request context it ran under. */
export function bufferQuery(ctx: object, q: RequestQuery): void {
  let arr = _ctxQueries.get(ctx);
  if (!arr) {
    arr = [];
    _ctxQueries.set(ctx, arr);
  }
  arr.push(q);
}

/** Flag the request context as having triggered an N+1 pattern. */
export function markNPlus(ctx: object): void {
  _ctxNPlus.add(ctx);
}

/** Merge custom metadata onto the request context (used by `Monitor.context`). */
export function addContext(ctx: object, data: Record<string, unknown>): void {
  _ctxContext.set(ctx, { ...(_ctxContext.get(ctx) ?? {}), ...data });
}

/** Attach captured headers/bodies to the request (used by MonitorPayloadMiddleware). */
export function addPayload(ctx: object, payload: RequestPayload): void {
  _ctxPayload.set(ctx, payload);
}

/**
 * Record-once guard for a context: returns `true` the first time it is called for
 * a given context and `false` thereafter, so a request that fires both success
 * and failure events is recorded a single time.
 */
export function markRecorded(ctx: object): boolean {
  if (_ctxRecorded.has(ctx)) return false;
  _ctxRecorded.add(ctx);
  return true;
}

/** The correlation state drained for a finalised request or Flow action. */
export interface RequestState {
  queries: RequestQuery[];
  nplus: boolean;
  context: Record<string, unknown>;
  payload: RequestPayload | null;
}

/**
 * Read and clear all buffered correlation state for a context. Called once, when
 * the request (or Flow action) that owns the context finalises.
 */
export function collectRequestState(ctx: object): RequestState {
  const queries = _ctxQueries.get(ctx) ?? [];
  const nplus = _ctxNPlus.has(ctx) || queries.length > NPLUS_QUERY_THRESHOLD;
  const context = _ctxContext.get(ctx) ?? {};
  const payload = _ctxPayload.get(ctx) ?? null;
  _ctxQueries.delete(ctx);
  _ctxNPlus.delete(ctx);
  _ctxContext.delete(ctx);
  _ctxPayload.delete(ctx);
  return { queries, nplus, context, payload };
}

/** Drop any buffered state for a context without recording it (ignored paths). */
export function discardRequestState(ctx: object): void {
  _ctxQueries.delete(ctx);
  _ctxNPlus.delete(ctx);
  _ctxContext.delete(ctx);
  _ctxPayload.delete(ctx);
}
