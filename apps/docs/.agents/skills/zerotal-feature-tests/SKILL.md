---
name: zerotal-feature-tests
description: "Write a feature test for a Zerotal app — booting the real app once per file, a fresh database per test, signing in, faking mail and notifications, and asserting what must not happen."
---

<!-- zerotal:arch:generated -->

# Writing a feature test

If `tests/support.ts` exists, use its `bootApp()` rather than writing another: it already
sets the key and database a test needs. The tests beside it show the house style.

## Shape

```ts
import { afterAll, beforeAll, beforeEach, describe, test } from "bun:test";
import { createTestApp, refreshDatabase, type TestApp } from "zerotal/testing";

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp(() => import("../bootstrap/app.ts").then((m) => m.default));
});
afterAll(() => app.close());
beforeEach(() => app.actingAsGuest());

describe("invoices", () => {
  refreshDatabase();

  test("a guest is sent to sign in", async () => {
    (await app.get("/invoices")).assertRedirect("/login");
  });
});
```

## Traps

- **One app per file, not per test.** Booting is the slow part. `refreshDatabase()` gives
  each test a clean database without paying for it again.
- **The schema under test must be the one that ships.** If migrations own the schema, call `migrateDatabase()` after booting; a test database built any other way can pass against columns production never gets.
- **Sign-in state leaks between tests** unless each one resets it. `app.actingAs(user)` for
  one signed-in request, `app.actingAsGuest()` in `beforeEach`. A flow that spans requests
  — sign in, then a two-factor code — needs the cookies kept between them.
- **Fake what leaves the process.** `NotificationFake.install()` (restore it in
  `afterEach`) records notifications instead of sending them; assert on what was sent, not on
  an inbox the fake never fills.
- **Assert the refusal.** For every rule — owner only, admin only, tenant only — one test
  where the wrong user is refused, with `assertForbidden()` or `assertNotFound()` as the app
  answers it. Assert counts, not the absence of one row: a query that returns everything
  except the row you looked for passes the second and fails the first.
- **Run with `bun zt test`**, and read its exit status directly — `| tail` replaces it with
  `tail`'s.

`api_surface @zerotal/testing` has every assertion on a response.
