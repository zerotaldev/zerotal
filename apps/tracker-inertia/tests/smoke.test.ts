/**
 * The scaffold boots, serves its pages, and validates its form.
 *
 * A template ships with a `test` script, so it ships with something for that
 * script to run — and this is the assertion that catches a broken starter:
 * providers register, routes resolve, and a request completes. Delete it once
 * you have real tests, or keep it as the shape to copy.
 */
import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { createTestApp, migrateDatabase, type TestApp } from "zerotal/testing";
import { Hash } from "zerotal/auth";
import { User } from "@app/models/User.ts";
// The catalog itself, so assertions track the translations rather than freeze
// a snapshot of their wording.
import zu from "../resources/lang/zu.json";

let app: TestApp;

beforeAll(async () => {
  // Session encryption needs a key. Seed a deterministic one for tests; `??=`
  // leaves a real key alone when the app's .env is present.
  Bun.env.APP_KEY ??= "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  // Each run gets its own throwaway schema rather than the dev database.
  Bun.env.ZT_DB_URL ??= ":memory:";
  app = await createTestApp(() => import("../bootstrap/app.ts").then((m) => m.default));
  // Build the schema from the project's own migrations. config/database.ts keeps
  // synchronize off — migrations are the single source of truth — so without this
  // the :memory: database above has no tables and every test fails on 'no such
  // table'. Running the real migrations also means the schema under test is the
  // schema that ships, rather than a second definition that drifts from it.
  await migrateDatabase();
});

afterAll(() => app.close());

describe("scaffold", () => {
  test("boots and serves the home page", async () => {
    const res = await app.get("/");

    res.assertOk();
    res.assertInertia("home");
  });

  test("answers HEAD on the home route, as probes and load balancers do", async () => {
    const res = await app.head("/");
    expect(res.status).toBeLessThan(400);
  });

  test("returns 404 for an unregistered path", async () => {
    (await app.get("/definitely-not-a-route")).assertNotFound();
  });
});

/**
 * The auth surface, end to end. Registration is the round trip worth asserting:
 * a valid post creates the account, signs the visitor in, and lands them on a
 * page a guest cannot reach — which proves the guard and the session together.
 */
describe("auth", () => {
  test("serves the guest screens", async () => {
    (await app.get("/login")).assertInertia("login");
    (await app.get("/register")).assertInertia("register");
    (await app.get("/forgot-password")).assertInertia("forgot-password");
  });

  test("keeps the profile behind a sign-in", async () => {
    (await app.get("/profile")).assertRedirect("/login");
  });

  test("rejects a registration whose confirmation does not match", async () => {
    const res = await app.postForm(
      "/register",
      {
        name: "Ada Lovelace",
        email: "mismatch@example.com",
        password: "correct-horse-battery",
        password_confirmation: "something-else",
      },
      { Referer: `${app.baseUrl}/register` },
    );

    res.assertRedirect("/register");
    res.assertInvalid(["password"]);
  });

  test("registers a visitor and signs them in", async () => {
    const res = await app.postForm("/register", {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct-horse-battery",
      password_confirmation: "correct-horse-battery",
    });

    // Landing on /profile is the proof: it is a guarded route, so reaching it
    // means the account was created *and* the session was established.
    res.assertRedirect("/profile");
  });
});

/**
 * Translation, where the English string is the key.
 *
 * There is no `en.json` in this app and there is not meant to be one: `__()` is
 * handed the English sentence, so English is what an unmatched lookup returns.
 * These assertions are what stops that from quietly regressing into a screen
 * full of `auth.email`.
 */
/**
 * The injected globals.
 *
 * `route()` and `__()` are on `globalThis` — installed by `defineRoutes()` and
 * `I18nProvider` respectively — so nothing in this app imports either one. Their
 * ambient type declarations are promises TypeScript cannot verify: delete an
 * install line and every call site still compiles, then throws on the first
 * request. These are the assertions that fail instead.
 */
describe("globals", () => {
  test("route() resolves without an import, against this app's real table", () => {
    expect(typeof globalThis.route).toBe("function");
    expect(route("login")).toBe("/login");
    expect(route("projects.show", { project: "apollo" })).toBe("/projects/apollo");
  });

  test("__() translates without an import", () => {
    expect(typeof globalThis.__).toBe("function");
    // Against the catalog, not a frozen phrasing — the same rule the i18n block
    // below follows. Pinning the isiZulu wording here made re-translating a
    // single string a test failure in an unrelated suite.
    expect(__("Email", {}, "zu")).toBe(zu["Email"]);
    expect(__("Email", {}, "zu")).not.toBe("Email");
  });

  test("the app's own routes are running on them", async () => {
    // `app/routes/login.ts` calls the global `route()` and `__()` with no import
    // line in the file. A 200 here means both resolved inside a real request.
    (await app.get("/login")).assertOk();
  });
});

describe("i18n", () => {
  test("ships an empty catalog for English, because the keys are the English", async () => {
    const page = (await app.get("/login")).inertia();

    expect(page?.props.locale).toBe("en");
    expect(page?.props.messages).toEqual({});
  });

  test("ships the isiZulu catalog when the locale resolves to zu", async () => {
    const page = (await app.get("/login?lang=zu")).inertia();
    const messages = page?.props.messages as Record<string, string>;

    expect(page?.props.locale).toBe("zu");
    // Keyed by the English, which is what the component passes to `__()`. The
    // assertion is against the catalog rather than a copy of its wording: these
    // translations are still being revised, and a test that pins the prose fails
    // on an improvement to the isiZulu instead of on a break in the mechanism.
    expect(messages["Email"]).toBe(zu["Email"]);
    expect(messages["Email"]).not.toBe("Email");
  });

  test("translates server-side strings through the same catalog", () => {
    // What `app/routes/login.ts` flashes on a bad password — the sentence
    // itself, with no key in between. Two assertions, because the first alone
    // would also pass if lookup silently returned the key: it must equal the
    // catalog entry *and* differ from the English it was keyed by.
    const credentials = "Those credentials do not match our records.";
    expect(__(credentials, {}, "zu")).toBe(zu[credentials]);
    expect(__(credentials, {}, "zu")).not.toBe(credentials);
    // English needs no catalog to answer, including through interpolation.
    expect(__("{actor} assigned you an issue", { actor: "Ada" }, "en")).toBe(
      "Ada assigned you an issue",
    );
  });

  test("falls back to English for a string isiZulu has not translated", async () => {
    const messages = (await app.get("/login?lang=zu")).inertia()?.props.messages as Record<
      string,
      string
    >;

    // A sentence no catalog will ever carry, rather than a real string that
    // happens to be untranslated today. Naming one of those made the test a
    // tripwire on translating it: the catalog grew, the string gained an entry,
    // and a test about *fallback* failed for having nothing left to fall back
    // from.
    const untranslated = "No catalog has this sentence, and none ever will.";
    expect(zu[untranslated as keyof typeof zu]).toBeUndefined();
    expect(messages[untranslated]).toBeUndefined();
    // The key is its own answer — that is the fallback.
    expect(__(untranslated, {}, "zu")).toBe(untranslated);
  });
});

/**
 * The signed-in screens.
 *
 * Every authenticated page renders inside one shell, which makes that shell a
 * single point of failure worth an assertion: if it stops resolving, all of
 * these break at once and nothing above would notice.
 *
 * `actingAs` rather than a sign-in POST, because the test client keeps no cookie
 * jar between requests — a real registration lands its session in a response
 * these `get`s would never send back.
 */
describe("application shell", () => {
  test("serves the signed-in pages", async () => {
    const user = await User.forceCreate({
      name: "Grace Hopper",
      email: "grace@example.com",
      password: await Hash.make("correct-horse-battery"),
      role: "user",
    });

    app.actingAs({ id: user.id });

    (await app.get("/projects")).assertInertia("projects/index");
    (await app.get("/profile")).assertInertia("profile");
    (await app.get("/dashboard")).assertInertia("dashboard");
    (await app.get("/activity")).assertInertia("activity");

    app.actingAsGuest();
  });
});

/**
 * Precognition — validating a form against the server's real rules without
 * running the controller.
 *
 * The mechanism is entirely server-side and lives in `FormRequest.validate()`:
 * a `Precognition: true` header makes it run the rules and then short-circuit,
 * 204 for clean input and 422 for errors, before the handler's body executes.
 * That last clause is the whole feature and the only part worth asserting hard —
 * a "validation" endpoint that also creates the record is not validation.
 *
 * The rules come from `StoreIssueRequest`, which is the same object the real
 * POST validates against and the same one the other two cookbook builds share.
 * Nothing is defined twice for the live path.
 */
describe("precognition", () => {
  let author: User;
  let projectSlug: string;

  beforeAll(async () => {
    const { Project } = await import("@app/models/Project.ts");
    author = await User.forceCreate({
      name: "Precog Tester",
      email: "precog@example.com",
      password: await Hash.make("correct-horse-battery"),
      role: "user",
    });
    const project = await Project.forceCreate({
      name: "Precognition",
      slug: "precognition",
      description: "Fixture for the live-validation tests.",
      ownerId: author.id,
    });
    projectSlug = project.slug;
  });

  /** How many issues the fixture project holds — the side-effect check. */
  async function issueCount(): Promise<number> {
    const { Issue } = await import("@app/models/Issue.ts");
    const { Project } = await import("@app/models/Project.ts");
    const project = await Project.query().where("slug", projectSlug).firstOrFail();
    return Issue.query().where("project_id", project.id).count();
  }

  const valid = {
    title: "A title long enough to satisfy the rule",
    body: "",
    status: "backlog",
    priority: "medium",
    assigneeId: "",
  };

  test("valid input answers 204 and creates nothing", async () => {
    app.actingAs({ id: author.id });
    const before = await issueCount();

    const res = await app.post(`/projects/${projectSlug}/issues/new`, valid, {
      Precognition: "true",
    });

    expect(res.status).toBe(204);
    // The point of the feature: the rules ran, the handler did not.
    expect(await issueCount()).toBe(before);
  });

  test("invalid input answers 422 with the field errors, and still creates nothing", async () => {
    app.actingAs({ id: author.id });
    const before = await issueCount();

    const res = await app.post(
      `/projects/${projectSlug}/issues/new`,
      { ...valid, title: "no" },
      { Precognition: "true" },
    );

    expect(res.status).toBe(422);
    const errors = (res.json() as { errors?: Record<string, string> }).errors ?? {};
    expect(Object.keys(errors)).toContain("title");
    // The message itself, not just the key. `ValidationErrors` is
    // `Record<string, string>` — one message per field, not an array — and a
    // client that assumes the array shape renders `errors.title[0]`, which is
    // the letter "T". Asserting the key alone passes either way and caught
    // nothing.
    expect(errors["title"]).toContain("at least 3");
    expect(typeof errors["title"]).toBe("string");
    expect(await issueCount()).toBe(before);
  });

  test("Precognition-Validate-Only narrows the errors to the named fields", async () => {
    app.actingAs({ id: author.id });

    // Two fields are wrong. The client validating the title on blur only wants
    // to hear about the title — reporting the empty status as an error under a
    // field the reader has not reached yet is how live validation becomes noise.
    const res = await app.post(
      `/projects/${projectSlug}/issues/new`,
      { ...valid, title: "no", status: "not-a-status" },
      { Precognition: "true", "Precognition-Validate-Only": "title" },
    );

    expect(res.status).toBe(422);
    const errors = (res.json() as { errors?: Record<string, string[]> }).errors ?? {};
    expect(Object.keys(errors)).toEqual(["title"]);
  });

  test("the response varies on Precognition, so no cache mixes the two", async () => {
    app.actingAs({ id: author.id });
    const res = await app.post(`/projects/${projectSlug}/issues/new`, valid, {
      Precognition: "true",
    });

    expect(res.headers.get("Vary") ?? "").toContain("Precognition");
  });

  test("without the header the same endpoint really does create", async () => {
    app.actingAs({ id: author.id });
    const before = await issueCount();

    // The control. Every assertion above is about something *not* happening, and
    // an endpoint that is simply broken would pass all of them.
    await app.post(`/projects/${projectSlug}/issues/new`, {
      ...valid,
      title: "This one is meant to be saved",
    });

    expect(await issueCount()).toBe(before + 1);
  });
});
