# @zerotal/cache

> A unified caching layer with in-memory, SQLite, and Redis drivers.

Cache database queries, computed values, and external API responses behind a single `Cache` facade. Tag related entries to invalidate them together, coalesce concurrent misses with `remember()`, and protect mutating endpoints with idempotency middleware.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add @zerotal/cache
```

## Setup

Register the provider in `bootstrap/providers.ts`:

```ts
import { CacheProvider } from "@zerotal/cache";
```

## Usage

`remember()` is the primary workhorse — on a miss it calls the factory, stores the result, and returns it. Concurrent callers for the same key coalesce, so the factory runs exactly once:

```ts
import { Cache } from "@zerotal/cache";

const posts = await Cache.remember("posts:page:1", 300, async () => {
  return Post.query().where("status", "published").orderBy("published_at", "desc").paginate(10, 1);
});
```

Basic reads, writes, and atomic counters:

```ts
await Cache.set("user:1", { id: 1, name: "Alice" }, 300); // TTL in seconds
const user = await Cache.get<{ id: number; name: string }>("user:1"); // null on miss
await Cache.forget("user:1");

await Cache.increment("page-views:posts:42");
const token = await Cache.pull<string>(`otp:${userId}`); // get + delete atomically
```

Group keys under tags so you can invalidate them together:

```ts
await Cache.tags(["posts", "public"]).set("posts:page:1", data, 300);
await Cache.tags(["posts"]).flush(); // busts every "posts"-tagged key
```

Protect mutating routes against double-execution via the `Idempotency-Key` header:

```ts
import { IdempotencyMiddleware, Cache } from "@zerotal/cache";

Router.post("/api/orders", [OrderController, "store"], {
  middleware: [IdempotencyMiddleware.with({ cache: Cache.instance() })],
});
```

## Exports

| Export                                                       | Description                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| `Cache`                                                      | Facade over the configured cache driver.                      |
| `CacheManager`, `TaggedCache`                                | The underlying manager and tag-scoped view.                   |
| `CacheProvider`                                              | Service provider — register in `bootstrap/providers.ts`.      |
| `CacheConfig`, `CacheConfigShape`                            | Config factory and its type.                                  |
| `IdempotencyMiddleware`, `IdempotencyOptions`                | Replay-safe middleware for mutating requests.                 |
| `CacheDriver`, `MemoryDriver`, `SqliteDriver`, `RedisDriver` | Driver contract and built-in drivers for custom registration. |
| `errors`                                                     | Typed error vocabulary (re-exported).                         |

Subpath exports:

- `@zerotal/cache` — the public API above.
- `@zerotal/cache/commands` — `CacheClearCommand` for the CLI.

## Documentation

- [Cache](../../docs/cache.md)
