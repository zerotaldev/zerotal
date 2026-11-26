---
title: Add Teams
description: Milestone 8 of the tutorial — make the app multi-tenant with @zerotal/tenancy, so every account works in a team and no team can see another's projects or tasks.
---

# Add Teams

Milestone 8 of 9 in [Build Your First App](/docs/tutorial).

So far each project belongs to one person. In a product people share, the unit is a
**team**: everything a team creates is the team's, and nobody outside it can see it.
Filtering every query by hand is how that goes wrong — one forgotten `where` and a
customer sees another's data. `@zerotal/tenancy` does it for you: it works out the
team for each request, adds the team to every query on a team-owned model, and fills
it in on every new row. [Multi-Tenancy](/docs/tenancy) is the reference; this page
applies it.

In this app the team is the **tenant**, every account gets one when it signs up, and a
request belongs to the signed-in user's team.

## Install and configure

```bash
# in your project root
bun add @zerotal/tenancy@~1.18.0
```

The team is read off the signed-in user, from a `tenantId` attribute this milestone
adds to `User`:

```ts
// config/tenancy.ts
import { AuthResolver, TenancyConfig } from "@zerotal/tenancy";

export default TenancyConfig({
  // A request belongs to the signed-in user's team: users.tenant_id.
  resolvers: [new AuthResolver()],
});
```

Register the provider after `AuthProvider`, which is what puts the user on the request.
The provider installs the middleware that resolves the team; do not add it yourself:

```ts fragment
// bootstrap/providers.ts
import { TenancyProvider } from "@zerotal/tenancy";
import tenancyConfig from "../config/tenancy";

const providers = [
  // …
  AuthProvider,
  TenancyProvider.withConfig(tenancyConfig),
  QueueProvider,
  // …
];
```

The package owns the `tenants` and `tenant_members` tables and creates them when the
app boots. You do not write a migration for those.

## The columns

`users` gets the team its user works in; `projects` and `tasks` get the team that owns
them:

```bash
# in your project root
bun zt make:migration add_tenant_id_columns
```

```ts
// database/migrations/0008_add_tenant_id_columns.ts
import { Migration, Schema } from "zerotal/orm";

const TABLES = ["users", "projects", "tasks"];

export default class AddTenantIdColumns extends Migration {
  override async up(): Promise<void> {
    for (const name of TABLES) {
      // On users it is the team they are working in; on the others, the team that owns the row.
      await Schema.table(name, (table) => {
        table.integer("tenant_id").nullable().index();
      });
    }
  }

  override async down(): Promise<void> {
    for (const name of TABLES) {
      // SQLite will not drop an indexed column, so the index goes first, in its own step.
      await Schema.table(name, (table) => {
        table.dropIndex(["tenant_id"]);
      });
      await Schema.table(name, (table) => {
        table.dropColumn("tenant_id");
      });
    }
  }
}
```

## The models

On `User`, next to `role`:

```ts fragment
// app/models/User.ts
/** The team this user works in. Set in code (app/support/teams.ts), never from a form. */
@column({ type: "number", nullable: true }) tenantId?: number | null | undefined;
```

`Project` and `Task` become team-owned by composing `Tenantable`. The change is the same
in both files:

```ts
// app/models/Task.ts (and the same in app/models/Project.ts)
import { Model, column, table } from "zerotal/orm";
import { Tenantable } from "@zerotal/tenancy";

@table("tasks")
export class Task extends Model.using(Tenantable) {
  static override fillable = ["title", "done"] as const;

  // The team that owns the row. Tenantable fills it on create and scopes every query by it.
  static override tenantColumn = "tenantId";
  @column({ type: "number" }) tenantId!: number;

  // …the rest of the model as before
}
```

`tenantColumn` names the model's attribute, `tenantId`, not the database column. With
`@column` declarations a model saves only the attributes it declares, and the value
`Tenantable` sets on create has to be one of them. Left at its default, `tenant_id`,
every new row would be saved with no team.

From here on, every query on `Project` or `Task` inside a request is limited to the
user's team, and every new one is stamped with it. Outside a team — a query with no
signed-in user, a console command — they match nothing at all, rather than everything.

## Give every account a team

One helper, used wherever an account is created:

```ts fragment
// app/support/teams.ts
import { Tenant, TenantModel } from "@zerotal/tenancy";
import type { User } from "@app/models/User";

/** Give a new user a team of their own, with them as its admin, and work in it. */
export async function createTeamFor(user: User): Promise<TenantModel> {
  // forceCreate: every value here is built in code, none comes from a form.
  const team = await TenantModel.forceCreate({
    slug: `team-${user.id}`,
    name: `${user.name}’s team`,
    isActive: true,
  });
  await Tenant.run(team, () => Tenant.addMember(user.id, { admin: true }));

  user.tenantId = team.id;
  await user.save();
  return team;
}
```

`TenantModel.forceCreate()` rather than `Tenant.create()`: `Tenant.create()` enrolls the
signed-in user as the team's admin, and at registration nobody is signed in yet, so this
adds the new user explicitly. `forceCreate()` is the right call for values built in code.

Call it after the user is saved in the three places that create one: the registration
route, the social sign-in helper and the seeder.

```ts fragment
// app/routes/(guest)/register.ts and app/auth/social.ts
import { createTeamFor } from "@app/support/teams";

// …right after `await user.save();`
await createTeamFor(user);
```

The seeder creates the demo projects outside any request, so it runs that part inside
the demo team:

```ts fragment
// database/seeders/DatabaseSeeder.ts
import { Tenant } from "@zerotal/tenancy";
import { createTeamFor } from "@app/support/teams";

// …after `await demo.save();`
await createTeamFor(demo);

// …and around the loop that creates the projects:
// Inside the demo team, so each project is stamped with its tenant_id.
await Tenant.forId(demo.tenantId!, async () => {
  for (const [name, description, status] of projects) {
    // …unchanged
  }
});
```

## Assign only teammates

The assignee rule from milestone 4 accepts anyone with an account. Now it should be
someone in the team. Add the check to the add-a-task route, after the assignee is
looked up:

```ts fragment
// app/routes/(auth)/(verified)/projects/[project]/tasks.ts
import { rejectInput } from "@app/support/validation";
import { Tenant } from "@zerotal/tenancy";

// …in POST, after the `const assignee = …` line:
// Only someone in this team can be given its work.
if (assignee && !(await Tenant.isMember(assignee.id))) {
  rejectInput(
    http,
    { assignee: "Assign the task to someone in your team." },
    `/projects/${project.id}`,
  );
}
```

`rejectInput()` is the starter's helper for a check `validate()` cannot make: it fails
the form the same way.

## Rebuild your development data

The demo projects in your database were created before teams existed, so they belong to
none, and the demo user has no team: signed in, you would now see an empty list. Start
the development database again. Stop `bun zt dev` first, then:

```bash
# in your project root
rm database/db.sqlite*
bun zt migrate
bun zt dev
```

and, once `dev` is up, from another terminal:

```bash
# in your project root
bun zt db:seed
```

The order matters. The `tenants` table is created when the app boots as a server, a
worker or a test run, not by a console command, so `db:seed` needs `dev` to have
started once. `migrate:fresh` is not a substitute here: it leaves the package's tables
as they are, and the old teams would stay behind.

## Update the tests

Three things change for tests.

**Every test user needs a team**, as every real one now has. Give the starter's
`UserFactory` an `afterCreate`:

```ts fragment
// database/factories/UserFactory.ts
import { createTeamFor } from "../../app/support/teams.ts";

export const UserFactory = Factory.define(User, (fake) => ({
  // …unchanged
})).afterCreate(async (user) => {
  // Every account has a team, as registration gives it one.
  await createTeamFor(user);
});
```

**Factories skip model hooks** unless told otherwise, and `Tenantable`'s hook is what
stamps the team. Add `.dispatchEvents()` to `ProjectFactory` and `TaskFactory`:

```ts fragment
// database/factories/TaskFactory.ts (and the same in ProjectFactory.ts)
export const TaskFactory = Factory.define(Task, (fake) => ({
  title: fake.sentence(),
  done: false,
}))
  // Factories skip model hooks unless told otherwise, and Tenantable's hook is what
  // stamps the team on a new row. Create these inside a team: inTeam() in tests/support.ts.
  .dispatchEvents();
```

**Test data is created and read inside a team.** A test is not a request, so there is no
team until you open one. Two helpers in `tests/support.ts`:

```ts fragment
// tests/support.ts
import { Tenant } from "@zerotal/tenancy";
import type { User } from "../app/models/User.ts";

/**
 * Run `fn` inside the user's team, where every request they make runs. Projects and
 * tasks are scoped to a team: created outside one they belong to no team, and read
 * outside one they are not found.
 */
export function inTeam<T>(user: User, fn: () => Promise<T>): Promise<T> {
  return Tenant.forId(user.tenantId!, fn);
}

/** Move `user` into `owner`'s team, as a member who does not own its projects. */
export async function joinTeam(user: User, owner: User): Promise<void> {
  await inTeam(owner, () => Tenant.addMember(user.id));
  user.tenantId = owner.tenantId;
  await user.save();
}
```

Then wrap each factory call and each `find()` on a project or task in
`tests/projects.test.ts`, `tests/tasks.test.ts` and `tests/task-policy.test.ts`:

```ts fragment
// before
const project = await ProjectFactory.for(user).create();
expect((await Project.find(project.id))?.name).toBe("Renamed");

// after
const project = await inTeam(user, () => ProjectFactory.for(user).create());
expect((await inTeam(user, () => Project.find(project.id)))?.name).toBe("Renamed");
```

In `task-policy.test.ts` the policy calls go inside the team too, since the policy
loads the project.

The refusal tests change meaning. A user from another team now gets a 404 — to them
the project does not exist — so a 403 test needs a teammate who is not the owner. In
both `projects.test.ts` and `tasks.test.ts`, put the stranger in the owner's team:

```ts fragment
const owner = await UserFactory.create();
const stranger = await UserFactory.create();
// In the same team, so the project is visible to them and only the policy stands in the way.
await joinTeam(stranger, owner);
```

The notification test's assignee needs `joinTeam(assignee, owner)` as well, and a new
test covers the rule above:

```ts fragment
// tests/tasks.test.ts
test("assigns only to someone in the team", async () => {
  const owner = await UserFactory.create();
  const outsider = await UserFactory.create();
  const project = await inTeam(owner, () => ProjectFactory.for(owner).create());

  const res = await app
    .actingAs(owner)
    .postForm(`/projects/${project.id}/tasks`, { title: "Review", assignee: outsider.email });

  res.assertInvalid(["assignee"]);
  notifications.assertNothingSent();
});
```

## The isolation test

This is the test the whole milestone exists for. Write it as a negative, and assert a
count:

```ts fragment
// tests/teams.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { refreshDatabase, type TestApp } from "zerotal/testing";
import { Project } from "../app/models/Project";
import { Task } from "../app/models/Task";
import { ProjectFactory } from "../database/factories/ProjectFactory";
import { TaskFactory } from "../database/factories/TaskFactory";
import { UserFactory } from "../database/factories/UserFactory";
import { bootApp, inTeam } from "./support";

/** The test the whole of tenancy exists for: one team never sees another's rows. */
let app: TestApp;

beforeAll(async () => {
  app = await bootApp();
});
afterAll(() => app.close());
beforeEach(() => app.actingAsGuest());

describe("teams", () => {
  refreshDatabase();

  test("a team cannot see another team's projects or tasks", async () => {
    const alice = await UserFactory.create();
    const bob = await UserFactory.create();
    await inTeam(alice, async () => {
      const project = await ProjectFactory.for(alice).create();
      await TaskFactory.for(project).create();
    });

    // Count, not the absence of one row: a query that ignored the team would return everything.
    expect(await inTeam(bob, () => Project.query().get())).toHaveLength(0);
    expect(await inTeam(bob, () => Task.query().get())).toHaveLength(0);
    expect(await inTeam(alice, () => Project.query().get())).toHaveLength(1);
  });

  test("another team's project is not found, not just forbidden", async () => {
    const alice = await UserFactory.create();
    const bob = await UserFactory.create();
    const project = await inTeam(alice, () => ProjectFactory.for(alice).create());

    (await app.actingAs(bob).get(`/projects/${project.id}`)).assertNotFound();
  });

  test("a new account gets a team of its own", async () => {
    const user = await UserFactory.create();

    expect(user.tenantId).toBeNumber();
  });
});
```

`toHaveLength(0)` fails loudly if scoping breaks. Checking that one particular row is
missing would pass a query that returned everything else.

## Check it

```bash
# in your project root
bun zt test
```

It ends with `0 fail`.

Make sure the isolation test can fail: change `Project` back to `extends Model`, run the
suite, and both of the first two `teams` tests fail. Put it back. Run the suite once with
`bun zt test --isolate` as well, which gives each test file a fresh process, so no file
can pass on state another left behind.

`bun zt doctor` now warns that `AGENTS.md` describes a different project: the app's
packages have changed since the file was written. Refresh it, and the skills with
it:

```bash
# in your project root
bun zt arch:update
```

Then in the browser: sign in as `demo@example.com`, and the demo projects are there. In
a private window, register a new account and follow the verification link printed in
the `dev` output. Its project list is empty, and opening the URL of one of the demo's
projects answers 404.

**Next:** [Deploy it](/docs/tutorial/deploy).
