/**
 * Which background processes are actually running.
 *
 * An app can say what it *registered* — three schedules, a queue worker — and
 * until now nothing could say whether any of it ever *ran*. That gap has a shape:
 * a team shipped to production with no worker process, and every scheduled task
 * silently did not execute for weeks. No inventory hold was released, no payment
 * reminder was sent, and nothing logged, because from the web process's point of
 * view nothing was wrong. They found it by going looking.
 *
 * The identical failure is a dead queue worker: jobs accumulate, nothing errors,
 * and you learn about it when a customer asks where their email went.
 *
 * ## Where the beat is kept
 *
 * In the **cache**, deliberately, rather than in a new store. The reader is a
 * different process from the writer and often a different machine, so this needs
 * shared state — and the app has already chosen where its shared state lives.
 * `sqlite` (the default) is shared across processes on one box; `redis` is shared
 * across machines; `memory` is shared with nobody.
 *
 * That last case is why {@link Heartbeat.lastSeen} distinguishes "nobody has
 * checked in" from "I cannot tell". A doctor check that reported a missing worker
 * every time an app used the memory driver would be wrong more often than it was
 * right, and a check that is usually wrong is one people learn to skip.
 *
 * @module
 */
import { currentApp } from "../application/currentApp.ts";
import type { ContainerBindings } from "../container/types.ts";

/** How long a beat stays readable. Comfortably longer than any sane interval. */
const BEAT_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Cache key prefix. Namespaced so it cannot collide with an app's own keys. */
const PREFIX = "zerotal:heartbeat:";

/** What a beat records. */
export interface Beat {
  /** ISO timestamp of the last check-in. */
  at: string;
  /** Process id, so a report can distinguish two workers from one restarting. */
  pid?: number | undefined;
  /** Free-form detail — the queue name, the schedule count. */
  detail?: string | undefined;
}

/**
 * What {@link Heartbeat.lastSeen} found.
 *
 * `unknown` is a distinct answer from `null`, and keeping them apart is the whole
 * reason this type exists: one means the worker is not running, the other means
 * this process has no way to see a worker that might be.
 */
export type BeatLookup =
  | { status: "seen"; beat: Beat; ageSeconds: number }
  | { status: "never" }
  | { status: "unknown"; reason: string };

/**
 * The slice of the cache this needs.
 *
 * Structural rather than an import of `CacheManager`: `@zerotal/core` does not
 * depend on `@zerotal/cache`, and it should not start doing so to record a
 * timestamp. Anything with these two methods will do.
 */
interface BeatStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
}

/** Resolve the cache, or `null` when there is none to resolve. */
function _cache(): BeatStore | null {
  try {
    // `cache` is declared on `ContainerBindings` by `@zerotal/cache`, which core
    // cannot see — so the key is not `keyof ContainerBindings` from here. The cast
    // is the same one `Application._runConventions` already makes for resolving a
    // token another package registered, and it is why `BeatStore` is structural:
    // nothing about this reaches into the cache package.
    return (currentApp().container.tryMake("cache" as keyof ContainerBindings) ??
      null) as BeatStore | null;
  } catch {
    return null;
  }
}

/** The configured cache driver name, or `undefined` when it cannot be read. */
function _driver(): string | undefined {
  try {
    const config = currentApp().container.tryMake("config") as
      { get<T>(k: string, d: T): T } | undefined;
    return config?.get<string>("cache.driver", "");
  } catch {
    return undefined;
  }
}

/**
 * Record and read background-process check-ins.
 *
 * @example
 * ```ts
 * // in a worker loop
 * await Heartbeat.beat("queue:default", { detail: "4 jobs" });
 *
 * // in a doctor check, or an ops page
 * const seen = await Heartbeat.lastSeen("queue:default");
 * if (seen.status === "never") warnNobodyIsWorking();
 * ```
 */
export const Heartbeat = {
  /**
   * Record that this process is alive and doing `name`.
   *
   * Never throws. A heartbeat that can take a worker down is worse than no
   * heartbeat: the whole point is to observe the worker, not to become a reason
   * it stops.
   *
   * @param name - Stable identifier, e.g. `"scheduler"` or `"queue:default"`.
   */
  async beat(name: string, extra: Omit<Beat, "at"> = {}): Promise<void> {
    const cache = _cache();
    if (!cache) return;
    try {
      await cache.set(
        `${PREFIX}${name}`,
        { at: new Date().toISOString(), pid: process.pid, ...extra } satisfies Beat,
        BEAT_TTL_SECONDS,
      );
    } catch {
      // Observability is not worth an outage.
    }
  },

  /**
   * Beat now, and keep beating until the returned function is called.
   *
   * A worker registers its schedules once and then sits in an event loop, so a
   * single beat at start-up would be indistinguishable from a worker that started
   * and died — which is the failure most worth catching. The interval is what
   * makes the check mean "is running" rather than "was once started".
   *
   * The timer is `unref`'d, so it never keeps a process alive on its own. A
   * heartbeat that stopped `zt worker` from exiting would be a bug reported as a
   * hang.
   *
   * @param name - Stable identifier.
   * @param everyMs - Beat interval. Default 60s.
   * @returns A function that stops the beating.
   */
  start(name: string, extra: Omit<Beat, "at"> = {}, everyMs = 60_000): () => void {
    void Heartbeat.beat(name, extra);
    const timer = setInterval(() => void Heartbeat.beat(name, extra), everyMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    return () => clearInterval(timer);
  },

  /**
   * When `name` last checked in.
   *
   * @returns `seen` with the age, `never` when nothing has checked in, or
   *   `unknown` when this process cannot tell — which is not the same finding and
   *   must not be reported as one.
   */
  async lastSeen(name: string): Promise<BeatLookup> {
    const driver = _driver();
    if (driver === "memory") {
      return {
        status: "unknown",
        reason:
          "the cache driver is `memory`, which is private to each process — a worker's " +
          "check-in cannot be seen from here. Use `sqlite` (shared on one box) or `redis` " +
          "(shared across machines) for this to mean anything.",
      };
    }

    const cache = _cache();
    if (!cache) return { status: "unknown", reason: "no cache is configured" };

    try {
      const beat = await cache.get<Beat>(`${PREFIX}${name}`);
      if (!beat?.at) return { status: "never" };
      const ageSeconds = Math.max(0, Math.round((Date.now() - Date.parse(beat.at)) / 1000));
      return { status: "seen", beat, ageSeconds };
    } catch (error) {
      return {
        status: "unknown",
        reason: `the cache could not be read (${(error as Error).message})`,
      };
    }
  },
};
