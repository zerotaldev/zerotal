/**
 * Tab-count caching. The list page's filter-tab badges (`COUNT(*) … WHERE …`)
 * are read on every list view but only change when a record is created /
 * updated / deleted. We cache the per-resource count map and let the
 * {@link AdminProvider} invalidate it from the ORM's `ModelChanged` event, so
 * counts stay correct no matter where the write came from (admin or otherwise).
 *
 * Cache is best-effort: if no cache driver is bound (e.g. isolated tests), the
 * counts are simply computed each time.
 */
import { Cache } from "@zerotal/cache";

const PREFIX = "zerotal:admin:counts:";
/** Safety-net TTL (1h) in case an invalidation is ever missed. */
const TTL = 3600;

/** Return the cached tab-count map for a slug, computing + caching on a miss. */
export async function rememberTabCounts(
  slug: string,
  compute: () => Promise<Record<string, number>>,
): Promise<Record<string, number>> {
  try {
    return await Cache.remember(`${PREFIX}${slug}`, TTL, compute);
  } catch {
    // No cache bound — fall back to a direct computation.
    return compute();
  }
}

/** Drop the cached counts for a slug (called when its records change). */
export async function forgetTabCounts(slug: string): Promise<void> {
  try {
    await Cache.forget(`${PREFIX}${slug}`);
  } catch {
    /* best-effort */
  }
}
