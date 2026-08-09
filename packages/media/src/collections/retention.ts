import { MediaItem } from "../MediaItem.ts";
import type { CollectionDefinition } from "../types.ts";

/**
 * Trim a collection back to what its rules allow, after something was added.
 *
 * `single` is `onlyKeepLatest(1)` under a friendlier name — an avatar or a hero
 * image, where a second upload replaces the first rather than joining it.
 *
 * Deletion goes through `MediaItem.delete()` on each row rather than a bulk query,
 * so the files behind the rows go too. A bulk delete would leave every
 * superseded avatar on disk forever, which is the bug this exists to avoid.
 *
 * @param justAdded - The item that triggered the trim; never removed, even if
 *   its sort position would otherwise put it outside the window.
 */
export async function applyRetentionRules(
  modelType: string,
  modelId: number | string,
  collection: string,
  definition: CollectionDefinition,
  justAdded: MediaItem,
): Promise<void> {
  const keep = definition.single === true ? 1 : definition.onlyKeepLatest;
  if (keep === undefined || keep < 1) return;

  // Newest first: highest order, then highest id as the tiebreak for items added
  // within the same order slot.
  const rows = await MediaItem.query()
    .where("model_type", modelType)
    .where("model_id", String(modelId))
    .where("collection_name", collection)
    .orderBy("order_column", "desc")
    .orderBy("id", "desc")
    .get();

  const survivors = new Set<unknown>([justAdded.id]);
  for (const row of rows) {
    if (survivors.size >= keep) break;
    survivors.add(row.id);
  }

  for (const row of rows) {
    if (survivors.has(row.id)) continue;
    await row.delete();
  }
}
