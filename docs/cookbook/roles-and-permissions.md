---
title: Roles and Permissions
description: Give the starter's users roles, seed an admin role that may manage every project, and prove with feature tests that an admin is let in and everyone else is refused.
---

# Roles and Permissions

The starter keeps every project private to its owner. This recipe adds the other common
rule: some people may manage everything. At the end, `User` carries roles and
permissions, an `admin` role grants `projects.manage`, an admin sees and can change
every project while everyone else still sees only their own, a console command makes
someone an admin, and feature tests prove both sides of the rule.

## Before you start

You need an app made from the React starter, `create-zerotal`, with its example resource,
`Project`: the model, `app/policies/ProjectPolicy.ts`, the routes under
`app/routes/(auth)/(verified)/projects/`, and the tests that use `bootApp()` from
`tests/support.ts`.

Roles and permissions are part of `zerotal/auth`. The `zerotal` package bundles it, and
the starter already registers its provider, so there is nothing to install.

The starter's `users` table has a `role` column, set to `"user"` when an account is made
and read by nothing. This recipe leaves it alone: roles here live in tables of their own,
so a user can hold several, and each role carries its permissions.

## Give users roles

Compose the `Roles` and `Permissions` mixins onto `User`, after the ones it already has:

```ts fragment
// app/models/User.ts
import { Authenticatable, EmailVerification, Permissions, Roles } from "zerotal/auth";

// …

@table("users")
export class User extends Model.using(
  Authenticatable,
  EmailVerification,
  Notifiable,
  Permissions,
  Roles,
) {
```

`Roles` lets a user hold roles, and each role carries permissions. `Permissions` lets you
grant a permission to one user directly, without a role. With both, `user.can()` answers
over the two together, so code asks about a permission and never needs to know how it
was granted.

## Create the tables

Roles, permissions and the three tables that link them to users and to each other need a
migration:

```bash
# in your project root
bun zt make:migration create_roles_and_permissions_tables
```

Replace the contents of the file it creates with:

```ts
// database/migrations/0007_create_roles_and_permissions_tables.ts
import { Migration, Schema } from "zerotal/orm";

export default class CreateRolesAndPermissionsTables extends Migration {
  override async up(): Promise<void> {
    // One row per role name and one per permission name.
    await Schema.create("roles", (table) => {
      table.increments("id");
      table.string("name");
      table.string("guard");
      table.string("label").nullable();
      table.timestamps();
      table.unique(["name", "guard"]);
    });
    await Schema.create("permissions", (table) => {
      table.increments("id");
      table.string("name");
      table.string("guard");
      table.string("label").nullable();
      table.timestamps();
      table.unique(["name", "guard"]);
    });

    // Who holds what. The app also creates these three when it boots as a server or a
    // test run, so they can exist already. A console command such as db:seed needs them
    // from here.
    await Schema.createIfNotExists("role_permissions", (table) => {
      table.integer("role_id").index();
      table.integer("permission_id");
    });
    await Schema.createIfNotExists("model_roles", (table) => {
      table.integer("role_id");
      table.integer("model_id");
      table.string("model_type");
      table.index(["model_type", "model_id"]);
    });
    await Schema.createIfNotExists("model_permissions", (table) => {
      table.integer("permission_id");
      table.integer("model_id");
      table.string("model_type");
      table.index(["model_type", "model_id"]);
    });
  }

  override async down(): Promise<void> {
    const tables = ["model_permissions", "model_roles", "role_permissions", "permissions", "roles"];
    for (const name of tables) {
      await Schema.dropIfExists(name);
    }
  }
}
```

The three link tables use `createIfNotExists` because `AuthProvider` creates them itself
when the app starts as a server or a test run. A console command does not start it that
way, and the seeder below runs as one, so the migration makes sure they are there.

```bash
# in your project root
bun zt migrate
```

```
…
Migrated 1 migration(s).
  0007_create_roles_and_permissions_tables    ran
```

## Seed the admin role

Roles are data, so a seeder creates them. This one makes no accounts, so it is safe to
run in production as well as on your machine:

```ts
// database/seeders/RolesSeeder.ts
import { Seeder } from "zerotal/orm";
import { Permission, Role } from "zerotal/auth";

/**
 * The roles the app knows and what each may do. It creates only what is missing, so it
 * is safe to run again, and in production: it makes no accounts.
 */
export class RolesSeeder extends Seeder {
  async run(): Promise<void> {
    const manageProjects = await Permission.resolve("projects.manage");

    const admin = await Role.resolve("admin");
    await admin.givePermissionTo(manageProjects);
  }
}
```

`resolve()` finds a role or permission by name and creates it if it is missing, and
`givePermissionTo()` skips a permission the role already has, so running it twice changes
nothing.

Call it from the starter's `DatabaseSeeder`, first, before the line that returns early
when the demo account already exists. A database you seeded before this recipe still
gets its roles:

```ts fragment
// database/seeders/DatabaseSeeder.ts
import { RolesSeeder } from "./RolesSeeder";

// …

  async run(): Promise<void> {
    // First, and before the early return: the roles belong in every database, seeded or not.
    await this.call([RolesSeeder]);

    if (await User.query().where("email", DEMO_EMAIL).first()) return;
```

```bash
# in your project root
bun zt db:seed
```

```
…
Database Seeding
Database seeded successfully.
```

## Make someone an admin

No form in the app assigns roles, and none should: a role is not something an account
grants itself. A console command is how the first admin is made:

```bash
# in your project root
bun zt make:command AssignRole
```

Replace the contents of `app/commands/AssignRole.ts` with:

```ts fragment
// app/commands/AssignRole.ts
import { Command } from "zerotal";
import type { ArgDef } from "zerotal";
import { Role } from "zerotal/auth";
import { User } from "@app/models/User";

/**
 * Give an existing account a role:
 *
 *   bun zt roles:assign demo@example.com admin
 *
 * No form assigns roles, so this is how the first admin is made.
 */
export class AssignRole extends Command {
  static commandName = "roles:assign";
  static description = "Give the account with this email address a role";
  static needsApp = true;

  static args: ArgDef[] = [
    { name: "email", required: true },
    { name: "role", required: true },
  ];

  async run(): Promise<void> {
    const email = this.args["email"] ?? "";
    const name = this.args["role"] ?? "";

    const user = await User.query().where("email", email).first();
    if (!user) {
      this.error(`No account has the email address ${email}.`);
      process.exitCode = 1;
      return;
    }

    // Only a role RolesSeeder created: assignRole() would make a new, empty role out of
    // a typo and report success.
    const role = await Role.query().where("name", name).first();
    if (!role) {
      this.error(`There is no "${name}" role. Run bun zt db:seed to create the app's roles.`);
      process.exitCode = 1;
      return;
    }

    await user.assignRole(role);
    this.info(`${email} now has the roles: ${user.getRoleNames().join(", ")}.`);
  }
}
```

The command looks the role up rather than passing its name to `assignRole()`. Given a
name, `assignRole()` creates the role when it does not exist, so a mistyped `admn` would
become a new role with no permissions and the command would report success.

```bash
# in your project root
bun zt roles:assign demo@example.com admin
```

```
…
demo@example.com now has the roles: admin.
```

## Load the user's roles on each request

`can()`, `hasRole()` and the policies that call them are synchronous. They read roles and
permissions that are already in memory, and throw when nothing was loaded. A user fetched
by a query usually arrives with them, but not in every case: in the test suite, whose
files import `User` before they boot the app, the signed-in user arrives without them.
Load them once per request, before any route runs, and no check depends on how the user
was fetched.

```bash
# in your project root
bun zt make:middleware LoadAuthorization
```

Replace the contents of `app/middleware/LoadAuthorization.ts` with:

```ts fragment
// app/middleware/LoadAuthorization.ts
import type { HttpContext, NextFn, Pipe } from "zerotal";
import { Auth } from "zerotal/auth";

/**
 * Loads the signed-in user's roles and permissions once, before the route runs.
 *
 * `can()`, `hasRole()` and every policy that calls them are synchronous: they read what
 * is already in memory and throw when nothing was loaded. Loading here means no check
 * further down depends on how the user happened to be fetched.
 */
export class LoadAuthorization implements Pipe<HttpContext> {
  async handle(_http: HttpContext, next: NextFn): Promise<Response | void> {
    await Auth.userOrNull()?.loadAuthorization();
    return next();
  }
}
```

Then add it to the middleware every signed-in route runs, after the ones already there:

```ts fragment
// app/routes/(auth)/_middleware.ts
import { AuthMiddleware, AuthenticateSessionMiddleware } from "zerotal/auth";
import { LoadAuthorization } from "@app/middleware/LoadAuthorization";
import { TrackSession } from "@app/middleware/TrackSession";

/**
 * Every route in (auth)/ needs a signed-in user. A guest is sent to /login, and back to
 * the page they asked for once they have signed in.
 *
 * - `AuthenticateSessionMiddleware` ends this session when the password changes
 *   somewhere else — a reset, or a change made on another device.
 * - `TrackSession` keeps Settings → Sessions' list of signed-in browsers current, and
 *   signs this one out if it was removed from that list.
 * - `LoadAuthorization` loads the user's roles and permissions for `can()` and policies.
 */
export const middleware = [
  AuthMiddleware,
  AuthenticateSessionMiddleware,
  TrackSession,
  LoadAuthorization,
];
```

## Let admins manage every project

The policy decides who may open, change or delete one project. Let anyone granted
`projects.manage` through, as well as the owner:

```ts fragment
// app/policies/ProjectPolicy.ts
import { Policy } from "zerotal/auth";
import type { Project } from "../models/Project.ts";
import type { User } from "../models/User.ts";

/**
 * Who may do what with a project: anyone signed in may create one, and its owner, or
 * anyone granted `projects.manage`, may see, change or delete it.
 *
 * Found by name — `ProjectPolicy` for `Project` — so `Gate.authorize("update", project)`
 * reaches it without being registered. A denial is a 403, rendered by the error page.
 */
export class ProjectPolicy extends Policy<Project> {
  view(user: User, project: Project): boolean {
    return project.userId === user.id || user.can("projects.manage");
  }

  create(_user: User): boolean {
    return true;
  }

  update(user: User, project: Project): boolean {
    return project.userId === user.id || user.can("projects.manage");
  }

  delete(user: User, project: Project): boolean {
    return project.userId === user.id || user.can("projects.manage");
  }
}
```

The edit page and the `PUT` and `DELETE` handlers already call
`Gate.authorize("update", project)` or `Gate.authorize("delete", project)`, so they need no
change. The policy checks a permission, not the `admin` role: which roles carry
`projects.manage` can then change in the seeder without touching code.

The list is not a policy decision, because it is a query. Widen it for the same
permission:

```ts fragment
// app/routes/(auth)/(verified)/projects/index.ts
// GET /projects?search=…&page=… — the signed-in user's projects, newest first. Someone
// granted `projects.manage` sees everyone's.
export const GET = async (http: HttpContext) => {
  const url = new URL(http.request.url);
  const search = (url.searchParams.get("search") ?? "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  let query = Auth.can("projects.manage")
    ? Project.query()
    : Project.query().where("user_id", Auth.user().id);
```

`Auth.can()` asks the same question about the signed-in user, and answers `false` for a
guest.

## The tests

One file covers both sides of the rule: an admin is let in everywhere, and an ordinary
user is refused everywhere.

```ts fragment
// tests/roles.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { refreshDatabase, type TestApp } from "zerotal/testing";
import { inertiaProps } from "@zerotal/inertia/testing";
import { Project } from "../app/models/Project";
import { ProjectFactory } from "../database/factories/ProjectFactory";
import { UserFactory } from "../database/factories/UserFactory";
import { RolesSeeder } from "../database/seeders/RolesSeeder";
import { bootApp } from "./support";

/** Roles and permissions: an admin may manage every project, and nobody else may. */
let app: TestApp;

beforeAll(async () => {
  app = await bootApp();
});
afterAll(() => app.close());
beforeEach(() => app.actingAsGuest());

const valid = { name: "Renamed", description: "", status: "active" };

async function createAdmin() {
  const admin = await UserFactory.create();
  await admin.assignRole("admin");
  return admin;
}

describe("roles", () => {
  refreshDatabase();
  // Roles are rows like any other, and every test starts from empty tables.
  beforeEach(() => new RolesSeeder().run());

  test("the admin role grants projects.manage", async () => {
    const admin = await createAdmin();
    const user = await UserFactory.create();
    await user.loadAuthorization();

    expect(admin.hasRole("admin")).toBe(true);
    expect(admin.can("projects.manage")).toBe(true);
    expect(user.can("projects.manage")).toBe(false);
  });

  test("an admin sees every project", async () => {
    const owner = await UserFactory.create();
    await ProjectFactory.for(owner).create({ name: "Not the admin's" });
    const admin = await createAdmin();

    const res = (await app.actingAs(admin).get("/projects")).assertOk();
    const { projects } = inertiaProps(res, "projects/index");

    expect(projects.map((p) => p.name)).toContain("Not the admin's");
  });

  test("an admin may change and delete anyone's project", async () => {
    const owner = await UserFactory.create();
    const project = await ProjectFactory.for(owner).create();
    const admin = await createAdmin();

    (await app.actingAs(admin).get(`/projects/${project.id}/edit`)).assertOk();
    (await app.actingAs(admin).putForm(`/projects/${project.id}`, valid)).assertRedirect(
      "/projects",
    );
    expect((await Project.find(project.id))?.name).toBe("Renamed");

    (await app.actingAs(admin).delete(`/projects/${project.id}`)).assertRedirect("/projects");
    expect(await Project.find(project.id)).toBeNull();
  });

  test("an ordinary user is refused", async () => {
    const owner = await UserFactory.create();
    const project = await ProjectFactory.for(owner).create({ name: "Private" });
    const user = await UserFactory.create();

    const res = (await app.actingAs(user).get("/projects")).assertOk();
    expect(inertiaProps(res, "projects/index").projects).toHaveLength(0);

    (await app.actingAs(user).get(`/projects/${project.id}/edit`)).assertForbidden();
    (await app.actingAs(user).putForm(`/projects/${project.id}`, valid)).assertForbidden();
    (await app.actingAs(user).delete(`/projects/${project.id}`)).assertForbidden();
    expect((await Project.find(project.id))?.name).toBe("Private");
  });
});
```

What each part relies on:

- **`refreshDatabase()`** rolls every test back, roles included, so `RolesSeeder` runs
  before each one. It is the same seeder the app uses, so the tests check the roles you
  ship rather than a copy.
- **`RolesSeeder` passes the permission it resolved**, not its name. `Role` and
  `Permission` remember which id each name had for the life of the process, and in a
  test run the row behind a remembered id may have been rolled back.
- **`assignRole()`** reloads the user's roles, so `createAdmin()` returns a user whose
  checks work straight away. A user made by the factory and given nothing has none
  loaded, which is why the first test calls `loadAuthorization()` before asking it.
- **`app.actingAs(user)`** signs the request in as that user, who is loaded fresh from the
  database, as on a real request.

The starter's `tests/project-policy.test.ts` calls the policy with users made by
`new User()`, which have no database behind them, so `can()` has nothing to read. Give
its `user()` helper a list of permissions to answer from, and add a test for the new rule:

```ts fragment
// tests/project-policy.test.ts
import { describe, expect, test } from "bun:test";
import { ProjectPolicy } from "../app/policies/ProjectPolicy";
import { Project } from "../app/models/Project";
import { User } from "../app/models/User";

/**
 * The policy on its own, without HTTP: who may do what with a project. Delete this file
 * with the rest of the example (see "Remove the example" in the README).
 */
function user(id: number, permissions: string[] = []): User {
  const u = new User();
  u.id = id;
  // There is no database here to load roles from, so can() answers from the list.
  u.can = (ability) => permissions.includes(ability);
  return u;
}

function projectOwnedBy(id: number): Project {
  const p = new Project();
  p.userId = id;
  return p;
}

describe("project policy", () => {
  const policy = new ProjectPolicy();

  test("lets the owner view, update and delete", () => {
    const owner = user(1);
    const project = projectOwnedBy(1);

    expect(policy.view(owner, project)).toBe(true);
    expect(policy.update(owner, project)).toBe(true);
    expect(policy.delete(owner, project)).toBe(true);
  });

  test("refuses everyone else", () => {
    const stranger = user(2);
    const project = projectOwnedBy(1);

    expect(policy.view(stranger, project)).toBe(false);
    expect(policy.update(stranger, project)).toBe(false);
    expect(policy.delete(stranger, project)).toBe(false);
  });

  test("lets someone granted projects.manage view, update and delete", () => {
    const admin = user(2, ["projects.manage"]);
    const project = projectOwnedBy(1);

    expect(policy.view(admin, project)).toBe(true);
    expect(policy.update(admin, project)).toBe(true);
    expect(policy.delete(admin, project)).toBe(true);
  });

  test("lets any signed-in user create one", () => {
    expect(policy.create(user(3))).toBe(true);
  });
});
```

Make sure the tests can fail. Take `|| user.can("projects.manage")` off `update` in the
policy and run the file:

```
…
error: Expected HTTP 200 but got 403.
(fail) roles > an admin may change and delete anyone's project
…
```

The admin was refused the edit page. Put it back.

## Run it

```bash
# in your project root
bun zt test tests/roles.test.ts tests/project-policy.test.ts
```

Both files pass, and so does the whole suite:

```bash
# in your project root
bun zt test
```

Then in the browser: run `bun zt dev`, sign in as `demo@example.com`, which you made an
admin above, and Projects lists every account's projects. Signed in as any other account,
it lists only that account's own.

## See also

- [Authorization](/docs/authorization) — the `Roles` and `Permissions` mixins, wildcards,
  `Gate`, and every method used here.
- [Guarding routes](/docs/authorization#guarding-routes) — `RequirePermissionMiddleware`
  and `RequireRoleMiddleware`, for a whole area that only some users may enter.
- [Seeding](/docs/seeding) — seeders and `db:seed`.
- [Commands](/docs/commands) — writing console commands like `roles:assign`.
- [Middleware](/docs/middleware) — writing middleware and attaching it to a route group.
- [A policy](/docs/tutorial/policy) — the tutorial's walk through the starter's policy.
