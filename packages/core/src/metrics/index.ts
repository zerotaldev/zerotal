/**
 * In-process HTTP request metrics (the `@zerotal/core/metrics` subpath) —
 * request counts by status class, latency (avg / p95 / max), and short-window
 * throughput. Recorded once per request by the server and surfaced on the admin
 * Health page; best-effort, memory-safe, and reset on process restart.
 *
 * @example
 * ```ts
 * import { httpMetrics } from "@zerotal/core/metrics";
 *
 * const snapshot = httpMetrics();
 * console.log(snapshot.total, snapshot.successRate, snapshot.p95Ms);
 * ```
 *
 * @packageDocumentation
 */
export { recordHttp, beginHttp, endHttp, httpMetrics } from "./HttpMetrics.ts";
export type { HttpMetricsSnapshot } from "./HttpMetrics.ts";
