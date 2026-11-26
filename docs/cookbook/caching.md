---
title: Cache an Expensive Read
description: Cache the dashboard's per-user project counts with Cache.remember(), forget them when a project changes, and prove both in a feature test.
---

# Cache an Expensive Read

The starter's dashboard counts the signed-in user's projects on every visit: four queries
for the totals and the recent list. By the end of this recipe that summary is cached per
user for ten minutes, forgotten the moment one of the user's projects is created, edited or
deleted, and a feature test proves both halves: a second visit is served from the cache,
and a change is seen at once.

Four small queries are not slow. They are the shape every expensive read takes, though: a
result that is the same on every visit until something changes it. The same steps apply
to a report that takes seconds, or a call to another service.

## Before you start

The React starter already has the pieces this recipe changes:

- the dashboard route, `app/routes/(auth)/(verified)/dashboard.ts`, which counts the
  projects;
- the routes that change a project: `POST` in `app/routes/(auth)/(verified)/projects/index.ts`,
  and `PUT` and `DELETE` in `app/routes/(auth)/(verified)/projects/[project]/index.ts`;
- `bootApp()` in `tests/support.ts`, which boots the app against an in-memory database,
  and `tests/projects.test.ts`, which already checks the counts on the dashboard.

The cache ships in the `zerotal` package the app already depends on, as `zerotal/cache`.
There is nothing to install. The starter does not register it, so that is the first step.

## Register the cache

Without its provider, the first `Cache` call fails:

```
FacadeBindingMissingError: Could not resolve the "cache" facade.
```

Configure it:

```ts
// config/cache.ts
import { CacheConfig } from "zerotal/cache";

export default CacheConfig({
  // SQLite in this process's memory: nothing to run, and emptied on restart. Each
  // process has its own, so once a second one changes data (a queue worker, another
  // server), point `sqlite.path` at a file they share, or use "redis".
  driver: "sqlite",
  sqlite: { path: ":memory:" },
});
```

SQLite in memory is the default driver, so this file changes nothing yet. It makes the
choice visible, and it is where you change it. An in-memory cache belongs to one process,
which is right for one server; when a second process changes projects too, such as a queue
worker or another server behind a load balancer, they need a cache they share, or one
would go on serving what the other had already changed.

Then register `CacheProvider` in `bootstrap/providers.ts`:

```ts fragment
// bootstrap/providers.ts
import { DatabaseProvider } from "zerotal/orm";
import { CacheProvider } from "zerotal/cache";
// …

const providers = [
  LogProvider,
  DatabaseProvider,
  CacheProvider,
  // …
];
```

## Cache the summary

Put the cached read and the way to forget it side by side, in one module, so the key is
written in one place:

```ts fragment
// app/support/project-summary.ts
import { Cache } from "zerotal/cache";
import { Project } from "@app/models/Project";

/** How long a summary may be served before it is counted again, in seconds. */
const TTL = 600;

/** One user's entry. The user id is in the key, so no one is served someone else's. */
function key(userId: number): string {
  return `project-summary:${userId}`;
}

/**
 * The project counts and recent projects the dashboard shows. From the cache when an
 * entry is there; otherwise counted, stored and returned.
 */
export function projectSummary(userId: number) {
  return Cache.remember(key(userId), TTL, async () => {
    const mine = () => Project.query().where("user_id", userId);
    const [total, active, completed, recent] = await Promise.all([
      mine().count(),
      mine().where("status", "active").count(),
      mine().where("status", "completed").count(),
      mine().orderBy("updated_at", "desc").orderBy("id", "desc").limit(5).get(),
    ]);

    // Stored as JSON, so plain values: numbers, and each project as its page data.
    return {
      stats: { total: Number(total), active: Number(active), completed: Number(completed) },
      recentProjects: recent.map((project) => project.toPage()),
    };
  });
}

/** Drop a user's summary, so the next dashboard counts again. */
export function forgetProjectSummary(userId: number): Promise<void> {
  return Cache.forget(key(userId));
}
```

`Cache.remember(key, ttl, fn)` returns the cached value when there is one. Otherwise it
runs `fn`, stores what it returns for `ttl` seconds, and returns it. Two requests that miss
at the same moment wait for one run of `fn` rather than both counting.

Three things about the value matter:

- **The key holds the user id.** The summary is one user's, and a key without the id would
  show the first visitor's numbers to everyone.
- **It is stored as JSON.** The counts go through `Number()`, and each project through
  `toPage()`, so what comes back out is the same plain data the page was going to receive.
  A model instance would come back as a plain object without its methods.
- **The ten minutes are a backstop.** The routes below forget the entry when they change a
  project. A write that does not go through them, such as the seeder or a query run by
  hand, is seen when the entry expires.

The dashboard now asks for the summary instead of counting:

```ts fragment
// app/routes/(auth)/(verified)/dashboard.ts
import { Inertia } from "@zerotal/inertia";
import { Auth } from "zerotal/auth";
import { projectSummary } from "@app/support/project-summary";

/** "Good morning" before noon, and so on — by the server's clock. */
function timeOfDay(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// GET /dashboard — where a user lands after signing in.
export const GET = async () => {
  const user = Auth.user();
  const firstName = user.name.split(" ")[0] ?? user.name;
  const { stats, recentProjects } = await projectSummary(user.id);

  return Inertia.render("dashboard", {
    title: "Dashboard",
    // Not cached: it changes with the clock, and costs nothing to work out.
    greeting: `${timeOfDay(new Date().getHours())}, ${firstName}`,
    stats,
    recentProjects,
  });
};
```

## Forget it when a project changes

A cached value is only right while the data behind it is unchanged, so every route that
changes a project forgets its owner's summary. Forgetting rather than recomputing keeps the
work where it was: the next dashboard visit counts again.

In `app/routes/(auth)/(verified)/projects/index.ts`, after `POST` saves the new project:

```ts fragment
// app/routes/(auth)/(verified)/projects/index.ts
import { forgetProjectSummary } from "@app/support/project-summary";
// …
export async function POST(http: HttpContext): Promise<void> {
  // …
  // Set in code, never from the form: the owner is whoever is signed in.
  project.userId = Auth.user().id;
  await project.save();
  // The cached counts no longer include everything: drop them, and the next dashboard
  // counts again.
  await forgetProjectSummary(project.userId);
  // …
}
```

In `app/routes/(auth)/(verified)/projects/[project]/index.ts`, after `PUT` saves and after
`DELETE` deletes:

```ts fragment
// app/routes/(auth)/(verified)/projects/[project]/index.ts
import { forgetProjectSummary } from "@app/support/project-summary";

// PUT /projects/:project
export async function PUT(http: HttpContext<{ project: Project }>): Promise<void> {
  // …
  await project.save();
  // Its status may have changed, and with it the dashboard's counts.
  await forgetProjectSummary(project.userId);
  // …
}

// DELETE /projects/:project
export async function DELETE(http: HttpContext<{ project: Project }>): Promise<void> {
  // …
  await project.delete();
  await forgetProjectSummary(project.userId);
  // …
}
```

One key per user is all this needs. When several entries depend on the same data, store
them under a tag with `Cache.tags([...])` and flush the tag instead. A tag flush clears the
entries written under that same set of tags, in any order; flushing one tag does not reach
entries written under a set that only includes it. [Tags](/docs/cache#tags) covers the
calls.

## The test

The test app's cache lives as long as the app, and every test file in a run shares one
booted app. Empty the cache when a file boots it, in `bootApp()` in `tests/support.ts`, so
no entry written by an earlier file is served to a later one:

```ts fragment
// tests/support.ts
import { config } from "zerotal";
import { Cache } from "zerotal/cache";
// …

export async function bootApp(): Promise<TestApp> {
  // …
  await migrateDatabase();
  // Every test file in the run shares one booted app, and so one cache. Start each file
  // with it empty, so no entry written by an earlier file is served to this one.
  await Cache.flush();
  return app;
}
```

Then the tests:

```ts fragment
// tests/dashboard-cache.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, test } from "bun:test";
import { Cache } from "zerotal/cache";
import { refreshDatabase, type TestApp } from "zerotal/testing";
import { ProjectFactory } from "../database/factories/ProjectFactory";
import { UserFactory } from "../database/factories/UserFactory";
import { bootApp } from "./support";

let app: TestApp;

beforeAll(async () => {
  app = await bootApp();
});
afterAll(() => app.close());
beforeEach(() => app.actingAsGuest());
// refreshDatabase() rolls back the rows a test wrote, but the cache is not in that
// transaction. Empty it too, or the next test's user, given the same id, is served this one's.
afterEach(() => Cache.flush());

const valid = { name: "Website relaunch", description: "", status: "active" };

describe("the dashboard's cached summary", () => {
  refreshDatabase();

  test("is served from the cache once counted", async () => {
    const user = await UserFactory.create();
    await ProjectFactory.for(user).create({ status: "active" });

    (await app.actingAs(user).get("/dashboard")).assertInertiaProp("stats", {
      total: 1,
      active: 1,
      completed: 0,
    });

    // Written straight to the database, not through a route, so nothing forgets the entry.
    // The page still shows one project: the cached summary, not a fresh count.
    await ProjectFactory.for(user).create({ status: "active" });

    (await app.actingAs(user).get("/dashboard")).assertInertiaProp("stats", {
      total: 1,
      active: 1,
      completed: 0,
    });
  });

  test("is counted again after a project is created", async () => {
    const user = await UserFactory.create();
    (await app.actingAs(user).get("/dashboard")).assertInertiaProp("stats", {
      total: 0,
      active: 0,
      completed: 0,
    });

    await app.actingAs(user).postForm("/projects", valid);

    (await app.actingAs(user).get("/dashboard")).assertInertiaProp("stats", {
      total: 1,
      active: 1,
      completed: 0,
    });
  });

  test("is counted again after a project is edited or deleted", async () => {
    const user = await UserFactory.create();
    const project = await ProjectFactory.for(user).create({ status: "active" });
    await app.actingAs(user).get("/dashboard");

    await app.actingAs(user).putForm(`/projects/${project.id}`, { ...valid, status: "completed" });

    (await app.actingAs(user).get("/dashboard")).assertInertiaProp("stats", {
      total: 1,
      active: 0,
      completed: 1,
    });

    await app.actingAs(user).delete(`/projects/${project.id}`);

    (await app.actingAs(user).get("/dashboard")).assertInertiaProp("stats", {
      total: 0,
      active: 0,
      completed: 0,
    });
  });

  test("is kept per user", async () => {
    const ada = await UserFactory.create();
    const grace = await UserFactory.create();
    await ProjectFactory.for(ada).count(2).create();

    await app.actingAs(ada).get("/dashboard");

    (await app.actingAs(grace).get("/dashboard")).assertInertiaProp("stats", {
      total: 0,
      active: 0,
      completed: 0,
    });
  });
});
```

What each part relies on:

- **The first test proves the cache is used.** A project written by the factory goes
  straight to the database, past the routes that forget the entry, so a dashboard that
  still shows one project is showing the cached summary. Without the cache it would show
  two, and the test fails.
- **The next two go through the routes.** Creating, editing and deleting a project through
  its route must show up on the very next visit. Remove any one of the
  `forgetProjectSummary()` calls and its test fails.
- **`Cache.flush()` after each test.** `refreshDatabase()` rolls back the rows a test
  wrote, but the cache is not in that transaction. Ids are reused once the rows are gone,
  so the next test's user can have the same id as this one's, and would be served this
  one's summary.

## Run it

```bash
# in your project root
bun zt test tests/dashboard-cache.test.ts
```

```
…
 0 fail
```

Then run the whole suite with `bun zt test`. The starter's own dashboard test in
`tests/projects.test.ts` passes unchanged: it creates its projects before its first visit,
so the first visit counts them.

To see the cache in the running app, start `bun zt dev`, sign in as `demo@example.com`
with the password `password` (after `bun zt db:seed`) and note the counts on the dashboard.
Change a project's status in `database/db.sqlite` with any SQLite client, and the
dashboard keeps its counts, served from the cache. Add a project through the app, and
every count is fresh on the next visit, the direct change included.

## See also

- [Cache](/docs/cache) — the drivers, `remember()`, tags, and the other operations.
- [Testing](/docs/testing) — booting the app in a test, factories and fakes.
- [HTTP Tests](/docs/testing/http#one-app-per-process) — why every test file shares one
  booted app.
- [Query Builder](/docs/query-builder) — the queries a cached read usually wraps.
