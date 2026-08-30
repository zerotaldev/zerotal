import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { SQL } from "bun";
import { _setBaseModelConnection, BaseModel, column, table } from "@zerotal/orm";
import {
  withDatabase,
  assertDatabaseHas,
  assertDatabaseMissing,
  assertDatabaseCount,
  Factory,
  fake,
} from "./index.ts";
import { TestResponse, type SessionDecoder } from "./TestResponse.ts";
import { FactoryBatch } from "./factory.ts";
import { assertStoredFile, assertMissingFile } from "./index.ts";
import { LocalDriver } from "@zerotal/core/storage";
import { CookieDriver } from "@zerotal/session";

// Local disks must live inside the storage root; point it at this suite's scratch area.
Bun.env["ZT_STORAGE_ROOT"] = ".tmp-testing-storage";

/** Build a TestResponse from a literal body — the constructor takes the read body. */
function mk(body: BodyInit | null, init?: ResponseInit): TestResponse {
  const text = typeof body === "string" ? body : "";
  return new TestResponse(new Response(body, init), text);
}

/** Build a TestResponse around a JSON payload. */
function mkJson(value: unknown, init?: ResponseInit): TestResponse {
  return new TestResponse(Response.json(value, init), JSON.stringify(value));
}

// ── In-memory SQLite setup ────────────────────────────────────────────────────

let db: SQLInstance;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  await db`
    CREATE TABLE users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      email      TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    )
  `;
});

afterAll(async () => {
  _setBaseModelConnection(null);
  await db.end();
});

beforeEach(async () => {
  await db`DELETE FROM users`;
});

// ── Test model ────────────────────────────────────────────────────────────────

@table("users")
class User extends BaseModel {
  static override fillable = ["name", "email"];

  @column({ type: "string" }) name!: string;
  @column({ type: "string" }) email!: string;
}

// ── fake helper ───────────────────────────────────────────────────────────────

describe("fake helper", () => {
  it("string() produces a non-empty string", () => {
    expect(fake.string().length).toBeGreaterThan(0);
  });

  it("email() contains @", () => {
    expect(fake.email()).toContain("@");
  });

  it("number() is between min and max", () => {
    const n = fake.number(5, 10);
    expect(n).toBeGreaterThanOrEqual(5);
    expect(n).toBeLessThanOrEqual(10);
  });

  it("uuid() matches UUID pattern", () => {
    expect(fake.uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("sentence() ends with a period", () => {
    expect(fake.sentence()).toMatch(/\.$/);
  });
});

// ── Factory ───────────────────────────────────────────────────────────────────

const UserFactory = Factory.define(User, (f) => ({
  name: f.string(8),
  email: f.email(),
}));

// ── assertDatabaseHas / assertDatabaseMissing ─────────────────────────────────

describe("assertDatabaseHas", () => {
  it("passes when row exists", async () => {
    await db`INSERT INTO users (name, email) VALUES ('Eve', 'eve@example.com')`;
    await assertDatabaseHas("users", { email: "eve@example.com" });
  });

  it("throws when row is missing", async () => {
    let threw = false;
    try {
      await assertDatabaseHas("users", { email: "ghost@example.com" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe("assertDatabaseMissing", () => {
  it("passes when row is absent", async () => {
    await assertDatabaseMissing("users", { email: "nobody@example.com" });
  });

  it("throws when row exists", async () => {
    await db`INSERT INTO users (name, email) VALUES ('X', 'x@example.com')`;
    let threw = false;
    try {
      await assertDatabaseMissing("users", { email: "x@example.com" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

// ── withDatabase ──────────────────────────────────────────────────────────────

describe("assertDatabaseCount", () => {
  it("passes when the row count matches", async () => {
    await UserFactory.createMany(3);
    await assertDatabaseCount("users", 3);
  });

  it("passes with a where filter", async () => {
    await UserFactory.create({ name: "Alice", email: "alice@example.com" });
    await UserFactory.create({ name: "Bob", email: "bob@example.com" });
    await assertDatabaseCount("users", 1, { name: "Alice" });
  });

  it("throws when count does not match", async () => {
    let threw = false;
    try {
      await assertDatabaseCount("users", 99);
    } catch (e) {
      threw = true;
      expect((e as Error).message).toContain('expected table "users"');
      expect((e as Error).message).toContain("99");
    }
    expect(threw).toBe(true);
  });
});

describe("withDatabase()", () => {
  it("rolls back after the test completes", async () => {
    await withDatabase(async () => {
      await UserFactory.create({ name: "Rollback", email: "rb@example.com" });
      await assertDatabaseHas("users", { email: "rb@example.com" });
    })();

    // Outside the transaction the row should be gone
    await assertDatabaseMissing("users", { email: "rb@example.com" });
  });

  it("re-throws errors from the test body", async () => {
    let threw = false;
    try {
      await withDatabase(async () => {
        throw new Error("body error");
      })();
    } catch (e) {
      threw = true;
      expect((e as Error).message).toBe("body error");
    }
    expect(threw).toBe(true);
  });
});

// ── Cookie assertions ─────────────────────────────────────────────────────────

describe("TestResponse.assertCookie()", () => {
  it("passes when cookie is present", () => {
    const res = new TestResponse(
      new Response("ok", { headers: { "Set-Cookie": "theme=dark; Path=/" } }),
    );
    expect(() => res.assertCookie("theme")).not.toThrow();
  });

  it("passes when cookie name and value both match", () => {
    const res = new TestResponse(
      new Response("ok", { headers: { "Set-Cookie": "theme=dark; Path=/" } }),
    );
    expect(() => res.assertCookie("theme", "dark")).not.toThrow();
  });

  it("throws when cookie is absent", () => {
    const res = mk("ok");
    expect(() => res.assertCookie("theme")).toThrow("theme");
  });

  it("throws when cookie value does not match", () => {
    const res = new TestResponse(
      new Response("ok", { headers: { "Set-Cookie": "theme=light; Path=/" } }),
    );
    expect(() => res.assertCookie("theme", "dark")).toThrow("dark");
  });
});

describe("TestResponse.assertCookieMissing()", () => {
  it("passes when cookie is absent", () => {
    const res = mk("ok");
    expect(() => res.assertCookieMissing("theme")).not.toThrow();
  });

  it("throws when cookie IS present", () => {
    const res = new TestResponse(
      new Response("ok", { headers: { "Set-Cookie": "theme=dark; Path=/" } }),
    );
    expect(() => res.assertCookieMissing("theme")).toThrow("theme");
  });
});

// ── Session assertions ────────────────────────────────────────────────────────
//
// These run against the real CookieDriver, not a stand-in that writes a format
// nobody ships. Testing them against a hand-rolled cookie is what let the
// assertions drift silently when the driver moved to authenticated encryption:
// `assertSessionHas` could no longer read any real session, and
// `assertSessionMissing` passed for every key in every app.

const sessionDriver = new CookieDriver("test-secret", "zerotal_session");

/** The decoder TestApp installs: feed the response's cookies back to the driver. */
const decodeSession: SessionDecoder = async (response) => {
  const pairs: string[] = [];
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "set-cookie") return;
    const pair = value.split(";")[0]?.trim();
    if (pair?.startsWith("zerotal_session=")) pairs.push(pair);
  });
  if (pairs.length === 0) return null;
  const request = new Request("http://localhost/", { headers: { Cookie: pairs.join("; ") } });
  return (await sessionDriver.loadFromRequest(request)).data;
};

/** A TestResponse carrying a real, driver-encoded session cookie. */
async function mkSession(data: Record<string, unknown> | null): Promise<TestResponse> {
  const res = new Response("ok");
  if (data !== null) await sessionDriver.saveSession("test-id", data, res);
  return TestResponse.of(res, { session: decodeSession });
}

describe("TestResponse.assertSessionHas()", () => {
  it("reads a session written by the real driver", async () => {
    const res = await mkSession({ status: "saved" });
    expect(() => res.assertSessionHas("status")).not.toThrow();
    expect(() => res.assertSessionHas("status", "saved")).not.toThrow();
  });

  it("reads non-scalar values", async () => {
    const res = await mkSession({ cart: { items: 2 } });
    expect(() => res.assertSessionHas("cart", { items: 2 })).not.toThrow();
  });

  it("throws when session key is absent", async () => {
    const res = await mkSession({});
    expect(() => res.assertSessionHas("status")).toThrow("status");
  });

  it("throws when value does not match", async () => {
    const res = await mkSession({ status: "error" });
    expect(() => res.assertSessionHas("status", "saved")).toThrow("saved");
  });

  it("throws when no session cookie is set", async () => {
    const res = await mkSession(null);
    expect(() => res.assertSessionHas("key")).toThrow("no session cookie");
  });

  it("throws when there is no driver to decode with", () => {
    expect(() => mk("ok").assertSessionHas("key")).toThrow("session.driver");
  });
});

describe("TestResponse.assertSessionMissing()", () => {
  it("passes when session key is absent", async () => {
    const res = await mkSession({ other: 1 });
    expect(() => res.assertSessionMissing("errors")).not.toThrow();
  });

  it("throws when session key IS present", async () => {
    const res = await mkSession({ errors: { name: "required" } });
    expect(() => res.assertSessionMissing("errors")).toThrow("errors");
  });

  it("passes when no session cookie exists", async () => {
    const res = await mkSession(null);
    expect(() => res.assertSessionMissing("anything")).not.toThrow();
  });

  it("throws rather than passing when the session cannot be read", () => {
    // The whole point: "I could not decode it" is not evidence of absence, and an
    // assertion that treats it as such can never fail.
    expect(() => mk("ok").assertSessionMissing("anything")).toThrow("session.driver");
  });
});

describe("TestResponse — auth assertions", () => {
  it("assertAuthenticated passes when a user_id is in the session", async () => {
    const res = await mkSession({ user_id: 42 });
    expect(() => res.assertAuthenticated()).not.toThrow();
    expect(() => res.assertAuthenticatedAs(42)).not.toThrow();
    expect(() => res.assertAuthenticatedAs({ id: 42 })).not.toThrow();
  });

  it("assertAuthenticatedAs compares across the number/string divide", async () => {
    const res = await mkSession({ user_id: "42" });
    expect(() => res.assertAuthenticatedAs(42)).not.toThrow();
  });

  it("assertAuthenticatedAs reports the user actually signed in", async () => {
    const res = await mkSession({ user_id: 7 });
    expect(() => res.assertAuthenticatedAs(42)).toThrow("7");
  });

  it("assertGuest passes with no user_id and fails with one", async () => {
    const guest = await mkSession({ locale: "fr" });
    expect(() => guest.assertGuest()).not.toThrow();
    const signedIn = await mkSession({ user_id: 1 });
    expect(() => signedIn.assertGuest()).toThrow("user_id");
  });
});

describe("TestResponse — validation assertions", () => {
  it("reads errors out of a 422 JSON body", () => {
    const res = mkJson(
      { message: "Validation failed", errors: { email: ["is required"] } },
      { status: 422 },
    );
    expect(() => res.assertInvalid()).not.toThrow();
    expect(() => res.assertInvalid("email")).not.toThrow();
    expect(() => res.assertInvalid({ email: "required" })).not.toThrow();
    expect(() => res.assertValid("email")).toThrow("email");
  });

  it("reads errors flashed to the session by a form submit", async () => {
    const res = await mkSession({ errors: { title: ["is required"] } });
    expect(() => res.assertInvalid("title")).not.toThrow();
    expect(() => res.assertSessionHasErrors(["title"])).not.toThrow();
  });

  it("normalises a bare string message into a list", () => {
    const res = mkJson({ errors: { email: "is required" } }, { status: 422 });
    expect(() => res.assertInvalid({ email: "required" })).not.toThrow();
  });

  it("names the fields that actually failed", () => {
    const res = mkJson({ errors: { email: ["bad"] } }, { status: 422 });
    expect(() => res.assertInvalid("password")).toThrow("email");
  });

  it("assertValid passes when nothing failed", () => {
    expect(() => mkJson({ ok: true }).assertValid()).not.toThrow();
  });
});

// ── fake — extended coverage ──────────────────────────────────────────────────

describe("fake.pick()", () => {
  it("returns an element from the array", () => {
    const arr = ["a", "b", "c"];
    expect(arr).toContain(fake.pick(arr));
  });
});

describe("fake.shuffle()", () => {
  it("returns an array with the same elements", () => {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = fake.shuffle(arr);
    expect(shuffled).toHaveLength(arr.length);
    expect(shuffled.sort()).toEqual([...arr].sort());
  });

  it("does not mutate the original array", () => {
    const arr = [1, 2, 3];
    const copy = [...arr];
    fake.shuffle(arr);
    expect(arr).toEqual(copy);
  });
});

describe("fake.sample()", () => {
  it("returns n unique elements", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = fake.sample(arr, 3);
    expect(result).toHaveLength(3);
    // all elements come from the source array
    result.forEach((el) => expect(arr).toContain(el));
    // no duplicates
    expect(new Set(result).size).toBe(3);
  });
});

describe("fake.float()", () => {
  it("returns a float within the given range", () => {
    const f = fake.float(1, 5, 2);
    expect(f).toBeGreaterThanOrEqual(1);
    expect(f).toBeLessThanOrEqual(5);
  });

  it("respects the decimal-places argument", () => {
    const f = fake.float(0, 1, 3);
    const decimals = String(f).split(".")[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(3);
  });
});

// ── assertStoredFile / assertMissingFile ─────────────────────────────────────

describe("assertStoredFile / assertMissingFile", () => {
  let driver: InstanceType<typeof LocalDriver>;
  const dir = ".tmp-testing-storage/disk-" + Date.now();

  beforeEach(async () => {
    driver = new LocalDriver(dir);
    await driver.put("hello.txt", "hello world");
  });

  afterEach(async () => {
    await driver.delete("hello.txt").catch(() => {});
  });

  it("assertStoredFile passes when file exists", async () => {
    await expect(assertStoredFile(driver, "hello.txt")).resolves.toBeUndefined();
  });

  it("assertStoredFile throws when file is missing", async () => {
    await expect(assertStoredFile(driver, "missing.txt")).rejects.toThrow("missing.txt");
  });

  it("assertMissingFile passes when file does not exist", async () => {
    await expect(assertMissingFile(driver, "not-there.txt")).resolves.toBeUndefined();
  });

  it("assertMissingFile throws when file IS stored", async () => {
    await expect(assertMissingFile(driver, "hello.txt")).rejects.toThrow("hello.txt");
  });
});

// ── TestResponse — basic properties ───────────────────────────────────────────

describe("TestResponse — properties", () => {
  it(".status returns the HTTP status code", () => {
    expect(mk("ok", { status: 201 }).status).toBe(201);
  });

  it(".ok is true for 2xx", () => {
    expect(mk("ok").ok).toBe(true);
  });

  it(".ok is false for non-2xx", () => {
    expect(mk("nf", { status: 404 }).ok).toBe(false);
  });

  it(".headers returns response Headers", () => {
    const res = mk("ok", { headers: { "X-Foo": "bar" } });
    expect(res.headers.get("X-Foo")).toBe("bar");
  });
});

// ── TestResponse.assertStatus() and shortcuts ─────────────────────────────────

describe("TestResponse.assertStatus()", () => {
  it("passes when status matches", () => {
    expect(() => mk("ok").assertStatus(200)).not.toThrow();
  });

  it("throws when status does not match", () => {
    expect(() => mk("nf", { status: 404 }).assertStatus(200)).toThrow("200");
  });
});

describe("TestResponse — status shortcuts", () => {
  it("assertOk passes on 200", () => {
    expect(() => mk("ok").assertOk()).not.toThrow();
  });

  it("assertCreated passes on 201", () => {
    expect(() => mk("", { status: 201 }).assertCreated()).not.toThrow();
  });

  it("assertNoContent passes on 204", () => {
    expect(() => mk(null, { status: 204 }).assertNoContent()).not.toThrow();
  });

  it("assertMovedPermanently passes on 301", () => {
    expect(() =>
      new TestResponse(
        new Response(null, { status: 301, headers: { Location: "/" } }),
      ).assertMovedPermanently(),
    ).not.toThrow();
  });

  it("assertUnauthorized passes on 401", () => {
    expect(() => mk("", { status: 401 }).assertUnauthorized()).not.toThrow();
  });

  it("assertForbidden passes on 403", () => {
    expect(() => mk("", { status: 403 }).assertForbidden()).not.toThrow();
  });

  it("assertNotFound passes on 404", () => {
    expect(() => mk("", { status: 404 }).assertNotFound()).not.toThrow();
  });

  it("assertUnprocessable passes on 422", () => {
    expect(() => mk("", { status: 422 }).assertUnprocessable()).not.toThrow();
  });
});

// ── TestResponse.assertRedirect() ─────────────────────────────────────────────

describe("TestResponse.assertRedirect()", () => {
  it("passes on 302 with matching Location", () => {
    const res = new TestResponse(
      new Response(null, { status: 302, headers: { Location: "/dashboard" } }),
    );
    expect(() => res.assertRedirect("/dashboard")).not.toThrow();
  });

  it("throws when status is not a redirect", () => {
    expect(() => mk("ok").assertRedirect("/")).toThrow("redirect");
  });

  it("throws when Location does not match", () => {
    const res = new TestResponse(
      new Response(null, { status: 302, headers: { Location: "/other" } }),
    );
    expect(() => res.assertRedirect("/dashboard")).toThrow("/dashboard");
  });
});

// ── TestResponse.assertInertiaRedirect() ─────────────────────────────────────

/**
 * The failure a status-and-location assertion cannot see.
 *
 * A redirect with the right status and the right `Location` and no `X-Inertia: true`
 * is ignored by the Inertia client: the request succeeds, the row is written, and the
 * form sits there with its fields still filled in. An app that wrote three tests for
 * this and had them pass with and without its own workaround middleware had written
 * three tests about the two headers that were never wrong.
 */
describe("TestResponse.assertInertiaRedirect()", () => {
  const redirect = (status: number, headers: Record<string, string>): TestResponse =>
    new TestResponse(new Response(null, { status, headers }), "");

  it("passes on a 303 that carries the marker", () => {
    const res = redirect(303, { Location: "/orders/1", "X-Inertia": "true" });
    expect(() => res.assertInertiaRedirect("/orders/1")).not.toThrow();
  });

  it("fails on a redirect that is not marked as Inertia's", () => {
    const res = redirect(303, { Location: "/orders/1" });
    expect(() => res.assertInertiaRedirect("/orders/1")).toThrow(/X-Inertia/);
  });

  it("fails on a 302 after a form submit, and says why that matters", () => {
    const res = redirect(302, { Location: "/orders/1", "X-Inertia": "true" });
    expect(() => res.assertInertiaRedirect("/orders/1")).toThrow(/repeat the method/);
  });

  it("accepts another status when the caller names one", () => {
    const res = redirect(302, { Location: "/orders/1", "X-Inertia": "true" });
    expect(() => res.assertInertiaRedirect("/orders/1", 302)).not.toThrow();
  });

  it("still fails on the wrong Location", () => {
    const res = redirect(303, { Location: "/elsewhere", "X-Inertia": "true" });
    expect(() => res.assertInertiaRedirect("/orders/1")).toThrow("/orders/1");
  });
});

// ── TestResponse.assertHeader() / assertHeaderMissing() ───────────────────────

describe("TestResponse.assertHeader()", () => {
  it("passes when header is present", () => {
    const res = mk("ok", { headers: { "X-Token": "abc" } });
    expect(() => res.assertHeader("X-Token")).not.toThrow();
  });

  it("passes when header value matches", () => {
    const res = new TestResponse(
      new Response("ok", { headers: { "Content-Type": "application/json" } }),
    );
    expect(() => res.assertHeader("Content-Type", "application/json")).not.toThrow();
  });

  it("throws when header is absent", () => {
    expect(() => mk("ok").assertHeader("X-Missing")).toThrow("X-Missing");
  });

  it("throws when header value does not match", () => {
    const res = mk("ok", { headers: { "X-Env": "prod" } });
    expect(() => res.assertHeader("X-Env", "staging")).toThrow("staging");
  });
});

describe("TestResponse.assertHeaderMissing()", () => {
  it("passes when header is absent", () => {
    expect(() => mk("ok").assertHeaderMissing("X-Gone")).not.toThrow();
  });

  it("throws when header is present", () => {
    const res = mk("ok", { headers: { "X-Present": "yes" } });
    expect(() => res.assertHeaderMissing("X-Present")).toThrow("X-Present");
  });
});

// ── TestResponse — body assertions ────────────────────────────────────────────

describe("TestResponse.assertJson()", () => {
  it("passes when all expected keys match", async () => {
    const res = mkJson({ ok: true, count: 5 });
    expect(res.assertJson({ ok: true })).toBe(res);
  });

  it("throws when a key does not match", async () => {
    const res = mkJson({ ok: false });
    expect(() => res.assertJson({ ok: true })).toThrow("ok");
  });
});

describe("TestResponse.assertJsonPath()", () => {
  it("passes for a nested path", async () => {
    const res = mkJson({ user: { name: "Alice" } });
    expect(res.assertJsonPath("user.name", "Alice")).toBe(res);
  });

  it("throws when path value does not match", async () => {
    const res = mkJson({ user: { name: "Bob" } });
    expect(() => res.assertJsonPath("user.name", "Alice")).toThrow("Alice");
  });

  it("supports array index in path", async () => {
    const res = mkJson({ items: ["a", "b", "c"] });
    expect(res.assertJsonPath("items.1", "b")).toBe(res);
  });
});

describe("TestResponse.assertJsonCount()", () => {
  it("passes when top-level array has the right count", async () => {
    const res = mkJson([1, 2, 3]);
    expect(res.assertJsonCount(3)).toBe(res);
  });

  it("throws when count does not match", async () => {
    const res = mkJson([1, 2]);
    expect(() => res.assertJsonCount(5)).toThrow("5");
  });

  it("counts items under a key", async () => {
    const res = mkJson({ data: ["a", "b"] });
    expect(res.assertJsonCount(2, "data")).toBe(res);
  });
});

describe("TestResponse.assertSee()", () => {
  it("passes when body contains the needle", async () => {
    const res = mk("Hello World");
    expect(res.assertSee("Hello")).toBe(res);
  });

  it("throws when needle is absent", async () => {
    const res = mk("Goodbye");
    expect(() => res.assertSee("Hello")).toThrow("Hello");
  });
});

describe("TestResponse.assertDontSee()", () => {
  it("passes when body does not contain the needle", async () => {
    const res = mk("Goodbye");
    expect(res.assertDontSee("Error")).toBe(res);
  });

  it("throws when needle IS present", async () => {
    const res = mk("Fatal Error");
    expect(() => res.assertDontSee("Error")).toThrow("Error");
  });
});

describe("TestResponse.assertBodyContains()", () => {
  it("is an alias for assertSee()", async () => {
    const res = mk("Welcome, Alice");
    expect(res.assertBodyContains("Alice")).toBe(res);
  });
});

describe("TestResponse.json() / text()", () => {
  it("json() parses the response body", async () => {
    const res = mkJson({ id: 1 });
    const data = await res.json<{ id: number }>();
    expect(data.id).toBe(1);
  });

  it("text() returns the body as a string", async () => {
    const res = mk("plain text");
    expect(res.text()).toBe("plain text");
  });
});

// ── fake — additional coverage ────────────────────────────────────────────────

describe("fake.boolean()", () => {
  it("returns a boolean", () => {
    expect(typeof fake.boolean()).toBe("boolean");
  });
  it("respects trueWeight=1 (always true)", () => {
    for (let i = 0; i < 10; i++) expect(fake.boolean(1)).toBe(true);
  });
  it("respects trueWeight=0 (always false)", () => {
    for (let i = 0; i < 10; i++) expect(fake.boolean(0)).toBe(false);
  });
});

describe("fake.uuid()", () => {
  it("returns a valid v4 UUID string", () => {
    const u = fake.uuid();
    expect(typeof u).toBe("string");
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

describe("fake.string()", () => {
  it("returns an alphanumeric string of the given length", () => {
    expect(fake.string(16)).toHaveLength(16);
  });
  it("defaults to length 10", () => {
    expect(fake.string()).toHaveLength(10);
  });
});

describe("fake.maybe()", () => {
  it("always returns value when probability=1", () => {
    expect(fake.maybe("hello", 1)).toBe("hello");
  });
  it("always returns null when probability=0", () => {
    expect(fake.maybe("hello", 0)).toBeNull();
  });
});

describe("fake.date()", () => {
  it("returns a Date", () => {
    expect(fake.date()).toBeInstanceOf(Date);
  });
  it("respects from/to range", () => {
    const from = new Date("2020-01-01");
    const to = new Date("2020-12-31");
    const d = fake.date(from, to);
    expect(d.getTime()).toBeGreaterThanOrEqual(from.getTime());
    expect(d.getTime()).toBeLessThanOrEqual(to.getTime());
  });
});

describe("fake.pastDate() / futureDate()", () => {
  it("pastDate() is in the past", () => {
    expect(fake.pastDate().getTime()).toBeLessThan(Date.now());
  });
  it("futureDate() is in the future", () => {
    expect(fake.futureDate().getTime()).toBeGreaterThan(Date.now());
  });
});

describe("fake.isoDate()", () => {
  it("returns an ISO string", () => {
    const s = fake.isoDate();
    expect(typeof s).toBe("string");
    expect(() => new Date(s)).not.toThrow();
  });
});

describe("fake.timestamp()", () => {
  it("returns a unix timestamp (number)", () => {
    const ts = fake.timestamp();
    expect(typeof ts).toBe("number");
    expect(ts).toBeGreaterThan(0);
  });
});

describe("fake.firstName() / lastName() / fullName()", () => {
  it("firstName returns a non-empty string", () => {
    expect(fake.firstName().length).toBeGreaterThan(0);
  });
  it("lastName returns a non-empty string", () => {
    expect(fake.lastName().length).toBeGreaterThan(0);
  });
  it("name() returns a string with a space", () => {
    expect(fake.name()).toContain(" ");
  });
});

describe("fake.email()", () => {
  it("returns a valid-looking email address", () => {
    expect(fake.email()).toContain("@");
  });
  it("accepts corporate option", () => {
    const e = fake.email({ corporate: true });
    expect(e).toContain("@");
  });
});

describe("fake.phone()", () => {
  it("returns a formatted phone number", () => {
    const p = fake.phone();
    expect(p).toMatch(/^\d{3} \d{3} \d{4}$/);
  });
});

describe("fake — location helpers", () => {
  it("city() returns a string", () => {
    expect(typeof fake.city()).toBe("string");
  });
  it("province() returns a string", () => {
    expect(typeof fake.province()).toBe("string");
  });
  it("suburb() returns a string", () => {
    expect(typeof fake.suburb()).toBe("string");
  });
  it("streetAddress() contains a number", () => {
    expect(fake.streetAddress()).toMatch(/\d/);
  });
  it("postalCode() is a 4-digit string", () => {
    expect(fake.postalCode()).toMatch(/^\d{4}$/);
  });
  it("address() contains commas", () => {
    expect(fake.address()).toContain(",");
  });
});

describe("fake — organisation helpers", () => {
  it("company() returns a string", () => {
    expect(typeof fake.company()).toBe("string");
  });
  it("jobTitle() returns a string", () => {
    expect(typeof fake.jobTitle()).toBe("string");
  });
  it("department() returns a string", () => {
    expect(typeof fake.department()).toBe("string");
  });
});

describe("fake — text helpers", () => {
  it("word() returns a single word", () => {
    expect(fake.word()).not.toContain(" ");
  });
  it("words(3) returns 3 space-joined words", () => {
    expect(fake.words(3).split(" ")).toHaveLength(3);
  });
  it("sentence() ends with a period", () => {
    expect(fake.sentence()).toMatch(/\.$/);
  });
  it("sentence with explicit word count", () => {
    const s = fake.sentence({ words: 4 });
    expect(s.split(" ")).toHaveLength(4);
  });
  it("sentence with short length", () => {
    expect(fake.sentence({ length: "short" })).toMatch(/\.$/);
  });
  it("sentence with long length", () => {
    expect(fake.sentence({ length: "long" })).toMatch(/\.$/);
  });
  it("sentences(2) has two sentences", () => {
    expect(fake.sentences(2).split(". ").length).toBeGreaterThanOrEqual(2);
  });
  it("paragraph() returns a non-empty string", () => {
    expect(fake.paragraph().length).toBeGreaterThan(0);
  });
  it("paragraph() with length options", () => {
    expect(fake.paragraph({ length: "short" }).length).toBeGreaterThan(0);
    expect(fake.paragraph({ length: "long" }).length).toBeGreaterThan(0);
  });
  it("paragraphs(2) returns two paragraphs", () => {
    expect(fake.paragraphs(2).split("\n\n")).toHaveLength(2);
  });
});

describe("fake — title / slug / url", () => {
  it("title() returns a non-empty string", () => {
    expect(fake.title().length).toBeGreaterThan(0);
  });
  it("slug() returns a url-safe string", () => {
    expect(fake.slug()).toMatch(/^[a-z0-9-]+$/);
  });
  it("slug(text) slugifies the provided text", () => {
    expect(fake.slug("Hello World")).toBe("hello-world");
  });
  it("url() starts with https://", () => {
    expect(fake.url()).toMatch(/^https:\/\//);
  });
  it("url({ path: false }) has no path", () => {
    const u = fake.url({ path: false });
    expect(u).toMatch(/^https:\/\/www\.[^/]+$/);
  });
});

describe("fake.password()", () => {
  it("returns a string of default length 12", () => {
    expect(fake.password()).toHaveLength(12);
  });
  it("respects custom length", () => {
    expect(fake.password({ length: 20 })).toHaveLength(20);
  });
  it("simple mode returns alphanumeric only", () => {
    const p = fake.password({ simple: true });
    expect(p).toMatch(/^[a-z0-9]+$/);
  });
  it("default mode contains mixed chars", () => {
    const p = fake.password();
    expect(p).toMatch(/[A-Z]/);
    expect(p).toMatch(/[0-9]/);
  });
});

// ── Factory — additional coverage ─────────────────────────────────────────────

describe("Factory.state()", () => {
  it("returns a new Factory instance with forcedState set", () => {
    const f = UserFactory.state("active");
    expect(f).toBeInstanceOf(Factory);
    // Make produces an instance (state applied at DB level, no error on make)
    const inst = f.make();
    expect(inst).toBeInstanceOf(User);
  });
});

describe("Factory.for()", () => {
  it("injects foreign key from a model instance", () => {
    const parent = new User();
    parent.id = 42;
    const f = UserFactory.for(parent, "parentId");
    const inst = f.make();
    expect((inst as unknown as Record<string, unknown>)["parentId"]).toBe(42);
  });

  it("derives foreign key from class name by default", () => {
    const parent = new User();
    parent.id = 7;
    const f = UserFactory.for(parent);
    const inst = f.make();
    expect((inst as unknown as Record<string, unknown>)["userId"]).toBe(7);
  });
});

describe("Factory.afterCreate()", () => {
  it("runs the callback after create", async () => {
    let called = false;
    const result = await UserFactory.afterCreate(async () => {
      called = true;
    }).create();
    expect(called).toBe(true);
    expect(result).toBeInstanceOf(User);
  });
});

describe("Factory.dispatchEvents()", () => {
  it("returns a Factory instance", () => {
    expect(UserFactory.dispatchEvents()).toBeInstanceOf(Factory);
  });
});

describe("Factory.make()", () => {
  it("returns an in-memory instance without hitting the DB", () => {
    const inst = UserFactory.make({ name: "In Memory" });
    expect(inst.name).toBe("In Memory");
    expect(inst.id).toBeUndefined();
  });
});

describe("Factory.createMany()", () => {
  it("inserts the specified number of instances", async () => {
    const users = await UserFactory.createMany(3);
    expect(users).toHaveLength(3);
    for (const u of users) expect(u.id).toBeDefined();
  });
});

describe("FactoryBatch", () => {
  it("count(n).create() inserts n instances", async () => {
    const users = await UserFactory.count(2).create();
    expect(users).toHaveLength(2);
  });

  it("count(n).state() returns a FactoryBatch", () => {
    const batch = UserFactory.count(2).state("premium");
    expect(batch).toBeInstanceOf(FactoryBatch);
  });

  it("count(n).for() returns a FactoryBatch", () => {
    const parent = new User();
    parent.id = 99;
    const batch = UserFactory.count(2).for(parent, "parentId");
    expect(batch).toBeInstanceOf(FactoryBatch);
  });

  it("count(n).afterCreate() runs callback per instance", async () => {
    let count = 0;
    await UserFactory.count(3)
      .afterCreate(() => {
        count++;
      })
      .create();
    expect(count).toBe(3);
  });

  it("count(n).dispatchEvents() returns FactoryBatch", () => {
    const batch = UserFactory.count(2).dispatchEvents();
    expect(batch).toBeInstanceOf(FactoryBatch);
  });
});
