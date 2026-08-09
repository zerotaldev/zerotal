---
title: Routing
description: Explicit routes, groups, file-based routes, model binding, domains, and testing — the whole routing surface on one page.
---

# Routing

The router maps incoming HTTP requests to the controller, view, or closure that
should handle them, and is where you declare your application's URLs. Zerotal
offers two complementary styles — **explicit** routes declared in route files and
**file-based** routes discovered automatically from a directory tree. Both
register into the same `Router` singleton and can be mixed freely in one app.

Routing ships inside `@zerotal/core`, so there is no package to install or
provider to register — the `Router` is available as soon as your app boots.

## Getting Started

```typescript
// routes/index.ts
import { Router, route } from "zerotal";
```

## Basic usage

Register a `GET` route to a controller action, or to an inline closure:

```typescript
// routes/index.ts
import { Router } from "zerotal";

Router.get("/users", UserController, "index");
Router.get("/", (ctx) => ctx.html`<h1>Home</h1>`);
```

A `GET /users` request now runs `UserController.index`, and `GET /` returns the
inline HTML.

## Which routing style should I use?

- **Explicit routes** (`routes/index.ts`) — best when you want every URL visible
  in one place, fine-grained control over names and ordering, or resource/group
  helpers. Start here.
- **File-based routes** (a directory tree) — best for large apps where the URL
  map mirrors the filesystem, or for page-heavy frontends. Opt in per app.

The two compose: file routes register first during boot, then explicit routes run
and take precedence on duplicate `METHOD + path` keys. See
[route registration order](#route-registration-order) for the full precedence
rules.

## Explicit routes

### HTTP verbs

```typescript
// routes/index.ts
Router.get("/users", UserController, "index");
Router.post("/users", UserController, "store");
Router.put("/users/:id", UserController, "update");
Router.patch("/users/:id", UserController, "update");
Router.delete("/users/:id", UserController, "destroy");
```

Each call returns a `RouteRegistration` you can chain:

```typescript
// routes/index.ts
Router.get("/posts/:slug", PostController, "show").name("posts.show").bind("post", Post);
```

#### Per-route middleware

Pass middleware classes as the fourth argument:

```typescript
// routes/index.ts
Router.get("/dashboard", DashboardController, "index", [AuthMiddleware]);
Router.post("/posts", PostController, "store", [AuthMiddleware, ThrottleMiddleware]);
```

#### Inline closure handlers

Every verb method also accepts a closure instead of a `Controller`/action pair —
handy for small endpoints that don't warrant a controller. The handler receives
the same request `HttpContext` a controller action does; raw route params and
resolved model bindings live on `ctx.params`:

```typescript
// routes/index.ts
import { Router, type HttpContext } from "zerotal";

Router.get("/", (ctx) => ctx.html`<h1>Home</h1>`);
Router.get("/health", (ctx) => ctx.json({ ok: true }));

// Raw route params arrive on ctx.params — type them with HttpContext<{ ... }>:
Router.get("/posts/:slug", (ctx: HttpContext<{ slug: string }>) =>
  ctx.json({ slug: ctx.params.slug }),
);
```

Middleware is passed as the **third** argument in closure form (there's no action
name), and the returned `RouteRegistration` still chains `.name()` / `.bind()`:

```typescript
// routes/index.ts
Router.get("/admin", (ctx) => ctx.json({ ok: true }), [AuthMiddleware]);
Router.get("/posts/:post", (ctx: HttpContext<{ post: Post }>) =>
  ctx.json({ post: ctx.params.post }),
).bind("post", Post);
```

> **Note** — Zerotal distinguishes the two forms by the third argument: a string is
> treated as a controller action; anything else (a middleware array or nothing)
> means the second argument is a closure handler.

### Resource routes

`Router.resource()` registers all seven RESTful actions in one call:

```typescript
// routes/index.ts
Router.resource("posts", PostController);
```

| Method   | Path              | Action    |
| -------- | ----------------- | --------- |
| `GET`    | `/posts`          | `index`   |
| `GET`    | `/posts/create`   | `create`  |
| `POST`   | `/posts`          | `store`   |
| `GET`    | `/posts/:id`      | `show`    |
| `GET`    | `/posts/:id/edit` | `edit`    |
| `PUT`    | `/posts/:id`      | `update`  |
| `DELETE` | `/posts/:id`      | `destroy` |

`PATCH /:id` is also registered and maps to `update`, so both `PUT` and `PATCH`
are accepted.

#### Filtering actions

```typescript
// routes/index.ts
// Register only these actions
Router.resource("photos", PhotoController).only(["index", "show"]);

// Register everything except these
Router.resource("tags", TagController).except(["create", "edit"]);
```

#### Resource middleware

```typescript
// routes/index.ts
Router.resource("comments", CommentController, [AuthMiddleware]);
```

### View routes

Register a GET route that renders a `@zerotal/core` JSX component directly —
no controller class needed for simple pages:

```typescript
// routes/index.ts
import { AboutPage } from "../resources/views/AboutPage.tsx";
import { DashboardPage } from "../resources/views/DashboardPage.tsx";

// Static props — evaluated once at registration
Router.view("/about", AboutPage, { title: "About Us" });

// Dynamic props — factory is called on each request
Router.view("/dashboard", DashboardPage, (ctx) => ({
  user: ctx.user,
  greeting: `Hello, ${ctx.user?.name ?? "guest"}`,
}));

// No props
Router.view("/privacy", PrivacyPage);

// With middleware
Router.view("/settings", SettingsPage, (ctx) => ({ user: ctx.user }), [AuthMiddleware]);
```

The route chains `.name()` and `.withLayout()`:

```typescript
// routes/index.ts
Router.view("/about", AboutPage).name("about").withLayout(AppLayout);
```

### Static file serving

Serve a local directory under a URL prefix:

```typescript
// routes/index.ts
Router.static("/assets", "./public/assets");
Router.static("/uploads", "public/uploads");

// With cache headers
Router.static("/assets", "./public", {
  headers: { "Cache-Control": "public, max-age=31536000, immutable" },
});
```

Any `GET /assets/logo.svg` resolves to `./public/assets/logo.svg`, served with
Bun's native file streaming. Returns 404 for missing files. By default every file
is pre-registered at boot as a static `Response` (zero JS per request); pass
`eager: false` to fall back to a per-request lookup.

### Markdown file serving

Serve a directory of `.md` files as rendered HTML pages:

```typescript
// routes/index.ts
Router.markdown("/docs", "./docs");

// With parser options and a fallback title
Router.markdown("/docs", "./docs", {
  title: "Zerotal Docs",
  headings: { ids: true },
});
```

URL mapping: `GET /docs/orm` → `./docs/orm.md` (also tries `./docs/orm/index.md`
for bare directory paths). Uses `Bun.markdown.html()` with GFM extensions
(tables, strikethrough, tasklists, autolinks) enabled by default.

### Raw routes

Register a handler that receives the raw `Request` and bypasses the entire global
middleware pipeline — no `HttpContext`, no session, no auth. Useful for internal
health checks or asset endpoints:

```typescript
// routes/index.ts
Router.raw("GET", "/__ping", () => new Response("pong"));
Router.raw("GET", "/health", async () => {
  const ok = await db
    .query("SELECT 1")
    .then(() => true)
    .catch(() => false);
  return Response.json({ ok });
});
```

> **Warning** — Raw routes skip every middleware (session, CSRF, auth). Only use
> them for endpoints that must not run the pipeline. They are compiled last and
> take precedence over same-path pipeline routes.

### Flow routes

Added by the `@zerotal/flow` package:

```typescript
// routes/index.ts
import { Router } from "zerotal";

Router.flow("/dashboard", DashboardPage);
Router.flow("/chat", ChatPage, [AuthMiddleware]);
```

See the [Flow](/docs/flow) guide for full details.

## Route groups

Groups apply a shared prefix and/or middleware stack to a set of routes. Groups
nest — prefix and middleware accumulate.

```typescript
// routes/index.ts
Router.group({ prefix: "/api/v1" }, () => {
  Router.get("/users", UserController, "index");
  Router.post("/users", UserController, "store");
  // → GET /api/v1/users, POST /api/v1/users
});
```

```typescript
// routes/index.ts
Router.group({ prefix: "/api/v1", middleware: AuthMiddleware }, () => {
  Router.resource("posts", PostController);
});
```

A group is bookkeeping applied while its callback runs, not a runtime wrapper.
Routes register themselves with the accumulated prefix and middleware already
baked in, so grouping costs nothing per request. The surrounding state is restored
even when the callback throws, so one broken group cannot leak its prefix into the
routes declared after it.

### Named middleware groups

Define a group of middleware classes under a string key, then reference it by
name:

```typescript
// in a ServiceProvider or bootstrap
Router.middlewareGroup("api", [ThrottleMiddleware, JsonMiddleware]);
Router.middlewareGroup("web", [SessionMiddleware, CsrfMiddleware]);

// Reference by name
Router.group({ prefix: "/api", middleware: "api" }, () => {
  Router.resource("posts", PostController);
});

// Mix names and classes
Router.group({ middleware: ["web", AuthMiddleware] }, () => {
  Router.get("/dashboard", DashboardController, "index");
});
```

Naming a stack once and referring to it keeps the definition in one place, which
matters most when the stack changes: adding a middleware to the `web` group applies
it everywhere that group is used instead of requiring an edit at every call site.

### Nested groups

```typescript
// routes/index.ts
Router.group({ prefix: "/admin" }, () => {
  Router.group({ middleware: [AuthMiddleware, AdminMiddleware] }, () => {
    Router.get("/dashboard", AdminController, "dashboard").name("admin.dashboard");
    Router.resource("users", AdminUserController);
  });
});
```

The three options compose differently as groups nest, which is worth knowing before
relying on it:

| Option       | Nesting behaviour                                                    |
| ------------ | -------------------------------------------------------------------- |
| `prefix`     | Concatenates outer then inner — `/admin` + `/users` → `/admin/users` |
| `middleware` | Appends, outermost first, so the outer stack runs earlier            |
| `domain`     | Replaces — an inner `domain` overrides the outer one entirely        |

Because middleware order follows nesting depth, an outer `AuthMiddleware` runs
before an inner `AdminMiddleware`. Put the checks that should fail fastest — or
that the inner ones depend on, such as resolving the current user — in the outer
group.

### Domain & subdomain routing

The `domain` option scopes a group of routes to a specific host. Dynamic `:label`
segments are captured and exposed on the context via `ctx.subdomains`.

```typescript
// routes/index.ts
import { Router } from "zerotal";

// Static host
Router.group({ domain: "admin.app.com" }, () => {
  Router.get("/", AdminController, "dashboard");
});

// Dynamic subdomain — captured as ctx.subdomains.tenant
Router.group({ domain: ":tenant.app.com" }, () => {
  Router.get("/", DashboardController, "index");
});
```

```typescript
// app/controllers/DashboardController.ts
class DashboardController {
  index(ctx: HttpContext) {
    ctx.subdomains; // { tenant: 'acme' } for acme.app.com
    ctx.subdomain("tenant"); // 'acme'  (or null)
  }
}
```

Routes that share a path across different hosts are dispatched by host at request
time.

> **Warning** — Register specific domains before wildcards — the first matching
> host wins, just like route ordering. A domain-only path returns `404` for a
> host that doesn't match and has no plain (domain-less) fallback. `domain`
> composes with `prefix` and `middleware` in the same group.

#### With multi-tenancy

`@zerotal/tenancy`'s `SubdomainResolver` resolves the tenant _model_ from the same
subdomain a domain group captures, so the two compose directly:

```typescript
// routes/index.ts
Router.group({ domain: ":tenant.app.com" }, () => {
  Router.get("/dashboard", DashboardController, "index");
  // ctx.subdomains.tenant === the resolved tenant slug; TenantContext holds the model
});
```

Configuring the resolver is covered in [Multi-tenancy](/docs/tenancy).

## Named routes

Assign a name and generate URLs from it:

```typescript
// routes/index.ts
Router.get("/posts/:slug", PostController, "show").name("posts.show");

// Generate the URL with route()
route("posts.show", { slug: "hello-world" }); // → '/posts/hello-world'
route("search", { q: "zerotal", page: 2 }); // → '/search?q=zerotal&page=2'
```

Extra params that don't match a `:segment` become query-string entries.

Naming is what lets a path change without a sweep through templates: the URL lives
in one place and every link asks for it by name. A dotted convention —
`posts.show`, `admin.users.edit` — keeps names sorted and readable as the table
grows, and mirrors the grouping the routes already sit in.

> **Warning** — `route()` throws if the route name is unknown or a required param
> is missing.

Throwing rather than returning a broken string is deliberate: a typo surfaces the
first time the code runs instead of shipping a link to a 404. Run
[`bun zt route:list`](#the-routelist-command) to see every registered name.

## File-based routing

Map a directory tree to routes: each file under the routes directory becomes an
endpoint, with `_middleware.ts` for shared middleware.

Opt in with `app.fileBasedRouting()` in `bootstrap/app.ts`, passing a map of
named route groups (each `web`/`api` group brings its own default prefix and
middleware) to directories:

```typescript
// bootstrap/app.ts
import { Application, basePath } from "zerotal";
import providers from "./providers";

const app = Application.create({ providers }).fileBasedRouting({
  web: basePath("app/routes"),
});
```

The scanner walks the directory and converts file paths to URL paths
automatically.

### File → URL mapping

| File path                 | URL                    |
| ------------------------- | ---------------------- |
| `index.ts`                | `/`                    |
| `about.ts`                | `/about`               |
| `users/index.ts`          | `/users`               |
| `users/[id].ts`           | `/users/:id`           |
| `(admin)/users/index.ts`  | `/users`               |
| `api/users/[id]/posts.ts` | `/api/users/:id/posts` |
| `blog/[...slug].ts`       | `/blog/*`              |

Rules in order: `(group)` directory segments are stripped (no URL contribution);
`[...slug]` becomes `*` (catch-all); `[param]` becomes `:param` (dynamic
segment); `index` becomes the directory URL.

### Handler exports

A file may export handlers for one or more HTTP verbs:

```typescript
// app/routes/users/[id].ts
import type { HttpContext } from "zerotal";

export async function GET(ctx: HttpContext): Promise<void> {
  const user = await User.findOrFail(Number(ctx.params.id));
  ctx.json(user);
}

export async function DELETE(ctx: HttpContext): Promise<void> {
  const user = await User.findOrFail(Number(ctx.params.id));
  await user.delete();
  ctx.response = new Response(null, { status: 204 });
}
```

`export default` is a GET alias when no explicit `GET` export exists:

```typescript
// app/routes/api/v2/status.ts
import type { HttpContext } from "zerotal";

export default async function (ctx: HttpContext): Promise<void> {
  ctx.json({ status: "ok", uptime: Math.floor(process.uptime()) });
}
```

### Auto-generated route names

File routes are automatically named following the RESTful convention:

| URL              | Method   | Auto-name           |
| ---------------- | -------- | ------------------- |
| `/`              | `GET`    | `home`              |
| `/about`         | `GET`    | `about`             |
| `/about`         | `POST`   | `about.store`       |
| `/api/users`     | `GET`    | `api.users.index`   |
| `/api/users`     | `POST`   | `api.users.store`   |
| `/api/users/:id` | `GET`    | `api.users.show`    |
| `/api/users/:id` | `PUT`    | `api.users.update`  |
| `/api/users/:id` | `DELETE` | `api.users.destroy` |

Override with the `meta` export:

```typescript
// app/routes/api/v2/posts/[id].ts
export const meta = {
  GET: { name: "api.v2.posts.show" },
  DELETE: { name: "api.v2.posts.destroy" },
};
```

### Directory middleware

Place a `_middleware.ts` file in any directory to protect all routes under it.
The scanner walks from the root down to the file's directory and stacks
middleware outermost-first:

```typescript
// app/routes/api/v2/me/_middleware.ts
import { RequireAuthMiddleware } from "../../../middleware/RequireAuthMiddleware.ts";

export const middleware = [RequireAuthMiddleware];
```

For `app/routes/api/v2/me/posts.ts` the stack would be:

1. `app/routes/_middleware.ts` (if present)
2. `app/routes/api/_middleware.ts` (if present)
3. `app/routes/api/v2/_middleware.ts` (if present)
4. `app/routes/api/v2/me/_middleware.ts` ← adds `RequireAuthMiddleware`

#### Route groups in file trees

Use `(group)` directory names to apply shared `_middleware.ts` without affecting
URLs:

```text
app/flow/pages/
  (auth)/              ← GuestMiddleware
    login.tsx          → /login
    register.tsx       → /register
  (protected)/         ← AuthMiddleware
    dashboard.tsx      → /dashboard
    profile.tsx        → /profile
  index.tsx            → /
```

### Flow component files

When `@zerotal/flow` is installed, the file scanner recognises Flow
`Component` class exports and registers them automatically without any extra
configuration. Verb handlers (`POST`, `DELETE`, etc.) in the same file still
register normally alongside the page:

```typescript
// app/flow/pages/(protected)/dashboard.tsx
import type { HttpContext } from "zerotal";

export default class DashboardPage extends Component {
  /* ... */
}

// Optional: form handler lives in the same file
export async function POST(ctx: HttpContext): Promise<void> {
  /* ... */
}
```

## Route-model binding

Resolve a route parameter straight to a model instance before the controller
runs, with an automatic 404 when the record is missing.

### Implicit binding

Because every model under `app/models/` is
[auto-registered](/docs/conventions#models-appmodels), binding is automatic: a
route param whose name matches a model resolves to a loaded instance with no
configuration. `:user` resolves via `User`, `:post` via `Post`, `:blogPost` via
`BlogPost` (and a plural `:users` resolves to `User` too, via singularization).

```typescript
// routes/index.ts — nothing to declare:
Router.get("/users/:user", UserController, "show");

// app/controllers/UserController.ts — :user is already a loaded User
// (or a 404 was thrown first):
async show(ctx: HttpContext<{ user: User }>) {
  return ctx.json({ user: ctx.params.user });
}
```

Resolution uses `Model.findOrFail(value)` on the primary key; a missing record
throws `ModelNotFoundError` (404) before the controller runs. Implicit binding
only fires for params whose name maps to a model — `:id`, `:slug`, `:page`, and
other non-model params stay raw strings.

#### The model owns its lookup

A model that resolves by something other than its primary key says so once, on the
model, rather than at every route that mentions it. Declare
`static resolveRouteBinding` and it is used wherever that model binds:

```typescript
// app/models/User.ts
@table("users")
export class User extends Model {
  static override async resolveRouteBinding(value: string, ctx: HttpContext, param: string) {
    // One model can answer for several segments — branch on the param, not the URL.
    if (param === "username") return this.where("username", value).firstOrFail();
    return this.findOrFail(value);
  }
}
```

It receives the matched value, the request context, and the **name of the segment**
that matched. Branching on `param` is what lets `/users/:user` and
`/users/:username/posts` resolve differently without the model knowing any route's
shape; `ctx` is there for lookups that depend on the request, such as scoping to the
current tenant.

Because it is a static, a subclass inherits it, and everything that binds a model —
controllers, [Flow pages](/docs/flow/routing), file routes — goes through it. Return
anything you like; throwing `ModelNotFoundError` (as `firstOrFail`/`findOrFail` do)
is what produces the 404.

### When bindings resolve

Bindings resolve **after every middleware on the route, immediately before the
controller**. That ordering is a guarantee, not an implementation detail:

- A middleware that short-circuits — an auth guard returning 401, a tenant
  scope returning 403 — does so **before any binding query runs**. A protected
  route therefore answers the same way whether or not the record exists, rather
  than leaking that difference as 404-vs-401 to an unauthenticated caller.
- Middleware runs with the raw string still on `ctx.params`. If a middleware
  needs the record itself, load it there — it cannot rely on the binding.
- A `ModelNotFoundError` unwinds back out through the middleware, so their
  `finally` blocks (session persistence, for example) still run.

#### Opting out and customising

Two static properties on the model control implicit binding:

```typescript
// app/models/User.ts
@table("users")
export class User extends Model {
  // Never bind this model implicitly (the :user param stays a raw string):
  static implicitBinding = false;

  // Or claim a different param name than the class name:
  static implicitBindingKey = "author"; // now :author resolves via User, and :user does not
}
```

`implicitBindingKey` **replaces** the name convention — a model that claims
`:author` no longer answers to `:user`.

> **Tip** — Need to resolve by something other than the primary key (e.g. a
> slug)? Prefer [`static resolveRouteBinding`](#the-model-owns-its-lookup) — it
> applies everywhere the model binds. Reach for an explicit
> [per-route binding](#per-route-binding) when the override belongs to one route
> rather than to the model; explicit bindings always win over implicit ones.

### Explicit binding

There are exactly two ways to change how a param resolves, and they differ only in
scope: put it on the **model** when it is how that model always resolves, or on the
**route** when it belongs to that one route.

```typescript
// in a controller — either way, it is already resolved
async show(ctx: HttpContext) {
  const user = ctx.model<User>('user');  // no DB call needed here
  return ctx.json({ user });
}
```

If the record is not found, a `ModelNotFoundError` (404) is thrown before the
controller runs.

#### Per-route binding

Overrides the model's own resolution for a single route:

```typescript
// routes/index.ts
Router.get("/posts/:post", PostController, "show").name("posts.show").bind("post", Post);

// Custom per-route resolver
Router.get("/articles/:article", ArticleController, "show").bind("article", (value) =>
  Article.where("slug", value).firstOrFail(),
);
```

#### Receiving bindings in controllers

The resolved instance is available two ways — via `ctx.model()`, or on
`ctx.params` under the param's name:

```typescript
// in a controller — via ctx.model()
async show(ctx: HttpContext) {
  const post = ctx.model<Post>('post');
  ctx.json(post);
}

// via ctx.params
async show(ctx: HttpContext<{ post: Post }>) {
  ctx.json(ctx.params.post);
}

// mixed — model + raw route param
async comments(ctx: HttpContext<{ post: Post; tab: string }>) {
  const { post, tab } = ctx.params;
  ctx.json({ post, tab, comments: await post.comments().all() });
}
```

`ctx.params` is one part of the request context every handler receives — reading
input, sending responses, headers, flash, and after-response hooks all live on the
same object. See [HttpContext](/docs/context) for that surface.

## Route registration order

1. `app.fileBasedRouting()` directories are scanned and registered during boot.
2. Explicit route files run and register their routes.
3. `Router.raw()` routes are compiled last and take precedence over same-path
   pipeline routes.

Within explicit routes, last registration wins for duplicate `METHOD + path`
keys — registering the same path twice overwrites the first.

For resource routes, register literal paths **before** dynamic ones when there is
a naming conflict:

```typescript
// routes/index.ts
// Correct — /posts/create is matched before /posts/:slug
Router.get("/posts/create", PostController, "showCreate");
Router.get("/posts/:slug", PostController, "show");
```

## Route inspection

### The route:list command

Print a table of all registered routes:

```bash
# in your project root
bun zt route:list

# Filter by method
bun zt route:list --method GET
bun zt route:list -m DELETE

# Filter by path substring
bun zt route:list --path /api
bun zt route:list -p /users

# Show only named routes
bun zt route:list --name

# Include middleware column
bun zt route:list --verbose
bun zt route:list -v
```

### Programmatic inspection

```typescript
// anywhere after boot
Router.routes; // ReadonlyMap<string, RouteDefinition>
Router.namedRoutes; // ReadonlyMap<string, string>  (name → path)

// Middleware attached to a specific route
Router.middlewareFor("GET", "/dashboard"); // MiddlewareClass[]
```

## Testing

Use `HttpContext.fake()` to unit-test controllers and route handlers without a
running server:

```typescript
// src/tests/PostController.test.ts
import { HttpContext } from "zerotal";

const ctx = HttpContext.fake("http://localhost/posts/42", { method: "GET" });
ctx.params = { id: "42" };

await new PostController().show(ctx);
// assert ctx.response
```

For full integration tests, boot the real app with `createTestApp()` from
`@zerotal/testing` and exercise it over real requests:

```typescript
// src/tests/PostTest.ts
import { beforeAll, afterAll, it } from "bun:test";
import { createTestApp, type TestApp } from "@zerotal/testing";
import { app } from "../bootstrap/app.ts";

let testApp: TestApp;
beforeAll(async () => (testApp = await createTestApp(() => app)));
afterAll(() => testApp.close());

it("returns the post", async () => {
  const post = await Post.create({ title: "Hello" });
  const res = await testApp.get(`/posts/${post.id}`);
  res.assertStatus(200);
  res.assertJson({ title: "Hello" });
});
```

See [HTTP Tests](/docs/testing/http) for the full client and assertion surface.

## References

### Router methods

| Method                                             | Signature                                                   | Description                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `Router.get` / `post` / `put` / `patch` / `delete` | `(path, Controller, action, mw?)` or `(path, handler, mw?)` | Register a route for an HTTP verb (controller action or closure handler). Returns a `RouteRegistration`. |
| `Router.resource`                                  | `(name, Controller, mw?): ResourceRouteBuilder`             | Register the seven RESTful routes; chain `.only()` / `.except()`.                                        |
| `Router.view`                                      | `(path, Component, props?, mw?): ViewRegistration`          | Render a JSX view with no controller.                                                                    |
| `Router.static`                                    | `(prefix, dir, options?)`                                   | Serve a directory of static files.                                                                       |
| `Router.markdown`                                  | `(prefix, dir, options?)`                                   | Serve `.md` files as rendered HTML.                                                                      |
| `Router.raw`                                       | `(method, path, handler)`                                   | Handle the raw `Request`, bypassing the middleware pipeline.                                             |
| `Router.flow`                                      | `(path, Page, mw?)`                                         | Register a Flow page (added by `@zerotal/flow`).                                                         |
| `Router.group`                                     | `(options, fn)`                                             | Share a `prefix`, `middleware`, and/or `domain` across routes.                                           |
| `Router.middlewareGroup`                           | `(name, [...])`                                             | Define a reusable, named middleware stack.                                                               |

### Registration chaining

Every route registration returns a chainable handle:

| Chain                             | Signature                                     | Effect                                                     |
| --------------------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| `.name(name)`                     | `(name): RouteRegistration`                   | Name the route for `route()` URL generation.               |
| `.bind(param, target)`            | `(param, modelOrResolver): RouteRegistration` | Per-route model binding; overrides the global one.         |
| `.withLayout(layout)`             | `(layout): ViewRegistration`                  | Wrap a view route's output in a layout (view routes only). |
| `.only([...])` / `.except([...])` | `(actions): this`                             | Limit which resource actions are registered.               |

### URLs, inspection and CLI

| API                                    | Signature                           | Description                                                            |
| -------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| `route(name, params?)`                 | `(name, params?): string`           | Build a URL from a named route; extra params become the query string.  |
| `Router.routes` / `Router.namedRoutes` | `ReadonlyMap`                       | Read the registered route and name maps.                               |
| `Router.middlewareFor(method, path)`   | `(method, path): MiddlewareClass[]` | List the middleware attached to a route.                               |
| `HttpContext.fake(url?, init?)`        | `(url?, init?): HttpContext`        | Build a fake context for unit tests.                                   |
| `bun zt route:list`                    | —                                   | Print every route (`-m` method, `-p` path, `--name`, `-v` middleware). |

## Next steps

- [Controllers](/docs/controllers) — move route logic out of closures.
- [Middleware](/docs/middleware) — protect and transform requests.
- [HttpContext](/docs/context) — the request/response object actions receive.
- [Multi-tenancy](/docs/tenancy) — resolve a tenant from the subdomain a group scopes to.
- [HTTP Tests](/docs/testing/http) — boot the real app and assert over requests.
