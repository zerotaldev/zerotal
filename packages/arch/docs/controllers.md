---
title: Controllers
description: Group related request handlers into classes that map actions to routes and resolve dependencies through the container.
---

# Controllers

A controller groups related request handlers into a single class, where each
public method is an action that a route can target. Controllers are resolved
through the IoC container, so a class declaring `@inject(...)` gets its
dependencies wired up automatically.

## Basic controller

A controller is a plain class. Each action receives the request `HttpContext`
directly, reads input from it, and sets the response by calling a helper on it —
actions return `void`, not a value.

```typescript fragment
// app/controllers/PostController.ts
import type { HttpContext } from "zerotal";
import { Post } from "../models/Post.ts";

export class PostController {
  async index(ctx: HttpContext): Promise<void> {
    const posts = await Post.all();
    ctx.json({ posts });
  }

  async show(ctx: HttpContext): Promise<void> {
    const post = await Post.findOrFail(Number(ctx.params.id));
    ctx.json(post);
  }

  async store(ctx: HttpContext): Promise<void> {
    const { title, body } = await ctx.body<{ title: string; body: string }>();
    const post = await Post.create({ title, body });
    ctx.json(post, 201);
  }

  async destroy(ctx: HttpContext): Promise<void> {
    const post = await Post.findOrFail(Number(ctx.params.id));
    await post.delete();
    ctx.response = new Response(null, { status: 204 });
  }
}
```

Map routes to actions by passing the controller class and the action name:

```typescript fragment
// routes/index.ts
import { Router } from "zerotal";
import { PostController } from "../app/controllers/PostController.ts";
import { AuthMiddleware } from "@zerotal/auth";

Router.get("/posts", PostController, "index");
Router.get("/posts/:id", PostController, "show");
Router.post("/posts", PostController, "store", [AuthMiddleware]);
Router.delete("/posts/:id", PostController, "destroy", [AuthMiddleware]);
```

> **Note** — The fourth argument is the per-route middleware array:
> `Router.get(path, Controller, action, middleware?)`. See
> [Routing](/docs/routing) for groups, prefixes, and named routes.

## Dependency injection

A controller is constructed by `container.make()`, which auto-wires its
dependencies. Decorate the **class** with `@inject(...)`, listing the tokens in
constructor order — the container resolves each token and passes it to the
constructor:

```typescript fragment
// app/controllers/PostController.ts
import type { HttpContext } from "zerotal";
import { inject } from "zerotal";
import { CacheManager } from "@zerotal/cache";

@inject(CacheManager)
export class PostController {
  constructor(private cache: CacheManager) {}

  async index(ctx: HttpContext): Promise<void> {
    const posts = await this.cache.remember("posts.all", 60, () => Post.all());
    ctx.json({ posts });
  }
}
```

> **Warning** — `@inject` is a **class** decorator and only supports constructor
> injection. There is no parameter-level or property-level `@inject` — the tokens
> are listed on the class and matched to constructor parameters by position.

### Which should I use?

- **Facades** — reach for these first for one-off lookups. No constructor wiring,
  resolved from request-scoped storage on demand.
- **`@inject(...)` on the class** — when the controller depends on a service for
  most of its actions and you want it injected once at construction.

### Resolving via facades

Facades are the lightest-weight option — no constructor wiring needed. They read
the current request from `AsyncLocalStorage`, so they work anywhere in the async
tree:

```typescript
// app/controllers/DashboardController.ts
import type { HttpContext } from "zerotal";
import { Cache } from "@zerotal/cache";
import { Auth } from "@zerotal/auth";

export class DashboardController {
  async index(ctx: HttpContext): Promise<void> {
    const user = Auth.user(); // resolved from AsyncLocalStorage
    const stats = await Cache.get("stats");
    ctx.json({ user, stats });
  }
}
```

## Model binding

A route parameter whose name matches an auto-registered model is bound without any
declaration — the resolved instance arrives on `ctx.params` under the param's name,
or you can read it explicitly with `ctx.model()`. `.bind()` and the model's own
`resolveRouteBinding` are for overriding that default:

```typescript fragment
// routes/index.ts — :post already resolves through Post
Router.get("/posts/:post", PostController, "show");
```

```typescript fragment
// app/controllers/PostController.ts — via ctx.params:
async show(ctx: HttpContext<{ post: Post }>): Promise<void> {
  ctx.json(ctx.params.post);
}

// app/controllers/PostController.ts — or via ctx.model():
async show(ctx: HttpContext): Promise<void> {
  const post = ctx.model<Post>("post");
  ctx.json(post);
}
```

> **Note** — If the bound record is not found, the resolver throws a 404
> automatically — no guard needed. `ctx.model()` throws if no binding was
> registered for that param name.

## FormRequest validation

Delegate validation to a `FormRequest` class for cleaner controllers. The class
comes from `@zerotal/validator`:

```typescript
// app/requests/posts/StorePostRequest.ts
import { FormRequest, RuleBuilder } from "@zerotal/validator";

export class StorePostRequest extends FormRequest {
  // Do NOT annotate the return type — validate() infers the typed shape from it.
  // (Pipe-strings like "required|string" are Flow's @validate syntax; FormRequest
  // uses the RuleBuilder.)
  rules(r: RuleBuilder) {
    return {
      title: r.string().min(3).max(255),
      body: r.string().min(10),
      tags: r.array(r.string()).optional(),
    };
  }
}
```

`StorePostRequest.validate()` parses the request body, runs the rules, and
returns the validated data fully typed from your `rules()` return — it throws a
validation error on failure:

```typescript fragment
// app/controllers/PostController.ts
import { StorePostRequest } from "../requests/posts/StorePostRequest.ts";

async store(ctx: HttpContext): Promise<void> {
  const data = await StorePostRequest.validate(); // throws on validation failure
  const post = await Post.create(data);
  ctx.json(post, 201);
}
```

> **Tip** — Do not annotate the `rules()` return type explicitly. The static
> `validate()` infers the result shape from `ReturnType<rules>`, so an explicit
> annotation would widen the result back to `Record<string, unknown>`.

See the [Validator](/docs/validator) guide for the full rules reference.

## Resource controllers

A resource controller implements the standard seven RESTful actions:

```typescript
// app/controllers/ArticleController.ts
import type { HttpContext } from "zerotal";

export class ArticleController {
  async index(ctx: HttpContext): Promise<void> {
    /* GET /articles          */
  }
  async create(ctx: HttpContext): Promise<void> {
    /* GET /articles/create   */
  }
  async store(ctx: HttpContext): Promise<void> {
    /* POST /articles         */
  }
  async show(ctx: HttpContext): Promise<void> {
    /* GET /articles/:id      */
  }
  async edit(ctx: HttpContext): Promise<void> {
    /* GET /articles/:id/edit */
  }
  async update(ctx: HttpContext): Promise<void> {
    /* PUT /articles/:id      */
  }
  async destroy(ctx: HttpContext): Promise<void> {
    /* DELETE /articles/:id   */
  }
}
```

Register all seven with a single call, or narrow them with `.only()` / `.except()`:

```typescript fragment
// routes/index.ts
Router.resource("articles", ArticleController);
Router.resource("articles", ArticleController).only(["index", "show"]);
Router.resource("articles", ArticleController).except(["create", "edit"]);
```

> **Tip** — Generate either shape with `bun zt make:controller` — add
> `--resource` for the full CRUD stubs.

## Returning responses

Controllers set `ctx.response` via helper methods — they do not return a value
(the return type is `Promise<void>`):

```typescript fragment
// in a controller action
ctx.json(data); // 200 JSON
ctx.json(data, 201); // 201 JSON
ctx.view(MyComponent, props); // full HTML document from a view component
ctx.html("<p>fragment</p>"); // raw HTML, no DOCTYPE
ctx.redirect("/dashboard", 303); // redirect (default 302)
ctx.back(); // redirect to a same-origin Referer, else "/"
```

See the [Responses](/docs/responses) guide for the full API.

## Single-action controllers

For an action that doesn't need grouping, give the controller a single method
and name it when you register the route — a file route function works equally
well:

```typescript
// app/controllers/HealthCheckController.ts
import type { HttpContext } from "zerotal";
import { Router } from "zerotal";

export class HealthCheckController {
  async handle(ctx: HttpContext): Promise<void> {
    ctx.json({ status: "ok", uptime: Math.floor(process.uptime()) });
  }
}

Router.get("/health", HealthCheckController, "handle");
```

## Accessing the authenticated user

With `@zerotal/auth` installed, the authenticated user is available at
`ctx.user` after `AuthMiddleware` runs. The `Auth` facade exposes the same data
from anywhere in the async tree — handy inside services called by the controller:

```typescript fragment
// in a controller action
import { Auth } from "@zerotal/auth";

async store(ctx: HttpContext): Promise<void> {
  // Via ctx (optional — undefined for guests):
  const userId = ctx.user?.id;

  // Via the facade (throws ForbiddenError when not authenticated):
  const user = Auth.user();
  const id = Auth.id(); // number
}
```

> **Note** — `ctx.user` and the `Auth` facade are contributed by
> `@zerotal/auth`, not core. See [Authentication](/docs/authentication).

## After-response work

Register a callback to run after the response has been sent — useful for
expensive side effects that shouldn't block the client. `afterResponse` returns
`this`, so it chains:

```typescript fragment
// in a controller action
async store(ctx: HttpContext): Promise<void> {
  const post = await Post.create(data);
  ctx.json(post, 201);

  ctx.afterResponse(async () => {
    await NotifyFollowersJob.dispatch({ postId: post.id });
    await Cache.forget("posts.all");
  });
}
```

> **Note** — An error thrown inside an `afterResponse` callback is logged and
> swallowed; it never crashes the server or affects the already-sent response.

## References

Controller actions interact with the request through the `ctx` object
(`HttpContext`). The members used most often from a controller:

| Member                                 | Signature                   | Description                                                                                 |
| -------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------- |
| `ctx.params`                           | `Record<string, string>`    | Route params, plus resolved model bindings under their name (e.g. `/posts/:id` → `{ id }`). |
| `ctx.body<T>()`                        | `() => Promise<T>`          | Parse and cache the JSON / form request body.                                               |
| `ctx.input<T>(key, fallback?)`         | `(key, fallback?) => T`     | Read from route params → cached body → query, in order.                                     |
| `ctx.model<T>(name)`                   | `(name) => T`               | The route-model-bound instance for a param; throws if unbound.                              |
| `ctx.json(data, status?)`              | `(data, status?) => void`   | Set a JSON response (default 200).                                                          |
| `ctx.view(component, props?, status?)` | overloaded                  | Render a view component to a full HTML document.                                            |
| `ctx.html(markup, status?)`            | `(markup, status?) => void` | Set a raw HTML response (no DOCTYPE).                                                       |
| `ctx.redirect(url, status?)`           | `(url, status?) => void`    | Set a redirect response (default 302).                                                      |
| `ctx.back(status?)`                    | `(status?) => void`         | Redirect to a same-origin `Referer`, else `/`.                                              |
| `ctx.afterResponse(cb)`                | `(cb) => this`              | Run work after the response is sent.                                                        |

Container wiring for controllers:

| Member               | Signature       | Description                                                                  |
| -------------------- | --------------- | ---------------------------------------------------------------------------- |
| `@inject(...tokens)` | class decorator | Declare constructor dependencies in order; auto-wired by `container.make()`. |

## Next steps

- [Routing](/docs/routing) — map URLs to controller actions and bind models.
- [Middleware](/docs/middleware) — protect and transform requests before they reach actions.
- [Validator](/docs/validator) — the rules reference for `FormRequest` validation.
- [Responses](/docs/responses) — the full response helper API.
- [Container](/docs/container) — how `@inject` and `make()` resolve your services.
- [HttpContext](/docs/context) — the full request/response object reference.
