import { modelByName } from "@zerotal/orm";
import { MediaItem } from "../MediaItem.ts";
import { ConversionRunner } from "./ConversionRunner.ts";
import { resolveCollection, hasCollection, type CollectionHost } from "../collections/resolve.ts";
import { mediaState } from "../state.ts";
import type { ConversionMap } from "../types.ts";

/**
 * Work that a queued conversion job performs, plus the dispatch that puts it
 * there.
 *
 * `@zerotal/queue` is imported dynamically and only from {@link dispatchConversionJob},
 * which is itself only reached when the container already has a `queue` binding.
 * That is what lets `@zerotal/media` list the queue as neither a dependency nor
 * a peer.
 */

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
 * Queue a conversion job.
 *
 * If the dispatch itself fails — no queue driver, a Redis that just went away —
 * the conversion runs inline instead. A thumbnail generated on the request
 * thread is worse than one generated on a worker, and much better than one that
 * never appears at all.
 */
export async function dispatchConversionJob(mediaId: number, conversions: string[]): Promise<void> {
  try {
    const [{ PerformConversionsJob }, { Queue, JobRegistry }] = await Promise.all([
      import("./PerformConversionsJob.ts"),
      import("@zerotal/queue"),
    ]);

    // The worker deserialises by class name, so the class has to be findable
    // before the job is popped — not merely before it is pushed.
    JobRegistry.register(PerformConversionsJob);

    await Queue.dispatch(new PerformConversionsJob(mediaId, conversions));
  } catch {
    await performConversions(mediaId, conversions);
  }
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
