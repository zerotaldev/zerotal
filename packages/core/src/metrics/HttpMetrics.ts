/**
 * In-process HTTP request metrics — request counts by status class, latency
 * (avg / p95 / max), and short-window throughput. Recorded once per request by
 * the server and surfaced on the admin Health page. Best-effort and memory-safe
 * (a bounded rolling window), reset on process restart.
 */

interface Sample {
  t: number;
  status: number;
  ms: number;
}

const WINDOW_MS = 60 * 60 * 1000; // keep ~1h of samples for percentiles/rates
const MAX_SAMPLES = 10_000; // hard cap regardless of window
const FIVE_MINUTES_MS = 5 * 60 * 1000; // the recent window for p95, error rate, and throughput

const _samples: Sample[] = [];
let _total = 0;
let _inFlight = 0;
let _2xx = 0,
  _3xx = 0,
  _4xx = 0,
  _5xx = 0;
let _sumMs = 0,
  _maxMs = 0;

/** Mark a request as started — increments the in-flight (currently-processing) gauge. */
export function beginHttp(): void {
  _inFlight++;
}

/** Mark a request as finished — decrements the in-flight gauge (floored at 0). */
export function endHttp(): void {
  if (_inFlight > 0) _inFlight--;
}

/** Record one completed request. Called by the server for every pipeline response. */
export function recordHttp(status: number, ms: number): void {
  _total++;
  _sumMs += ms;
  if (ms > _maxMs) _maxMs = ms;
  if (status >= 500) _5xx++;
  else if (status >= 400) _4xx++;
  else if (status >= 300) _3xx++;
  else _2xx++;

  const now = Date.now();
  _samples.push({ t: now, status, ms });
  const cutoff = now - WINDOW_MS;
  while (_samples.length && _samples[0]!.t < cutoff) _samples.shift();
  if (_samples.length > MAX_SAMPLES) _samples.splice(0, _samples.length - MAX_SAMPLES);
}

/** A point-in-time view of the request metrics, as shown on the Health page. */
export interface HttpMetricsSnapshot {
  /** Requests since boot. */
  total: number;
  /** Requests currently being processed (in-flight concurrency). */
  inFlight: number;
  /** 2xx + 3xx responses. */
  success: number;
  /** 4xx responses. */
  clientErrors: number;
  /** 5xx responses. */
  serverErrors: number;
  /** Success percentage (0–100). */
  successRate: number;
  /** Mean response time since boot, ms. */
  avgMs: number;
  /** 95th-percentile response time over the last 5 minutes, ms. */
  p95Ms: number;
  /** Slowest response since boot, ms. */
  maxMs: number;
  /** Requests per minute over the last 5 minutes. */
  perMinute: number;
  /** Last-5-minute totals. */
  last5m: { total: number; errors: number };
}

/** Snapshot the current metrics. */
export function httpMetrics(): HttpMetricsSnapshot {
  const now = Date.now();
  const recentSamples = _samples.filter((sample) => sample.t >= now - FIVE_MINUTES_MS);
  const sortedLatencies = recentSamples
    .map((sample) => sample.ms)
    .sort((first, second) => first - second);
  const p95 = sortedLatencies.length
    ? sortedLatencies[
        Math.min(sortedLatencies.length - 1, Math.floor(sortedLatencies.length * 0.95))
      ]!
    : 0;
  const errors = recentSamples.filter((sample) => sample.status >= 400).length;
  const success = _2xx + _3xx;
  return {
    total: _total,
    inFlight: _inFlight,
    success,
    clientErrors: _4xx,
    serverErrors: _5xx,
    successRate: _total ? Math.round((success / _total) * 100) : 100,
    avgMs: _total ? Math.round(_sumMs / _total) : 0,
    p95Ms: Math.round(p95),
    maxMs: Math.round(_maxMs),
    perMinute: Math.round(recentSamples.length / 5),
    last5m: { total: recentSamples.length, errors },
  };
}

/** @internal — test reset. */
export function _resetHttpMetrics(): void {
  _samples.length = 0;
  _total = _inFlight = _2xx = _3xx = _4xx = _5xx = _sumMs = _maxMs = 0;
}
