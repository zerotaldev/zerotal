---
title: A Per-User Setting
description: Declare a typed setting with a default in code, let each user change it, read it where it matters, and test the default, the override and the page with SettingsFake.
---

# A Per-User Setting

The starter's projects list shows ten projects a page, fixed in code. By the end of this
recipe the number is a setting: declared once with its default and its limits, changed
by each user on a new **Preferences** page under Settings, read by the projects list, and
covered by tests that run with `SettingsFake` and need no settings table.

## Before you start

You need the React starter with its example `Project` resource: the projects list in
`app/routes/(auth)/(verified)/projects/index.ts`, the Settings section and its layout,
and the feature tests with `bootApp()` in `tests/support.ts`.

The validator and the test helpers come with `zerotal`, as `zerotal/validator` and
`zerotal/testing`, and need nothing installed. Settings is not part of that bundle, so
install it:

```bash
# in your project root
bun add @zerotal/settings@~1.18.0
```

It stores overrides in a `zerotal_settings` table that it creates when the app boots,
so there is no migration to write.

## Register the provider

Register `SettingsProvider` after the database, which its table lives in:

```ts fragment
// bootstrap/providers.ts
import { SettingsProvider } from "@zerotal/settings";

const providers = [
  LogProvider,
  DatabaseProvider,
  SettingsProvider,
  // …the rest, unchanged
];
```

In 1.18.0 one more line is needed. A settings group reads the `settings` service
synchronously, and `SettingsProvider` does not resolve that service while the app
boots, so the first read throws `E_SETTINGS_NOT_REGISTERED` even though the provider is
registered. Resolve it once in the app's own provider:

```ts fragment
// app/providers/AppServiceProvider.ts
export class AppServiceProvider extends ServiceProvider {
  override async onBooting(): Promise<void> {
    // Settings groups read the `settings` service synchronously, and SettingsProvider
    // 1.18.0 does not resolve it at boot. Resolving it once here makes it ready.
    await this.app.container.make("settings");
  }

  // …onBooted(), unchanged
}
```

The line is harmless once the provider does this itself. The last test below fails
without it, which is how you will know.

## Declare the setting

A setting is declared once, in code, with its type, its default and its limits. Every
read and write goes through the group `defineSettings()` returns, so only declared keys
are accepted and a read comes back as a `number`, not as text from a table:

```ts
// app/settings.ts
import { defineSettings, setting } from "@zerotal/settings";

/**
 * Preferences a signed-in user can change for themselves. The default lives here, in
 * code; a user's own choice is stored as an override and wins over it.
 */
export const preferences = defineSettings({
  "projects.perPage": setting.number({
    default: 10,
    min: 5,
    max: 50,
    integer: true,
    // Each user can pick their own; the app-wide level changes it for everyone at once.
    scopes: ["global", "user"],
    label: "Projects per page",
  }),
});
```

`scopes` says who may override the default. The package's default is
`["global", "tenant"]`, for apps with teams; this app has none, so the levels are the
whole app and each user. A read takes the most specific value that applies: the user's
own, then the app-wide one, then the default above.

## Read it

The projects list asks for the value on each request. Inside a request the signed-in
user is the one it is read for, so there is nothing to pass:

```ts fragment
// app/routes/(auth)/(verified)/projects/index.ts
import { preferences } from "@app/settings";

// GET /projects?search=…&page=… — the signed-in user's projects, newest first.
export const GET = async (http: HttpContext) => {
  const url = new URL(http.request.url);
  const search = (url.searchParams.get("search") ?? "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  // The user's own choice if they made one, else the app-wide value, else the default.
  const perPage = await preferences.get("projects.perPage");

  // …the query, unchanged
  const result = await query
    .orderBy("updated_at", "desc")
    .orderBy("id", "desc")
    .paginate(perPage, page);
```

Delete the `PER_PAGE` constant at the top of the file: the setting replaces it.

## Let a user change it

A route for the new page. `GET` shows the current value; `PATCH` saves the user's
choice:

```ts fragment
// app/routes/(auth)/settings/preferences.ts
import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { validate } from "zerotal/validator";
import { InvalidSettingValueError } from "@zerotal/settings";
import { preferences } from "@app/settings";
import { rejectInput } from "@app/support/validation";

export const meta = { PATCH: { name: "settings.preferences.update" } };

// GET /settings/preferences
export const GET = async () => {
  return Inertia.render("settings/preferences", {
    title: "Preferences",
    perPage: await preferences.get("projects.perPage"),
  });
};

// PATCH /settings/preferences — saved for the signed-in user only.
export async function PATCH(http: HttpContext): Promise<void> {
  const { perPage } = await validate(http, (r) => ({ perPage: r.number() }));

  try {
    // `at: "user"` makes it this user's override. Without it the write would go to the
    // app-wide level and change the page size for everyone.
    await preferences.set("projects.perPage", perPage, { at: "user" });
  } catch (error) {
    // The setting's definition holds the limits, and refuses a value outside them
    // before anything is stored.
    if (error instanceof InvalidSettingValueError) {
      rejectInput(
        http,
        { perPage: "Choose a whole number from 5 to 50." },
        "/settings/preferences",
      );
    }
    throw error;
  }

  http.flash("success", "Preferences saved.");
  http.redirect("/settings/preferences", 303);
}
```

The validator only checks that the field is a number. The limits are the setting's own,
and `set()` checks the value against them before anything is stored: a value outside
them throws `InvalidSettingValueError`, which the route turns into a field error with the
starter's `rejectInput()`. That keeps the limits in one place, the declaration.

Regenerate the route names, so the page can call `route("settings.preferences.update")`:

```bash
# in your project root
bun zt route:types
```

The page is a select with three sizes, in the same card as the other settings pages:

```tsx fragment
// resources/js/pages/settings/preferences.tsx
import type { FormEvent, ReactNode } from "react";
import { Head, useForm } from "@inertiajs/react";
import SettingsLayout from "../../Layouts/SettingsLayout";
import { Button } from "../../Components/Button";
import { Card, CardBody, CardFooter, CardHeader } from "../../Components/Card";
import { SelectField } from "../../Components/Field";

interface Props {
  title: string;
  perPage: number;
}

const PAGE_SIZES = [10, 25, 50].map((n) => ({ value: String(n), label: `${n} per page` }));

function Preferences({ title, perPage }: Props) {
  const form = useForm({ perPage: String(perPage) });

  function submit(event: FormEvent) {
    event.preventDefault();
    form.patch(route("settings.preferences.update"), { preserveScroll: true });
  }

  return (
    <>
      <Head title={title} />

      <Card>
        <form onSubmit={submit}>
          <CardHeader title="Preferences" description="How the app shows things to you." />
          <CardBody className="space-y-5">
            <SelectField
              label="Projects per page"
              options={PAGE_SIZES}
              value={form.data.perPage}
              error={form.errors.perPage}
              onChange={(e) => form.setData("perPage", e.target.value)}
            />
          </CardBody>
          <CardFooter>
            <Button type="submit" disabled={form.processing || !form.isDirty}>
              {form.processing ? "Saving…" : "Save"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </>
  );
}

Preferences.layout = (page: ReactNode) => <SettingsLayout>{page}</SettingsLayout>;

export default Preferences;
```

Add it to the Settings menu, after Appearance:

```tsx fragment
// resources/js/Layouts/SettingsLayout.tsx
import {
  // …
  PaletteIcon,
  SettingsIcon,
  ShieldIcon,
  // …
} from "../Components/Icon";

// …in `sections`:
{ label: "Appearance", href: "/settings/appearance", icon: PaletteIcon },
{ label: "Preferences", href: "/settings/preferences", icon: SettingsIcon },
```

And give `tests/pages.test.ts` its line, so the page is built once in the suite:

```ts fragment
// tests/pages.test.ts
import SettingsPreferences from "../resources/js/pages/settings/preferences";

// …in SIGNED_IN:
["settings/preferences", SettingsPreferences, { title: "Preferences", perPage: 10 }],
```

## The tests

```ts fragment
// tests/preferences.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { InvalidSettingValueError, SettingsFake } from "@zerotal/settings";
import { assertDatabaseHas, refreshDatabase, type TestApp } from "zerotal/testing";
import { inertiaProps } from "@zerotal/inertia/testing";
import type { User } from "../app/models/User";
import { preferences } from "../app/settings";
import { ProjectFactory } from "../database/factories/ProjectFactory";
import { UserFactory } from "../database/factories/UserFactory";
import { bootApp } from "./support";

let app: TestApp;

beforeAll(async () => {
  app = await bootApp();
});
afterAll(() => app.close());
beforeEach(() => app.actingAsGuest());

/** How many projects the first page of /projects shows this user. */
async function firstPageSize(user: User): Promise<number> {
  const res = (await app.actingAs(user).get("/projects")).assertOk();
  return inertiaProps(res, "projects/index").projects.length;
}

describe("preferences", () => {
  refreshDatabase();

  // Overrides live in memory for one test, and are gone after it.
  let settings: SettingsFake;
  beforeEach(() => {
    settings = SettingsFake.install();
  });
  afterEach(() => settings.restore());

  test("lists ten projects to a page by default", async () => {
    const user = await UserFactory.create();
    await ProjectFactory.for(user).count(30).create();

    expect(await preferences.get("projects.perPage", { user: user.id })).toBe(10);
    expect(await firstPageSize(user)).toBe(10);
  });

  test("a user's choice changes their page size and no one else's", async () => {
    const ada = await UserFactory.create();
    const bob = await UserFactory.create();
    await ProjectFactory.for(ada).count(30).create();
    await ProjectFactory.for(bob).count(30).create();

    const res = await app.actingAs(ada).patchForm("/settings/preferences", { perPage: "25" });

    res.assertRedirect("/settings/preferences");
    expect(settings.stored()).toMatchObject([{ key: "projects.perPage", scope: `user:${ada.id}` }]);
    expect(await firstPageSize(ada)).toBe(25);
    expect(await firstPageSize(bob)).toBe(10);
  });

  test("refuses a page size outside the limits and stores nothing", async () => {
    const user = await UserFactory.create();

    const res = await app
      .actingAs(user)
      .patchForm(
        "/settings/preferences",
        { perPage: "500" },
        { Referer: `${app.baseUrl}/settings/preferences` },
      );

    res.assertRedirect("/settings/preferences");
    res.assertInvalid(["perPage"]);
    expect(settings.stored()).toHaveLength(0);
  });

  test("an app-wide value changes the default for everyone", async () => {
    const user = await UserFactory.create();
    await ProjectFactory.for(user).count(30).create();

    // Outside a request there is no signed-in user, so this writes the app-wide level.
    await preferences.set("projects.perPage", 5);

    expect(await firstPageSize(user)).toBe(5);
  });

  test("a pinned value wins over every level", async () => {
    const user = await UserFactory.create();
    await ProjectFactory.for(user).count(30).create();
    await preferences.set("projects.perPage", 25, { user: user.id, at: "user" });

    settings.override("projects.perPage", 50);

    expect(await firstPageSize(user)).toBe(30);
    // A pin has to be a value the app could hold.
    expect(() => settings.override("projects.perPage", 500)).toThrow(InvalidSettingValueError);
  });
});

describe("preferences, stored for real", () => {
  refreshDatabase();

  // No fake here: this is the test that fails if SettingsProvider is not wired up.
  test("saves a user's choice in the settings table", async () => {
    const user = await UserFactory.create();

    await app.actingAs(user).patchForm("/settings/preferences", { perPage: "25" });

    await assertDatabaseHas("zerotal_settings", {
      setting_key: "projects.perPage",
      scope_key: `user:${user.id}`,
      value: "25",
    });
    (await app.actingAs(user).get("/settings/preferences")).assertInertiaProp("perPage", 25);
  });
});
```

What each part relies on:

- **`SettingsFake.install()`** replaces the `settings` service with one that keeps
  overrides in memory. User and app-wide levels, validation and the order a read takes
  them in behave as they do in the app, so the tests cover the real rules with no table.
  `restore()` in `afterEach` puts the real service back.
- **`settings.stored()`** lists every override written through the fake. The second
  test uses it to prove the form saved a user override, filed as `user:<id>`, and not an
  app-wide one. Without `at: "user"` in the route, Bob's page size would change too, and
  that test fails.
- **`settings.override()`** pins a value above every level, for a test about what the
  app does with a value rather than how it got there. A pin is checked against the
  definition, so `500` throws.
- **The last test has no fake.** The fake replaces the service, so it cannot notice the
  real one missing or unready. This test saves through the real store and reads the row
  back, and it is the one that fails without the `onBooting()` line above.

## Run it

```bash
# in your project root
bun zt test tests/preferences.test.ts
bun zt test
```

The whole suite still passes: the starter's own pagination test expects ten projects a
page, which is the default.

`bun zt doctor` now warns that `AGENTS.md` describes a different project, because the
app has a package it did not have when the file was written. Refresh it:

```bash
# in your project root
bun zt arch:update
```

Then start the app with `bun zt dev`, sign in, and open **Settings → Preferences**. Pick
25, save, and the projects list shows 25 a page for you and still ten for everyone else.

## See also

- [Settings](/docs/settings): levels, hiding an override, the audit trail and the admin
  screen.
- [Settings: Testing](/docs/settings#testing): everything `SettingsFake` can do.
- [Validation](/docs/validator): the rules the route's form check is built from.
- [HTTP Tests](/docs/testing/http): `patchForm()`, `assertInvalid()` and the other
  assertions used here.
- [Service Providers](/docs/providers): `onBooting()` and when it runs.
