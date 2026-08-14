/**
 * In-process counters behind the monitor's AI section.
 *
 * A ring buffer, not a table: the panel answers "what is this app doing with the
 * model right now", and the durable record of that is the provider's own
 * dashboard plus whatever the app writes down deliberately. Keeping prompts in
 * a framework-owned store would make every app that installs this package a
 * place user prompts accumulate, which is not a decision this package gets to
 * make for them.
 */

/** One recorded generation. */
export interface AiDelivery {
  at: number;
  driver: string;
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  durationMs: number;
  costUsd: number;
  ok: boolean;
  refused: boolean;
  /** Already redacted by the manager — never the raw prompt. */
  preview: string;
  error?: string;
}

/** Rolled-up figures for one model. */
export interface ModelStat {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  failures: number;
  refusals: number;
  /** Median latency, in milliseconds. */
  p50: number;
  /** 95th-percentile latency, in milliseconds. */
  p95: number;
}

/** How many generations are kept. Roughly a working session's worth. */
const CAPACITY = 200;

const _deliveries: AiDelivery[] = [];

/** Record one generation. Called from the observability bridge. @internal */
export function recordDelivery(delivery: AiDelivery): void {
  _deliveries.push(delivery);
  if (_deliveries.length > CAPACITY) _deliveries.splice(0, _deliveries.length - CAPACITY);
}

/** The most recent generations, newest first. */
export function recentGenerations(limit = 50): AiDelivery[] {
  return _deliveries.slice(-limit).reverse();
}

/** Per-model roll-up over everything still in the buffer. */
export function modelStats(): ModelStat[] {
  const byModel = new Map<string, { rows: AiDelivery[]; latencies: number[] }>();

  for (const delivery of _deliveries) {
    const entry = byModel.get(delivery.model) ?? { rows: [], latencies: [] };
    entry.rows.push(delivery);
    if (delivery.ok) entry.latencies.push(delivery.durationMs);
    byModel.set(delivery.model, entry);
  }

  const out: ModelStat[] = [];
  for (const [model, { rows, latencies }] of byModel) {
    latencies.sort((a, b) => a - b);
    out.push({
      model,
      calls: rows.length,
      inputTokens: sum(rows, (r) => r.inputTokens),
      outputTokens: sum(rows, (r) => r.outputTokens),
      cacheReadTokens: sum(rows, (r) => r.cacheReadTokens),
      costUsd: sum(rows, (r) => r.costUsd),
      failures: rows.filter((r) => !r.ok).length,
      refusals: rows.filter((r) => r.refused).length,
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
    });
  }

  return out.sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls);
}

/** Share of recorded calls that the provider declined, 0–1. */
export function refusalRate(): number {
  if (_deliveries.length === 0) return 0;
  return _deliveries.filter((d) => d.refused).length / _deliveries.length;
}

/** Reset the buffer. Tests. */
export function resetStats(): void {
  _deliveries.length = 0;
}

function sum(rows: AiDelivery[], pick: (row: AiDelivery) => number): number {
  let total = 0;
  for (const row of rows) total += pick(row);
  return total;
}

/**
 * Nearest-rank percentile over a sorted list.
 *
 * Nearest-rank rather than interpolated: with a couple of dozen samples the
 * interpolation invents a latency nothing actually took, and the point of a p95
 * here is to name a request that really happened.
 */
function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length);
  return Math.round(sorted[Math.min(rank, sorted.length) - 1] ?? 0);
}
