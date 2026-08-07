// @zerotal/cache — public API barrel

export { CacheManager, TaggedCache } from "./CacheManager.ts";
export { IdempotencyMiddleware } from "./IdempotencyMiddleware.ts";
export type { IdempotencyOptions } from "./IdempotencyMiddleware.ts";
export { CacheProvider } from "./provider/CacheProvider.ts";
export { Cache } from "./facades/Cache.ts";

// Driver exports — for custom driver registration
export type { CacheDriver } from "./drivers/CacheDriver.ts";
export { MemoryDriver } from "./drivers/MemoryDriver.ts";
export { SqliteDriver } from "./drivers/SqliteDriver.ts";
export { RedisDriver } from "./drivers/RedisDriver.ts";

// Config factory
export { CacheConfig } from "./config.ts";
export type { CacheConfigShape } from "./config.ts";

// Typed error vocabulary
export * from "./errors.ts";

// Framework instrumentation events (emitted on the core FrameworkEvents bus)
export { CacheQueried, CacheEvicted } from "./events.ts";
