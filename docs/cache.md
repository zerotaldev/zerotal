---
title: Cache
description: Store expensive query results, computed values, and API responses so repeat reads skip the work.
---

# Cache

A unified caching layer with SQLite, Redis, and in-memory drivers. Wrap slow database queries, computed values, and external API responses in a cache so the second read is cheap, and tag related entries to invalidate them together.

## Getting Started

```bash
# in your project root
bun add @zerotal/cache
```

## Register the provider

Add `CacheProvider` to the providers array in `bootstrap/providers.ts`:

```ts
// bootstrap/providers.ts
import { CacheProvider } from "@zerotal/cache";

export default [
  // …other providers
  CacheProvider,
];
```

Registering the provider switches on the following:

- `onRegister` — binds `CacheManager` as a lazy singleton under the `cache` key, building the configured driver (sqlite, redis, or memory).
- `onBooted` — pre-resolves the `cache` singleton so the `Cache` facade works after boot, and registers the `cache:clear` console command.

> **Note** — The provider is active in the `web`, `console`, `test`, and `repl` environments.

## Configuration

Create `config/cache.ts` with the `CacheConfig()` helper so every field stays type-checked while you only override what you need:

```ts
// config/cache.ts
import { CacheConfig } from "@zerotal/cache";
import { env } from "zerotal";

export default CacheConfig({
  // One of 'sqlite' | 'redis' | 'memory', written literally: the field is that
  // union and `env()` returns a plain string.
  driver: "sqlite",
  prefix: env("CACHE_PREFIX", "zerotal:"), // prepended to every key
  ttl: env("CACHE_TTL", 3600), // default TTL in seconds (1 hour)

  sqlite: {
    path: env("CACHE_SQLITE_PATH", ":memory:"), // ':memory:' or a file path
  },
});
```

| Field         | Required | Default      | Description                                                 |
| ------------- | -------- | ------------ | ----------------------------------------------------------- |
| `driver`      | no       | `"sqlite"`   | Which backend to use: `"sqlite"`, `"redis"`, or `"memory"`. |
| `prefix`      | no       | `"zerotal:"` | Key prefix prepended to every cache key.                    |
| `ttl`         | no       | `3600`       | Default TTL in seconds when a call omits one.               |
| `sqlite.path` | no       | `":memory:"` | SQLite file path, or `":memory:"` for an in-process store.  |

> **Note** — The Redis driver connects through Bun's built-in `redis` client, which reads the `REDIS_URL` environment variable. There is no `redis` block in the cache config — set `REDIS_URL` in your `.env` instead.

## Basic operations

```ts fragment
// in a controller or service
import { Cache } from "@zerotal/cache";

// Write with TTL (seconds)
await Cache.set("user:1", { id: 1, name: "Alice" }, 300); // expires in 5 minutes

// Write with no expiry
await Cache.forever("settings:global", settings);

// Read — returns null on miss
const user = await Cache.get<{ id: number; name: string }>("user:1");

// Check existence
const exists = await Cache.has("user:1"); // boolean

// Delete one key
await Cache.forget("user:1");

// Wipe all keys for the configured prefix
await Cache.flush();
```

## remember — the primary workhorse

`remember()` checks the cache and, on a miss, calls the factory, stores the result, and returns it. Under high concurrency, multiple callers for the same key coalesce — the factory runs exactly once:

```ts fragment
function remember<T>(key: string, ttl: number, fn: () => Promise<T> | T): Promise<T>;
```

> **Tip** — Reach for `remember()` instead of a manual `get`/`set` pair. It avoids the cache stampede where many requests miss at once and all hit the database.

```ts fragment
// in a controller
import { Cache } from "@zerotal/cache";
import { Post } from "../app/models/Post.ts";

// Cache a slow database query for 5 minutes
const posts = await Cache.remember("posts:page:1", 300, async () => {
  return Post.query().where("status", "published").orderBy("published_at", "desc").paginate(10, 1);
});

// Cache an external API response for 1 hour
const rates = await Cache.remember("exchange-rates", 3600, async () => {
  const res = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
  return res.json();
});

// Per-user computed stats cached for 60 seconds
const stats = await Cache.remember(`user:${userId}:stats`, 60, async () => {
  const [posts, comments, likes] = await Promise.all([
    Post.query().where("user_id", userId).count(),
    Comment.query().where("user_id", userId).count(),
    Like.query().where("user_id", userId).count(),
  ]);
  return { posts, comments, likes };
});
```

## Tags

Group related keys under named tags so you can invalidate them together. `Cache.tags()` returns a `TaggedCache` whose keys all share a tag prefix — useful when several cache entries depend on the same underlying data:

```ts fragment
// in a controller
import { Cache } from "@zerotal/cache";

// Store with tags
await Cache.tags(["posts", "public"]).set("posts:page:1", data, 300);
await Cache.tags(["posts", "public"]).set("posts:page:2", data, 300);
await Cache.tags(["posts", "featured"]).set("posts:featured", featured, 300);
await Cache.tags([`user:${userId}`]).set(`user:${userId}:profile`, profile, 600);

// remember() with tags
const featured = await Cache.tags(["posts", "featured"]).remember("posts:featured", 300, () =>
  Post.query().where("featured", true).get(),
);

// Bust all keys under the 'posts' tag group
await Cache.tags(["posts"]).flush();

// Bust only a specific user's cache
await Cache.tags([`user:${userId}`]).flush();
```

> **Note** — `tags(["posts"]).flush()` removes every key whose tag prefix starts with `posts:`. Because the tag prefix is positional, store and flush with the tags in the same order.

### Tag-based invalidation in model hooks

```ts fragment
// app/models/Post.ts — inside a lifecycle hook or observer
async afterCreate(post: Post) {
  await Cache.tags(["posts"]).flush();
}

async afterUpdate(post: Post) {
  await Cache.tags(["posts", `post:${post.id}`]).flush();
}
```

## Batch operations

There is no multi-get primitive — batch with `Promise.all` to cut round-trips to the backend:

```ts fragment
// in a controller
import { Cache } from "@zerotal/cache";

// Read several keys at once
const [user, settings, flags] = await Promise.all([
  Cache.get("user:1"),
  Cache.get("settings"),
  Cache.get("feature-flags"),
]);

// Write several keys at once
await Promise.all([Cache.set("user:1", userData, 300), Cache.set("user:1:perms", perms, 300)]);

// Forget several keys at once
await Promise.all([
  Cache.forget("user:1"),
  Cache.forget("user:1:perms"),
  Cache.forget("user:1:stats"),
]);
```

## Drivers

| Driver     | Notes                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `"sqlite"` | Stored in a SQLite database (`:memory:` by default, or a file). Persistent when given a path. Default driver.           |
| `"redis"`  | Stored in Redis via Bun's `redis` client. Shared across instances. Use for horizontally-scaled apps. Needs `REDIS_URL`. |
| `"memory"` | In-process `Map`. Lost on restart. Fast; ideal for tests or per-request caching.                                        |

### Which driver should I use?

- **`sqlite`** (default) — single-server deployments. Point `sqlite.path` at a file to survive restarts, or leave it `:memory:` for a fast process-local cache.
- **`redis`** — multiple app instances that must share a cache. Set `REDIS_URL`.
- **`memory`** — tests and short-lived per-request caches where persistence and sharing don't matter.

### Per-use driver override

The `Cache` facade always uses the configured driver. To use a different driver for one use case, construct a `CacheManager` directly:

```ts fragment
// in a service
import { CacheManager, MemoryDriver } from "@zerotal/cache";

// A short-lived in-process cache with its own prefix and default TTL
const local = new CacheManager(new MemoryDriver(), "req:", 30);
await local.set("computed-total", total);
```

```ts fragment
new CacheManager(driver: CacheDriver, prefix?: string, defaultTtl?: number)
```

## Idempotency middleware

`IdempotencyMiddleware` prevents double-execution of mutating requests. Clients send an `Idempotency-Key` header; the first request runs normally and the response is cached. Any retry with the same key receives the stored response without re-running the handler.

`with()` needs a `CacheManager` instance — resolve the framework's bound manager from the container with `app.container.makeSync("cache")`:

```ts fragment
// routes/api.ts
import { IdempotencyMiddleware, CacheManager } from "@zerotal/cache";

const cache = app.container.makeSync("cache") as CacheManager;

// Per-route (recommended — protects only mutation endpoints)
Router.post("/api/orders", [OrderController, "store"], {
  middleware: [IdempotencyMiddleware.with({ cache })],
});

// Global — applied to all matching methods
app.use([
  IdempotencyMiddleware.with({
    cache,
    ttl: 48 * 3600, // store replays for 48 h (default: 24 h)
    validateBody: true, // 422 if same key reused with a different body
  }),
]);
```

Client side:

```http
POST /api/orders HTTP/1.1
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{ "productId": 42, "qty": 1 }
```

A replayed response includes `Idempotency-Replay: true` so clients can distinguish a live response from a cached one.

### Options

| Option         | Default                           | Description                                                                |
| -------------- | --------------------------------- | -------------------------------------------------------------------------- |
| `cache`        | required                          | `CacheManager` instance that stores idempotent responses.                  |
| `ttl`          | `86400`                           | Seconds to retain the stored response. After expiry the key can be reused. |
| `methods`      | `["POST","PUT","PATCH","DELETE"]` | Methods subject to idempotency checks.                                     |
| `header`       | `"Idempotency-Key"`               | Header name the client sends.                                              |
| `validateBody` | `false`                           | Return 422 if the same key arrives with a different request body.          |

### Behaviour details

- **5xx responses are never cached** — transient errors don't permanently block retries.
- **Concurrent in-process requests** with the same key coalesce — the second caller waits for the first to finish and receives the same response.
- **Cross-process requests** are serialized by a distributed lock (the [lock primitive](/docs/lock)) when a lock driver is configured, so only one node executes the handler per key. This is on by default; pass `useLock: false` to disable. Without a lock driver it degrades to shared-backend replay (Redis or SQLite).

## Cache warming

Pre-populate the cache at boot so the first real request is always fast. Call from a provider's `onStarted()`, which runs after the application has finished booting:

```ts fragment
// bootstrap/providers/AppServiceProvider.ts
import { ServiceProvider } from "zerotal";
import { Cache } from "@zerotal/cache";
import { Post } from "../../app/models/Post.ts";

export class AppServiceProvider extends ServiceProvider {
  override async onStarted() {
    // Warm frequently-read data
    await Cache.remember("posts:featured", 300, () =>
      Post.query().where("featured", true).limit(6).get(),
    );
  }
}
```

## Testing

Use the `memory` driver in tests for speed and isolation — it never persists between runs. The simplest path is to set `CACHE_DRIVER=memory` in `.env.test` and let the provider build a memory cache automatically.

To swap the cache for a single suite, rebind the `cache` singleton on the container before resolving the facade, then flush between tests to avoid bleed:

```ts fragment
// in test setup
import { Application } from "zerotal";
import { Cache, CacheManager, MemoryDriver } from "@zerotal/cache";

const app = currentApp();
app.container.singleton("cache", () => new CacheManager(new MemoryDriver(), "test:", 3600));

afterEach(async () => {
  await Cache.flush();
});
```

> **Tip** — Constructing `MemoryDriver` directly in a unit test (`new CacheManager(new MemoryDriver())`) lets you test cache-dependent code without booting the whole application.

## References

`Cache` is a facade over the bound `CacheManager`. Every method below is called as `Cache.xxx(...)` or on a manager you constructed yourself.

| Method     | Signature                                                              | Description                                                            |
| ---------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `get`      | `get<T>(key: string): Promise<T \| null>`                              | Read a value; `null` on miss.                                          |
| `set`      | `set(key: string, value: unknown, ttl?: number): Promise<void>`        | Store a value; `ttl` in seconds, falls back to the configured default. |
| `forever`  | `forever(key: string, value: unknown): Promise<void>`                  | Store a value with no expiry.                                          |
| `has`      | `has(key: string): Promise<boolean>`                                   | Whether a (non-expired) key exists.                                    |
| `forget`   | `forget(key: string): Promise<void>`                                   | Remove a single key.                                                   |
| `flush`    | `flush(): Promise<void>`                                               | Remove every key under the current prefix.                             |
| `remember` | `remember<T>(key, ttl: number, fn: () => Promise<T> \| T): Promise<T>` | Return the cached value, or compute, store, and return it.             |
| `tags`     | `tags(tagNames: string[]): TaggedCache`                                | Scope subsequent operations to a tag group.                            |
| `dispose`  | `dispose(): void`                                                      | Release driver resources (timers, connections).                        |

### Commands

`@zerotal/cache` ships one command:

| Command              | What it does                                             |
| -------------------- | -------------------------------------------------------- |
| `bun zt cache:clear` | Clear all cached values (`--driver` to target one store) |

### Errors

Cache errors extend `CacheError`, which extends the framework's `ZerotalError`.

| Error                       | Code                      | Raised when                                                  |
| --------------------------- | ------------------------- | ------------------------------------------------------------ |
| `CacheError`                | `E_CACHE`                 | Base class — catch this to handle any cache failure.         |
| `CacheSerializationError`   | `E_CACHE_SERIALIZATION`   | A value cannot be serialised for storage.                    |
| `CacheDeserializationError` | `E_CACHE_DESERIALIZATION` | A stored value cannot be read back — usually a shape change. |

```typescript fragment
// in a service
import { CacheDeserializationError } from "@zerotal/cache";

try {
  return await Cache.get<Report>("report:q3");
} catch (error) {
  // A deploy changed the shape — drop the entry and rebuild rather than 500.
  if (error instanceof CacheDeserializationError) {
    await Cache.forget("report:q3");
    return buildReport();
  }
  throw error;
}
```

`CacheDeserializationError` is the one that shows up in production: a cached
value written by the previous release no longer matches the type the new code
expects. Treat it as a miss, not a failure — which is what the example above
does.

> **Warning** — A value containing a circular reference or a `BigInt` raises
> `CacheSerializationError` at write time. It is a bug in the caller rather than
> a cache fault, so let it surface in development instead of swallowing it.

## Next steps

- [Query Builder](/docs/query-builder) — the queries you'll most often wrap in `remember()`.
- [Lock](/docs/lock) — strict cross-process locking to pair with idempotency.
- [Rate Limiting](/docs/rate-limiting) — request throttling built on the cache backend.
- [Storage](/docs/storage) — persist larger artifacts that don't belong in the cache.
