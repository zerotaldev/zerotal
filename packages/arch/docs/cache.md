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

## Counters

`increment()` adds to a number in one step and returns the new total. `decrement()` subtracts.

```ts fragment
// in a controller
import { Cache } from "@zerotal/cache";

const signups = await Cache.increment(`signups:${today}`, 1, 86_400); // 1, then 2, then 3
await Cache.increment("credits:42", 0.5);
await Cache.decrement("credits:42", 2);
```

The addition happens inside the driver (an upsert on SQLite, `INCRBYFLOAT` on Redis), so two processes counting at once do not lose an update. Reading with `get()`, adding, and writing back does lose one whenever the two interleave, and for a counter that is always an under-count.

A key that is absent, expired, or holds something other than a number counts as `0`. The `ttl` applies when the call creates the entry and is not extended by later additions, so a daily counter expires with the day it started. A custom driver that does not implement `increment` gets a read followed by a write, which is correct in one process and not across several.

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
import { BearerTokenMiddleware } from "@zerotal/auth";

const cache = app.container.makeSync("cache") as CacheManager;

// Per-route (recommended — protects only mutation endpoints).
// After the middleware that authenticates the route, so the key is scoped to its user.
Router.post("/api/orders", [OrderController, "store"], {
  middleware: [BearerTokenMiddleware, IdempotencyMiddleware.with({ cache })],
});

// Global — applied to all matching methods. It runs after the session and the session's
// user, but before any route middleware, so it never sees a user a route's token sets.
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

### Whose key it is

A key belongs to the caller who sent it and to the endpoint it was sent to. A stored response is replayed only to a request with the same **scope**, method, host, URL path, query string and key, so another user who picks the same key, or the same user sending it to a different host, path or query (`/charge?account=1` and `/charge?account=2`, or two tenants on `acme.example.com` and `globex.example.com`), runs the handler and gets their own answer. The stored response, the in-process wait and the cross-process lock all use that one key, and the lock name also carries the cache's prefix, so two caches never share any of them.

The default scope is the authenticated user (`ctx.user`), else a session the client sent back, else none. A user who signed in with a personal access token is scoped by the token's subject type as well as the id, so a `team` and a `user` that share an id never share a key; a user set any other way, by the session or a JWT, is scoped by id alone, so if two kinds of subject with the same id can reach the route that way, pass a `scope` that includes the type. A session counts only when the request carried its cookie and the driver accepted it ([`ctx.session.resumed()`](/docs/session#reading-and-writing)): a session started for this request is a new one each time, and scoping by it would make every retry run the handler again. The scope is read when the request reaches this middleware, so register it **after** whatever sets them. Middleware you add with `app.use()` already runs after the session middleware and the one that loads the logged-in user, which providers install. On a route that authenticates with a token, list it after the token middleware, as above. Registered before them, every request looks anonymous.

A request with no user and no returned session is unscoped: any such caller who sends the same key to the same method, host, path and query is handed the stored response. That is what lets a client that keeps no cookies have its retry replayed, and it is also why clients should send random keys (a UUID v4). An endpoint whose anonymous responses are private should not take idempotency keys from anonymous callers, or should pass a `scope`.

A handler can change who the caller is. A registration or a sign-in signs them in, a sign-out signs them out, a second-factor step finishes a sign-in, and each of those can give the session a new id. A browser's first request has no session cookie at all, so it is unscoped, but the session middleware starts a session for it. Either way the client's retry carries the cookie this response set, and the auth and session middleware give it a different scope from the one the first request had. So when the handler runs, its answer is also stored under the scope read after it has finished. The session auth middleware signs the retry in from the session's `user_id`, so a handler that changed it decides that scope even if `ctx.user` still names the caller it started with: a new `user_id` stores the answer under that user and under the session whose cookie the response carries (a session waiting on its second factor holds a `user_id` that does not sign the retry in), and a removed one under that session. A handler that left `user_id` alone has its answer stored under the user on `ctx.user`, else that session. A retry that reaches the same process with a new session's cookie while a cookieless first request is still running waits for it.

Only a request whose handler ran stores anything. One that was replayed, or that waited on another request with the same key, is answered from what is already stored and writes nothing, so replaying a client that keeps no cookies never grows the cache. The cost falls on a client with no cookie whose first answer was lost, or that sent the key twice at once: the request that is replayed or waits is given a session of its own, and a retry that carries that session's cookie runs the handler again. Pass a `scope` if such clients matter. An answer is never copied to the unscoped key and a scoped request never falls back to it, so another user or session sending the same key runs the handler. All of this applies only to the default scope; a `scope` you pass is used as it is.

Pass `scope` when the caller is identified some other way, for example by an API key that your own middleware has already verified:

```ts fragment
// ApiKeyMiddleware (yours, listed earlier) stored the verified client's id
IdempotencyMiddleware.with({ cache, scope: (ctx) => ctx.getInternal<string>("apiClientId") });
```

Return a value the request has proved, never a header the client can set to anything. Returning `undefined` makes the request unscoped.

### Options

| Option         | Default                           | Description                                                                |
| -------------- | --------------------------------- | -------------------------------------------------------------------------- |
| `cache`        | required                          | `CacheManager` instance that stores idempotent responses.                  |
| `ttl`          | `86400`                           | Seconds to retain the stored response. After expiry the key can be reused. |
| `methods`      | `["POST","PUT","PATCH","DELETE"]` | Methods subject to idempotency checks.                                     |
| `header`       | `"Idempotency-Key"`               | Header name the client sends.                                              |
| `validateBody` | `false`                           | Return 422 if the same key arrives with a different request body.          |
| `scope`        | user, else resumed session        | `(ctx) => string \| undefined`: whose key it is. See above.                |

### Behaviour details

- **5xx responses are never cached** — transient errors don't permanently block retries.
- **Concurrent in-process requests** with the same key, from the same scope to the same method, host, path and query, coalesce — the second caller waits for the first to finish and receives the same response.
- **Cross-process requests** are serialized by a distributed lock (the [lock primitive](/docs/lock)) when a lock driver is configured, so only one node executes the handler per key. This is on by default; pass `useLock: false` to disable. Without a lock driver it degrades to shared-backend replay (Redis or SQLite). The host is part of the key, so behind a proxy every node must receive the client's `Host` header, not its own address, for the nodes to share a key.

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

| Method      | Signature                                                              | Description                                                            |
| ----------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `get`       | `get<T>(key: string): Promise<T \| null>`                              | Read a value; `null` on miss.                                          |
| `set`       | `set(key: string, value: unknown, ttl?: number): Promise<void>`        | Store a value; `ttl` in seconds, falls back to the configured default. |
| `forever`   | `forever(key: string, value: unknown): Promise<void>`                  | Store a value with no expiry.                                          |
| `has`       | `has(key: string): Promise<boolean>`                                   | Whether a (non-expired) key exists.                                    |
| `forget`    | `forget(key: string): Promise<void>`                                   | Remove a single key.                                                   |
| `flush`     | `flush(): Promise<void>`                                               | Remove every key under the current prefix.                             |
| `increment` | `increment(key: string, by = 1, ttl?: number): Promise<number>`        | Add to a number atomically and return the total; see Counters.         |
| `decrement` | `decrement(key: string, by = 1, ttl?: number): Promise<number>`        | Subtract; the same as `increment(key, -by, ttl)`.                      |
| `remember`  | `remember<T>(key, ttl: number, fn: () => Promise<T> \| T): Promise<T>` | Return the cached value, or compute, store, and return it.             |
| `tags`      | `tags(tagNames: string[]): TaggedCache`                                | Scope subsequent operations to a tag group.                            |
| `dispose`   | `dispose(): void`                                                      | Release driver resources (timers, connections).                        |

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

## Types

`IdempotencyOptions` configures `IdempotencyMiddleware.with()`: the cache, the window, the methods
and header it watches, and whose key a request's key is.

## Next steps

- [Query Builder](/docs/query-builder) — the queries you'll most often wrap in `remember()`.
- [Lock](/docs/lock) — strict cross-process locking to pair with idempotency.
- [Rate Limiting](/docs/rate-limiting) — request throttling built on the cache backend.
- [Storage](/docs/storage) — persist larger artifacts that don't belong in the cache.
