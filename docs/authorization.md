---
title: Authorization (Roles & Permissions)
description: Authorize users against database-backed roles and permissions composed onto your models.
---

# Authorization (Roles & Permissions)

Authorize users against database-backed roles and permissions. You compose two mixins onto a model, then check abilities synchronously with `can()` and `hasRole()`.

Zerotal's authorization is **relational and DB-backed**, composed from two
independent mixins you apply to a model:

- **`Roles`** — gives the model roles (a polymorphic `model_roles` pivot).
  Roles carry their own permissions, so this alone supports `hasRole()` and
  permission checks granted _through_ roles.
- **`Permissions`** — gives the model permissions granted **directly**
  (a polymorphic `model_permissions` pivot).

Apply either on its own, or both together — in any order. When both are present,
`can()` resolves over the **union** of direct and role-derived permissions.

```typescript
// app/models/User.ts
import { AuthUser, Roles, Permissions } from "@zerotal/auth";
import { column, table } from "@zerotal/orm";

@(table("users").withTimestamps())
export class User extends Roles(Permissions(AuthUser)) {
  @column() name!: string;
  @column() email!: string;
  // note: do NOT also declare a json `roles` column — the relation is named `roles`.
}
```

## Getting Started

Roles and permissions ship inside `@zerotal/auth` — if you have followed
[Authentication](/docs/authentication) there is nothing further to install or
register.

```bash
# in your project root
bun add @zerotal/auth
```

`AuthProvider` registers the `Gate` and the RBAC relations, so adding it to
`bootstrap/providers.ts` is all the setup authorization needs. The pivot tables
come from the package's migrations — see [Schema](#schema).

## Composing the mixins

The mixins come from `@zerotal/auth`; `AuthUser` is the authenticatable base
(`Authenticatable(Model)`). Compose them in either the nested form or the
flat `Model.using` form — both are equivalent:

```typescript
// app/models/User.ts — nested form
import { AuthUser, Roles, Permissions } from "@zerotal/auth";

class User extends Roles(Permissions(AuthUser)) {}
```

```typescript
// app/models/User.ts — flat form (no wrapper nesting)
import { Model } from "@zerotal/orm";
import { Authenticatable, Roles, Permissions } from "@zerotal/auth";

class User extends Model.using(Authenticatable, Permissions, Roles) {}
```

### Which mixins do I need?

- **Roles + direct permissions** (`Roles(Permissions(AuthUser))`) — the common
  case for app users.
- **Roles only** (`Roles(AuthUser)`) — permissions still work, granted through
  roles. Good for coarse models like a `Team`.
- **Direct permissions only** (`Permissions(AuthUser)`) — no roles, e.g. API
  keys or service accounts.

```typescript fragment
// app/models/*.ts
class User extends Roles(Permissions(AuthUser)) {} // roles + direct permissions
class Team extends AuthUser.using(Roles) {} // roles only (permissions via roles)
class ApiKey extends AuthUser.using(Permissions) {} // direct permissions only
```

Each mixin exposes a per-model static flag to toggle its eager loading:

```typescript fragment
// app/models/User.ts
class User extends Roles(Permissions(AuthUser)) {
  static withRoles = true; // default — eager-load roles (+ their permissions)
  static withPermissions = true; // default — eager-load direct permissions
}
```

## Schema

The `roles` and `permissions` tables are ORM models, so they're created by
schema sync / your generated migrations. The three **polymorphic pivots** aren't
models — `AuthProvider` provisions them on boot (idempotently) the moment a
registered model composes `Roles` or `Permissions`, so RBAC works with no extra
migration:

```text
roles                id · name · guard · label · timestamps   (ORM model)
permissions          id · name · guard · label · timestamps   (ORM model)
role_permissions     role_id · permission_id                  (auto-provisioned pivot)
model_roles          role_id · model_type · model_id          (auto-provisioned pivot)
model_permissions    permission_id · model_type · model_id    (auto-provisioned pivot)
```

The pivots are **polymorphic** (`model_type` + `model_id`), so any model — not
just `User` — can hold roles and permissions.

> **Note** — Pivot provisioning runs in the `web` and `test` environments and
> swallows DDL errors, so a DB-less runtime still boots. Generate real migrations
> for production if you'd rather control the schema explicitly.

## Eager loading is on by default

Each mixin registers a global scope (`rolesEagerLoad`, `permissionsEagerLoad`) so
every query **auto-eager-loads** its relations — roles (and each role's
permissions) and direct permissions. That means `can()` / `hasRole()` resolve from
memory with **no extra queries**, even across a whole collection (no N+1):

```typescript fragment
// in a controller
const users = await User.query().get(); // roles + permissions already loaded
for (const u of users) u.can("post.publish"); // synchronous, zero further queries
```

Turn it off per model with the static flags (`static withRoles = false`), or per
query with `User.query().withoutGlobalScope("rolesEagerLoad")` (and/or
`"permissionsEagerLoad"`). When the relations aren't loaded, call
`await user.loadAuthorization()` once to warm the memo (or eager-load explicitly
with `User.query().with("roles.permissions", "permissions")`) — the synchronous
checks then read from memory.

## Assigning roles & permissions

Names are auto-created the first time you use them. Writes are `await`-ed and
refresh the in-memory memo automatically:

```typescript fragment
// in a controller / seeder
import { Role } from "@zerotal/auth";

// Roles (Roles mixin)
await user.assignRole("editor", "viewer"); // one or many
await user.removeRole("viewer");
await user.syncRoles(["admin"]); // replace the whole set

// Permissions on a role
const editor = await Role.resolve("editor");
await editor.givePermissionTo("post.create", "post.update");
await editor.revokePermissionTo("post.update");
await editor.syncPermissions(["post.create", "post.publish"]);

// Direct permissions on a user (bypassing roles) (Permissions mixin)
await user.givePermissionTo("billing.refund");
```

## Checking

Checks are **synchronous** — they read from the eager-loaded relations (on by
default) or the per-instance memo:

```typescript fragment
// in a controller
user.hasRole("editor"); // boolean (Roles mixin)
user.hasAnyRole(["editor", "admin"]);
user.hasAllRoles(["editor", "author"]);

user.hasPermissionTo("post.create"); // direct OR via a role
user.can("post.update"); // alias of hasPermissionTo
user.getRoleNames(); // string[] (Roles mixin)
user.getAllPermissions(); // string[] — effective set (direct ∪ via-role)
```

> **Warning** — Checks throw if the model wasn't eager-loaded and `loadAuthorization()` hasn't run. Fetch via a query (eager loading is on by default) or call `await user.loadAuthorization()` first. Writes auto-refresh the data, so a check immediately after `await user.assignRole(...)` works.

### From the Auth facade

The same checks are available on the [`Auth`](/docs/authentication) facade for the
**current** request's user (and return `false`/`[]` for guests, so you never need
a null check):

```typescript
// in a controller
import { Auth } from "@zerotal/auth";

Auth.hasRole("editor");
Auth.hasAnyRole(["editor", "admin"]);
Auth.can("post.update");
Auth.hasPermission("post.publish"); // alias of can()
Auth.roles(); // string[]
```

These delegate to whatever the user model implements — so `hasRole`/`roles`
require the `Roles` mixin, while `can`/`hasPermission` work with either mixin.

### Wildcards

A permission can be a wildcard. `*` grants everything; `post.*` grants every
`post.…` ability:

```typescript
// in a seeder
import { Role } from "@zerotal/auth";

const admin = await Role.resolve("admin");
await admin.givePermissionTo("post.*"); // post.create, post.delete, …
const root = await Role.resolve("super-admin");
await root.givePermissionTo("*"); // everything
```

## Guarding routes

Two route-guard middleware enforce abilities and roles before the controller
runs. Both throw `UnauthorizedError` (401) when the request is unauthenticated
and `ForbiddenError` (403) when the user is authenticated but lacks access:

```typescript fragment
// routes/web.ts
import { RequirePermissionMiddleware, RequireRoleMiddleware } from "@zerotal/auth";

Router.post("/posts/:id/publish", PostController, "publish", [
  RequirePermissionMiddleware.for("post.publish"), // 401 if guest, 403 if denied
]);

Router.get("/admin", AdminController, "index", [
  RequireRoleMiddleware.for("admin"), // 403 unless the user hasRole('admin')
]);
```

`RequirePermissionMiddleware` reads `user.can()` (so the model needs `Roles`
or `Permissions`); `RequireRoleMiddleware` reads `user.hasRole()` (needs
`Roles`). Either denies with `ForbiddenError` if the model doesn't expose the
method. Both `.for(...)` factories accept several names with **OR** semantics.

> **Tip** — Check **permissions** in your code (`can('post.update')`), not roles. Roles are just bundles of permissions, and what a role grants should be free to change without editing code. Reserve `hasRole` for coarse, role-shaped decisions (e.g. "is this an admin area?").

## Gate & policies

Permissions flow through the existing [`Gate`](/docs/authentication) automatically —
any ability name not handled by a closure or a model policy falls back to the
user's `can()` (wildcard aware), so you don't have to register anything:

```typescript
// in a controller
import { Gate } from "@zerotal/auth";

Gate.allows("post.publish"); // true if the user has the permission
Gate.authorize("post.publish"); // throws ForbiddenError if not
```

In a model policy, defer to permissions:

```typescript fragment
// app/policies/PostPolicy.ts
import { Policy } from "@zerotal/auth";

class PostPolicy extends Policy<Post> {
  update(user: User, post: Post) {
    return user.id === post.authorId || user.can("post.update");
  }
}
Gate.registerPolicy(Post, PostPolicy);
Gate.allows("update", post);
```

> **Tip** — Policies are auto-discovered. Drop `PostPolicy extends Policy<Post>` in `app/policies/` and it's registered for `Post` automatically (the `Policy` suffix is matched to the model; override with `static model = Post`). No `Gate.registerPolicy(...)` call needed — that explicit form stays available for policies you'd rather wire by hand. See [Conventions](/docs/conventions).

Give a role unconditional access (super admin) with one line — it registers a
before-hook that short-circuits every Gate check, including policies:

```typescript fragment
// app/providers/AppProvider.ts (boot)
Gate.superAdmin(); // users with the 'super-admin' role bypass all checks
Gate.superAdmin("owner"); // or name your own bypass role
```

And on the `Auth` facade, `authorize` throws for the current user:

```typescript fragment
// in a controller
Auth.authorize("post.publish"); // ForbiddenError if the current user can't
```

## Declaring permissions in code

Declare the permission names your app uses (reviewable in source, present on every
deploy), then sync them to the database:

```typescript
// app/providers/AppProvider.ts (boot)
import { definePermission } from "@zerotal/auth";

definePermission("post.create", "post.update", "post.publish", "user.manage");
```

```bash
# in your project root
bun zt auth:sync-permissions        # idempotent — creates any missing permissions
```

`auth:sync-permissions` accepts a `--guard` flag (default `web`).
`Role.resolve` / `Permission.resolve` keep a process-level name→id cache, so bulk
assignment and seeding don't re-query for the same names.

## Seeding

```typescript
// database/seeders/RbacSeeder.ts
import { Seeder } from "@zerotal/orm";
import { Role, Permission } from "@zerotal/auth";

export class RbacSeeder extends Seeder {
  async run(): Promise<void> {
    await Permission.resolve("post.create");
    await Permission.resolve("post.publish");

    const editor = await Role.resolve("editor");
    await editor.givePermissionTo("post.create");

    const admin = await Role.resolve("admin");
    await admin.givePermissionTo("post.*");
  }
}
```

## Admin UI

When [`@zerotal/admin`](/docs/admin) is installed, **Roles** and **Permissions**
appear under an **Auth** group automatically, so you can manage them at runtime.
Many-to-many relations (a user's roles, a role's permissions) render as a
**multi-select** in the create/edit form — so you can assign roles to a user or
permissions to a role right in the admin. Relations you mark `readonly` (e.g.
roles gated to super admins) are read-only there too.

## Migrating from JSON roles

If you started with a simple `roles: string[]` column, move to relational by:

1. Provision the RBAC tables (`roles`/`permissions` via schema sync or a
   migration; the pivots are auto-created on boot).
2. Switch the model to `extends Roles(Permissions(AuthUser))` and **remove** the
   json `roles` column.
3. Backfill, reading the old values before you drop the column:

```typescript fragment
// database/seeders/BackfillRolesSeeder.ts
for (const u of await User.query().get()) {
  const legacy = (u as any).roles ?? (u as any).role;
  const names = Array.isArray(legacy) ? legacy : legacy ? [legacy] : [];
  if (names.length) await u.assignRole(...names);
}
```

## Troubleshooting

**"Authorization is not loaded on this instance."** A synchronous check ran on a
model that wasn't eager-loaded and whose memo wasn't warmed — e.g. a freshly
`new`-ed instance, or one fetched with `withRoles = false`. Fetch it via a query
(eager loading is on by default), or `await user.loadAuthorization()` first.
Writes refresh automatically, so a check right after `await user.assignRole(...)`
is fine.

**A permission check always returns `false`.** The permission row may not exist
yet. Names are auto-created by `assignRole`/`givePermissionTo`, but if you check
before granting, declare it with `definePermission(...)` and run
`auth:sync-permissions`. Also confirm the **guard** matches (default `web`).

**`can()` ignores a role's new permission.** Effective permissions are memoised
per instance. After changing a _role's_ permissions, re-fetch the user (or call
`await user.loadAuthorization()`) so the memo rebuilds — assigning/revoking on the
user itself refreshes automatically.

**`hasRole`/`assignRole` is undefined.** That model wasn't composed with
`Roles` (likewise `givePermissionTo` needs `Permissions`). Add the mixin:
`class User extends Roles(Permissions(AuthUser))`.

**Don't add a json `roles` column.** A `Roles` model already has a `roles`
relation; a same-named json column would collide.

## Testing

Set your suite up once as described in [Testing](/docs/testing) — everything
below assumes `createApp()` from your `tests/helpers.ts`.

**A policy is a plain class**, so the cheapest and most valuable test needs no
application at all:

```typescript fragment
// tests/policies/PostPolicy.test.ts
import { test, expect } from "bun:test";
import { PostPolicy } from "../../app/policies/PostPolicy.ts";

test("only the author may update a post", () => {
  const policy = new PostPolicy();
  const post = { id: 1, userId: 7 };

  expect(policy.update({ id: 7 }, post)).toBe(true);
  expect(policy.update({ id: 8 }, post)).toBe(false);
});
```

**Roles and permissions are database rows**, so grant them in the test and check
them the way a controller would:

```typescript fragment
// tests/authorization/roles.test.ts
import { test, expect } from "bun:test";
import { createApp } from "../helpers.ts";
import { User } from "../../app/models/User.ts";

test("an editor inherits the role's permissions", async () => {
  const app = await createApp();
  const user = await User.create({ email: "editor@example.com" });
  await user.assignRole("editor"); // the editor role grants posts.publish

  expect(await user.can("posts.publish")).toBe(true);
  expect(await user.can("users.delete")).toBe(false);

  await app.close();
});
```

**A guarded route is checked through `actingAs()`** — `assertForbidden()` is the
assertion that proves the gate is wired, not just defined:

```typescript fragment
// tests/http/posts.test.ts
const res = await app.actingAs(stranger).delete("/posts/1");

res.assertForbidden();
```

> **Warning** — Assert with the async forms (`allowsAsync`, `authorizeAsync`,
> `can`) whenever an ability touches the database. The synchronous forms treat a
> returned Promise as truthy, so a test written against them **passes even when
> the ability should deny** — the one failure mode in authorization that a green
> suite will hide from you.

## References

Synchronous reads (`hasRole`, `can`, …) require the relations to be loaded; the
async writes refresh the memo for you.

### On a model — `Roles` mixin

| Method         | Signature                                                 | Description                                    |
| -------------- | --------------------------------------------------------- | ---------------------------------------------- |
| `assignRole`   | `(...roles: (string \| number \| Role)[]): Promise<this>` | Assign one or more roles (created if missing). |
| `removeRole`   | `(...roles: (string \| number \| Role)[]): Promise<this>` | Remove one or more roles.                      |
| `syncRoles`    | `(roles: (string \| number \| Role)[]): Promise<this>`    | Replace the whole role set.                    |
| `hasRole`      | `(role: string): boolean`                                 | True if the model holds the role.              |
| `hasAnyRole`   | `(roles: string[]): boolean`                              | True if it holds at least one of the roles.    |
| `hasAllRoles`  | `(roles: string[]): boolean`                              | True if it holds every one of the roles.       |
| `getRoleNames` | `(): string[]`                                            | The model's role names.                        |
| `loadRoles`    | `(): Promise<this>`                                       | Warm the role slice of the memo from the DB.   |

### On a model — `Permissions` mixin

| Method               | Signature                                                       | Description                                    |
| -------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| `givePermissionTo`   | `(...perms: (string \| number \| Permission)[]): Promise<this>` | Grant direct permissions (created if missing). |
| `revokePermissionTo` | `(...perms: (string \| number \| Permission)[]): Promise<this>` | Revoke direct permissions.                     |
| `syncPermissions`    | `(perms: (string \| number \| Permission)[]): Promise<this>`    | Replace the direct-permission set.             |
| `loadPermissions`    | `(): Promise<this>`                                             | Warm the direct-permission memo from the DB.   |

### On a model — effective checks (either mixin)

| Method              | Signature                    | Description                                              |
| ------------------- | ---------------------------- | -------------------------------------------------------- |
| `can`               | `(ability: string): boolean` | Alias of `hasPermissionTo` — the canonical check.        |
| `hasPermissionTo`   | `(ability: string): boolean` | True if granted directly or via a role (wildcard-aware). |
| `getAllPermissions` | `(): string[]`               | Effective permission set (direct ∪ via-role).            |
| `loadAuthorization` | `(): Promise<this>`          | Warm every slice the model composed in.                  |

### `Auth` facade (current user)

| Method               | Signature                    | Description                                     |
| -------------------- | ---------------------------- | ----------------------------------------------- |
| `Auth.hasRole`       | `(role: string): boolean`    | Current user has the role (`false` for guests). |
| `Auth.hasAnyRole`    | `(roles: string[]): boolean` | Current user has any of the roles.              |
| `Auth.hasAllRoles`   | `(roles: string[]): boolean` | Current user has all of the roles.              |
| `Auth.can`           | `(ability: string): boolean` | Current user has the ability.                   |
| `Auth.hasPermission` | `(ability: string): boolean` | Alias of `Auth.can`.                            |
| `Auth.authorize`     | `(ability: string): void`    | Throws `ForbiddenError` unless allowed.         |
| `Auth.roles`         | `(): string[]`               | Current user's role names (`[]` for guests).    |

### `Role` (model)

| Method               | Signature                                                       | Description                                     |
| -------------------- | --------------------------------------------------------------- | ----------------------------------------------- |
| `Role.resolve`       | `(name: string, guard?: string): Promise<Role>`                 | Find-or-create a role by name (+ guard).        |
| `givePermissionTo`   | `(...perms: (string \| number \| Permission)[]): Promise<this>` | Grant permissions to the role.                  |
| `revokePermissionTo` | `(...perms: (string \| number \| Permission)[]): Promise<this>` | Revoke permissions from the role.               |
| `syncPermissions`    | `(perms: (string \| number \| Permission)[]): Promise<this>`    | Replace the role's permissions.                 |
| `permissionNames`    | `(): Promise<string[]>`                                         | Names of the permissions on the role.           |
| `hasPermission`      | `(name: string): Promise<boolean>`                              | Exact-match check for a permission on the role. |

### `Permission` (model)

| Method               | Signature                                             | Description                          |
| -------------------- | ----------------------------------------------------- | ------------------------------------ |
| `Permission.resolve` | `(name: string, guard?: string): Promise<Permission>` | Find-or-create a permission by name. |
| `definePermission`   | `(...names: (string \| string[])[]): void`            | Declare permission names in code.    |

### `Gate` facade

| Method                | Signature                                    | Description                                           |
| --------------------- | -------------------------------------------- | ----------------------------------------------------- |
| `Gate.allows`         | `(ability: string, model?: object): boolean` | True if the current user may perform the ability.     |
| `Gate.authorize`      | `(ability: string, model?: object): void`    | Throws `ForbiddenError` if denied.                    |
| `Gate.registerPolicy` | `(ModelClass, PolicyClass): void`            | Register a policy for a model.                        |
| `Gate.superAdmin`     | `(role?: string): this`                      | Bypass all checks for a role (default `super-admin`). |
| `Gate.defineAbility`  | `(ability: string, cb): this`                | Define a closure-based ability.                       |
| `Gate.before`         | `(hook): this`                               | Add a before-hook that can short-circuit checks.      |
| `Gate.via`            | `(PolicyClass): { allows, authorize }`       | Check against an explicit policy class.               |

## Next steps

- [Authentication](/docs/authentication) — sign users in before authorizing them.
- [Roles and 2FA](/docs/roles-and-2fa) — deeper coverage of role workflows.
- [Middleware](/docs/middleware) — how the route-guard middleware fits the pipeline.
- [Conventions](/docs/conventions) — auto-discovery rules for policies.
