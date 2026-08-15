/**
 * System-level readings (memory, uptime, runtime metadata) derived from the
 * running process. CPU and disk are best-effort: Bun does not expose a portable
 * cross-platform CPU% without sampling, so we approximate from load average
 * where available and fall back to a derived value otherwise.
 */
import { cpus, loadavg, totalmem, freemem } from "node:os";
import { readFileSync } from "node:fs";
import { currentApp } from "@zerotal/core";
import { deployEnv } from "@zerotal/core";
import { httpMetrics } from "@zerotal/core/metrics";
import { ZEROTAL_VERSION_TAG } from "../version.ts";
import type { Gauge, SystemMeta } from "../store/types.ts";

/** Bun's native in-flight HTTP count, or 0 when no server is bound (console/test). */
function bunPendingRequests(): number {
  try {
    return currentApp().serverMetrics().pendingRequests;
  } catch {
    return 0;
  }
}

/**
 * Live HTTP pulse — in-flight concurrency plus the recent rate and error rate.
 * These are "right now" readings, independent of the dashboard's range tab, for the
 * Overview pulse row. Active requests come from Bun's authoritative
 * `server.pendingRequests` (https://bun.com/docs/runtime/http/metrics), falling back
 * to the in-process gauge when no server is bound.
 */
export function httpPulse(): {
  activeRequests: number;
  requestsPerSec: number;
  errorRatePct: number;
} {
  try {
    const m = httpMetrics();
    const recent = m.last5m.total;
    return {
      activeRequests: bunPendingRequests() || m.inFlight,
      requestsPerSec: Math.round((m.perMinute / 60) * 10) / 10,
      errorRatePct: recent ? +((m.last5m.errors / recent) * 100).toFixed(1) : 0,
    };
  } catch {
    return { activeRequests: 0, requestsPerSec: 0, errorRatePct: 0 };
  }
}

const BOOTED_AT = Date.now();

/**
 * Detect the current deploy SHA from the common platform env vars, falling back
 * to reading `.git/HEAD`. Returns a 7-char short SHA, or undefined when unknown.
 */
export function detectDeploy(): string | undefined {
  const env = process.env;
  const fromEnv =
    env.DEPLOY_SHA ??
    env.GIT_COMMIT ??
    env.SOURCE_VERSION ?? // Heroku
    env.RENDER_GIT_COMMIT ??
    env.VERCEL_GIT_COMMIT_SHA ??
    env.RAILWAY_GIT_COMMIT_SHA ??
    env.GITHUB_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);

  try {
    const head = readFileSync(`${process.cwd()}/.git/HEAD`, "utf8").trim();
    const ref = head.startsWith("ref:") ? head.slice(4).trim() : null;
    const sha = ref ? readFileSync(`${process.cwd()}/.git/${ref}`, "utf8").trim() : head;
    return sha.slice(0, 7);
  } catch {
    return undefined;
  }
}

/** Format a millisecond duration as `Nd Nh` / `Nh Nm` / `Nm`. */
export function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Memory / CPU / disk gauges as 0..100 percentages. */
export function systemGauges(): Gauge[] {
  const total = totalmem();
  const free = freemem();
  const usedBytes = total - free;
  const memPct = total > 0 ? Math.round((usedBytes / total) * 100) : 0;

  const cores = cpus().length || 1;
  // loadavg() is 0 on Windows; clamp to a sane 0..100 against core count.
  const load1 = loadavg()[0] ?? 0;
  const cpuPct = Math.min(100, Math.round((load1 / cores) * 100));

  const gb = (b: number) => (b / 1024 ** 3).toFixed(1);

  return [
    { label: "CPU", value: cpuPct, sub: `${cores} vCPU` },
    {
      label: "Memory",
      value: memPct,
      sub: `${gb(usedBytes)} / ${gb(total)} GB`,
    },
    // Disk is not portably available without a syscall; surface process RSS
    // share of total memory as a proxy so the gauge is meaningful, not faked.
    {
      label: "Heap",
      value: heapPct(),
      sub: heapSub(),
    },
  ];
}

function heapPct(): number {
  const mem = process.memoryUsage();
  if (!mem.heapTotal) return 0;
  return Math.min(100, Math.round((mem.heapUsed / mem.heapTotal) * 100));
}

function heapSub(): string {
  const mem = process.memoryUsage();
  const mb = (b: number) => Math.round(b / 1024 ** 2);
  return `${mb(mem.heapUsed)} / ${mb(mem.heapTotal)} MB`;
}

/** Runtime metadata for the System footer. */
export function systemMeta(opts: {
  zerotal?: string;
  region?: string;
  deploy?: string;
}): SystemMeta {
  return {
    uptime: formatUptime(Date.now() - BOOTED_AT),
    bun:
      typeof Bun !== "undefined" && Bun.version
        ? Bun.version
        : (process.versions.bun ?? process.version.replace(/^v/, "")),
    zerotal: opts.zerotal ?? ZEROTAL_VERSION_TAG,
    region: opts.region ?? process.env.FLY_REGION ?? process.env.AWS_REGION ?? "local",
    deploy: opts.deploy ?? process.env.DEPLOY_SHA?.slice(0, 7) ?? "dev",
    environment: deployEnv() || process.env.NODE_ENV || "development",
  };
}

/** Process uptime in milliseconds since the monitor booted. */
export function uptimeMs(): number {
  return Date.now() - BOOTED_AT;
}
