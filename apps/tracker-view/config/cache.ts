import { CacheConfig } from "@zerotal/cache";
import type { CacheConfigShape } from "@zerotal/cache";
import { env } from "zerotal";

/**
 * The dashboard's aggregates are the only thing cached, and 30 seconds is the
 * whole policy.
 *
 * Short on purpose. A tracker where the counts lag a minute behind the board is
 * a tracker people stop trusting, and the queries are cheap — the cache is here
 * to show the seam and to keep a dashboard refresh from re-counting the table,
 * not because anything was slow.
 *
 * `sqlite` rather than `memory` so the cache survives a restart and is visible
 * as a file, which is the point of a cookbook: `memory` would work and teach
 * nothing about where the entries went.
 *
 * The cast is the same one `config/queue.ts` carries — `env()` returns `string`
 * and `driver` is a literal union. See T10.
 */
export default CacheConfig({
  driver: env("CACHE_DRIVER", "sqlite") as CacheConfigShape["driver"],
  prefix: env("CACHE_PREFIX", "tracker:"),
  ttl: env("CACHE_TTL", 3600),
  sqlite: {
    path: env("CACHE_SQLITE_PATH", "./database/cache.sqlite"),
  },
});
