/**
 * The server-rendered build boots, serves its pages, and renders its errors.
 *
 * This build had no suite at all — the only one of the three without one, which
 * is backwards: it is the build with no client router, so every assertion here
 * is about the HTML that actually reaches a browser, with nothing to re-render
 * it afterwards if the server got it wrong.
 */
import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { createTestApp, migrateDatabase, type TestApp } from "zerotal/testing";
import { Hash } from "zerotal/auth";
import { User } from "@app/models/User.ts";
import { Project } from "@app/models/Project.ts";

let app: TestApp;
let author: User;

beforeAll(async () => {
  Bun.env.APP_KEY ??= "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  Bun.env.ZT_DB_URL ??= ":memory:";
  app = await createTestApp(() => import("../bootstrap/app.ts").then((m) => m.default));
  await migrateDatabase();

  author = await User.forceCreate({
    name: "Grace Hopper",
    email: "grace@example.com",
    password: await Hash.make("correct-horse-battery"),
    role: "user",
  });
  await Project.forceCreate({
    name: "Apollo",
    slug: "apollo",
    description: "The one with the issues.",
    ownerId: author.id,
  });
});

afterAll(() => app.close());

describe("the public pages", () => {
  test("serves the home page", async () => {
    const res = await app.get("/");
    res.assertOk();
    expect(res.text()).toContain("<html");
  });

  test("serves the guest screens", async () => {
    (await app.get("/login")).assertOk();
    (await app.get("/register")).assertOk();
  });
});

describe("the auth wall", () => {
  test("keeps the signed-in pages behind a sign-in", async () => {
    app.actingAsGuest();
    for (const path of ["/projects", "/dashboard", "/activity", "/profile"]) {
      (await app.get(path)).assertRedirect("/login");
    }
  });
});

describe("the signed-in pages", () => {
  test("renders the project list server-side", async () => {
    app.actingAs({ id: author.id });
    const res = await app.get("/projects");

    res.assertOk();
    // The markup itself carries the data — there is no client fetch to fill it.
    expect(res.text()).toContain("Apollo");
  });

  test("the issue list renders its filter form", async () => {
    app.actingAs({ id: author.id });
    const res = await app.get("/projects/apollo");

    res.assertOk();
    // A GET form is this build's whole filtering mechanism, so its absence is
    // the feature being gone.
    expect(res.text()).toContain('method="get"');
  });
});

/**
 * Feature 13 — errors as pages.
 *
 * `view()` writes onto the context, and the context carries a 200, so the
 * handler re-wraps the body to restore the real status. That is what these pin:
 * a page reading "404" that answers 200 looks handled to every crawler, cache
 * and uptime monitor that meets it.
 */
describe("error pages", () => {
  test("an unknown URL is the app's own 404, with a 404 on it", async () => {
    const res = await app.get("/no-such-page", { Accept: "text/html" });

    expect(res.status).toBe(404);
    expect(res.text()).toContain("<html");
  });

  test("the status survives the re-wrap", async () => {
    const res = await app.get("/no-such-page", { Accept: "text/html" });
    expect(res.status).not.toBe(200);
  });

  test("an API client still gets JSON, not a page", async () => {
    const res = await app.get("/no-such-page", { Accept: "application/json" });

    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type") ?? "").toContain("application/json");
    expect(res.text()).not.toContain("<html");
  });
});
