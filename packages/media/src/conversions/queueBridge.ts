import { optionalPeer } from "@zerotal/core/runtime";
import { modelByName } from "@zerotal/orm";
import { MediaItem } from "../MediaItem.ts";
import { ConversionRunner } from "./ConversionRunner.ts";
import { resolveCollection, hasCollection, type CollectionHost } from "../collections/resolve.ts";
import { mediaState } from "../state.ts";
import type { ConversionDispatcher } from "./dispatch.ts";
import type { ConversionMap } from "../types.ts";

/**
 * Work that a queued conversion job performs, plus the dispatch that puts it
 * there.
 *
 * `@zerotal/queue` is an optional peer of this package. It is loaded only by
 * {@link queuedConversions}, which `MediaProvider` calls only when the container
 * already has a `queue` binding, and its types are declared below rather than
 * imported, so an app without a queue neither loads nor type-checks against it.
 */

// ── The slice of @zerotal/queue this package uses ─────────────────────────────

/** A queued job, as the queue sees one. */
export interface QueueJob {
  readonly queue: string;
  payload(): Record<string, unknown>;
  handle(): Promise<void>;
}

/** `Job` from `@zerotal/queue`: the base class a job extends. */
export type QueueJobBase = abstract new () => QueueJob;

/** A job class the registry can store and the worker can rebuild from a payload. */
export type QueueJobClass = (new (...args: never[]) => QueueJob) & { jobName?: string };

/** The exports of `@zerotal/queue` the bridge calls. */
export interface QueueModule {
  Job: QueueJobBase;
  JobRegistry: { register(jobClass: QueueJobClass): void };
  Queue: { dispatch(job: QueueJob): Promise<void> };
}

/**
 * Load `@zerotal/queue`.
 *
 * @throws OptionalPeerMissingError when it is not installed. Reached only with a
 *   `queue` binding registered, so that means an install that lost the package.
 */
export async function loadQueue(): Promise<QueueModule> {
  const queue: QueueModule = await import("@zerotal/queue" as string).catch(
    optionalPeer("@zerotal/queue", { feature: "Queued media conversions (`queued: true`)" }),
  );
  return queue;
}

/**
 * Register the conversions job and return the dispatcher that queues it.
 *
 * Registered here, at boot, rather than on the first dispatch: a worker process
 * pops jobs it never dispatched, and finds the class by name only if something
 * registered it first.
 *
 * @param queue - The loaded queue package. Defaults to loading it.
 */
export async function queuedConversions(queue?: QueueModule): Promise<ConversionDispatcher> {
  const { Job, JobRegistry, Queue } = queue ?? (await loadQueue());
  const { definePerformConversionsJob } = await import("./PerformConversionsJob.ts");
  const PerformConversionsJob = definePerformConversionsJob(Job);
  JobRegistry.register(PerformConversionsJob);

  // If the dispatch itself fails (no queue driver, a Redis that just went away),
  // the conversion runs inline instead. A thumbnail generated on the request
  // thread is worse than one generated on a worker, and much better than one that
  // never appears at all.
  return async (mediaId, conversions) => {
    try {
      await Queue.dispatch(new PerformConversionsJob(mediaId, conversions));
    } catch {
      await performConversions(mediaId, conversions);
    }
  };
}

/** Regenerate a named set of conversions for one media row. */
export async function performConversions(
  mediaId: number,
  conversions: string[],
): Promise<{ generated: string[]; failed: Array<{ name: string; reason: string }> }> {
  const empty = {
    generated: [] as string[],
    failed: [] as Array<{ name: string; reason: string }>,
  };

  const media = await MediaItem.find(mediaId);
  if (media === null) return empty;

  const ownerClass = ownerClassFor(media.modelType);
  if (ownerClass === null || !hasCollection(ownerClass, media.collectionName)) return empty;

  const declared = resolveCollection(ownerClass, media.collectionName).conversions ?? {};

  const wanted: ConversionMap = {};
  for (const name of conversions) {
    const conversion = declared[name];
    if (conversion !== undefined) wanted[name] = conversion;
  }

  const state = mediaState();
  return new ConversionRunner(state.driver, state.config).run(media, wanted);
}

/**
 * Look up a model class by the name stored in `model_type`.
 *
 * The ORM registry is populated by model discovery, so this resolves anything
 * under `app/models/`. A type that is not registered — a model defined inline in
 * a test, say — yields null and the job becomes a no-op, rather than a job that
 * can never succeed retrying until it exhausts its attempts.
 */
export function ownerClassFor(modelType: string): CollectionHost | null {
  const found = modelByName(modelType);
  return (found as CollectionHost | undefined) ?? null;
}
