/**
 * End-to-end coverage for the request shapes and failure modes a real app hits:
 * form submits, file uploads, a route that throws, and a session that round-trips
 * through the driver an application actually ships with.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { Application, Router, HttpContext, currentApp } from "@zerotal/core";
import { CookieDriver, SessionMiddleware } from "@zerotal/session";
import { createTestApp, type TestApp } from "./TestApp.ts";
import { fakeFile } from "./fakeFile.ts";

const SECRET = "test-secret-for-the-features-suite";

class BoomError extends Error {
  override name = "BoomError";
  constructor(readonly detail: string) {
    super(`boom: ${detail}`);
  }
}

class FeatureController {
  /** Echo a urlencoded form body back as JSON. */
  async form(http: HttpContext): Promise<void> {
    const body = await http.request.formData();
    const out: Record<string, string> = {};
    for (const [key, value] of body.entries()) {
      if (typeof value === "string") out[key] = value;
    }
    http.json({ method: http.request.method, fields: out });
  }

  /** Report what arrived on a multipart upload. */
  async upload(http: HttpContext): Promise<void> {
    const file = await http.file("avatar");
    if (!file) {
      http.json({ received: false }, 422);
      return;
    }
    const sniffed = await file.detectType();
    http.json(
      {
        received: true,
        name: file.originalName,
        declared: file.mimeType,
        sniffed: sniffed.contentType,
        size: file.size,
      },
      201,
    );
  }

  /** Always throws, to exercise exception capture. */
  boom(_http: HttpContext): void {
    throw new BoomError("payment declined");
  }

  /** Write to the session so the response carries a real cookie. */
  remember(http: HttpContext): void {
    http.session?.set("status", "saved");
    http.json({ ok: true });
  }

  /** Reflect the signed-in user id back. */
  whoami(http: HttpContext): void {
    http.json({ userId: http.session?.get("user_id") ?? null });
  }

  /** A 422 shaped like a failed API validation. */
  invalid(http: HttpContext): void {
    http.json({ message: "Validation failed", errors: { email: ["is required"] } }, 422);
  }

  /** An Inertia full-page load, as the protocol serialises it. */
  inertiaPage(http: HttpContext): void {
    const page = {
      component: "Posts/Index",
      props: { posts: [{ id: 1, title: "Hello" }], auth: { user: null } },
      url: "/inertia",
      version: "1",
    };
    const json = JSON.stringify(page).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    http.html(
      `<div id="app"></div><script type="application/json" data-page="app">${json}</script>`,
    );
  }
}

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp(
    () => {
      let application: Application;
      try {
        application = currentApp();
      } catch {
        application = Application.create({ env: "test" });
      }
      (
        application.container as unknown as { singleton(token: string, f: () => unknown): void }
      ).singleton("session.driver", () => new CookieDriver(SECRET, "session"));
      application.use([SessionMiddleware]);
      return application;
    },
    () => {
      Router.post("/form", FeatureController, "form");
      Router.put("/form", FeatureController, "form");
      Router.post("/upload", FeatureController, "upload");
      Router.get("/boom", FeatureController, "boom");
      Router.get("/remember", FeatureController, "remember");
      Router.get("/whoami", FeatureController, "whoami");
      Router.post("/invalid", FeatureController, "invalid");
      Router.get("/inertia", FeatureController, "inertiaPage");
    },
  );
});

afterAll(async () => {
  await app.close();
});

afterEach(() => {
  app.actingAsGuest().withExceptionHandling().withoutCookies();
});

// ── Form submits ──────────────────────────────────────────────────────────────

describe("TestApp.postForm()", () => {
  it("sends a urlencoded body a browser would send", async () => {
    const res = await app.postForm("/form", { title: "Hello", published: true });

    res.assertOk();
    res.assertJsonPath("method", "POST");
    res.assertJsonPath("fields.title", "Hello");
    res.assertJsonPath("fields.published", "true");
  });

  it("omits null and undefined fields rather than sending them as strings", async () => {
    const res = await app.postForm("/form", { title: "Hello", subtitle: null });

    expect(res.json<{ fields: Record<string, string> }>().fields).toEqual({ title: "Hello" });
  });

  it("putForm sends the same body with PUT", async () => {
    const res = await app.putForm("/form", { title: "Updated" });
    res.assertJsonPath("method", "PUT");
  });

  it("refuses a file, pointing at multipart()", async () => {
    await expect(
      app.postForm("/form", { avatar: fakeFile.image("a.png") as never }),
    ).rejects.toThrow("multipart()");
  });
});

// ── File uploads ──────────────────────────────────────────────────────────────

describe("TestApp.multipart()", () => {
  it("delivers a file the route can read", async () => {
    const res = await app.multipart("/upload", {
      name: "Alice",
      avatar: fakeFile.image("me.png", { width: 4, height: 4 }),
    });

    res.assertCreated();
    res.assertJsonPath("received", true);
    res.assertJsonPath("name", "me.png");
    res.assertJsonPath("declared", "image/png");
  });

  it("builds files whose bytes match what they claim to be", async () => {
    // The framework sniffs uploads rather than trusting the declared type, so a
    // placeholder of zero bytes would be stored as octet-stream and the test
    // would prove nothing.
    const res = await app.multipart("/upload", { avatar: fakeFile.image("me.png") });
    res.assertJsonPath("sniffed", "image/png");
  });

  it("sniffs a JPEG and a PDF correctly too", async () => {
    const jpeg = await app.multipart("/upload", { avatar: fakeFile.jpeg("photo.jpg") });
    jpeg.assertJsonPath("sniffed", "image/jpeg");

    const pdf = await app.multipart("/upload", { avatar: fakeFile.pdf("terms.pdf") });
    pdf.assertJsonPath("sniffed", "application/pdf");
  });

  it("sends a sized file for exercising limits", async () => {
    const res = await app.multipart("/upload", {
      avatar: fakeFile.sized("big.bin", 4096),
    });
    res.assertJsonPath("size", 4096);
  });

  it("reports no file when none was attached", async () => {
    const res = await app.multipart("/upload", { name: "Alice" });
    res.assertUnprocessable();
  });
});

// ── Exception capture ─────────────────────────────────────────────────────────

describe("TestApp.withoutExceptionHandling()", () => {
  it("hands the original error to the test", async () => {
    const res = await app.withoutExceptionHandling().get("/boom");

    expect(res.exception()).toBeInstanceOf(BoomError);
    expect((res.exception() as BoomError).detail).toBe("payment declined");
  });

  it("quotes the error in a failing assertion rather than the error page", async () => {
    const res = await app.withoutExceptionHandling().get("/boom");

    // This is the whole point: `Expected HTTP 200 but got 500` on its own sends
    // you back to re-run the route by hand.
    expect(() => res.assertOk()).toThrow("payment declined");
  });

  it("captures the error even with normal rendering left on", async () => {
    const res = await app.get("/boom");
    expect(res.exception()).toBeInstanceOf(BoomError);
  });
});

// ── Assertion context ─────────────────────────────────────────────────────────

describe("assertion failures carry context", () => {
  it("includes the response body in a status mismatch", async () => {
    const res = await app.post("/invalid", {});
    expect(() => res.assertOk()).toThrow("is required");
  });

  it("lists the cookies that were set when the expected one is missing", async () => {
    const res = await app.get("/remember");
    expect(() => res.assertCookie("remember_me")).toThrow("session");
  });
});

// ── Sessions through the real driver ──────────────────────────────────────────

describe("session assertions against the shipped CookieDriver", () => {
  it("reads a value the route wrote", async () => {
    const res = await app.get("/remember");
    res.assertSessionHas("status", "saved");
  });

  it("assertSessionMissing does not pass for a key that is present", async () => {
    const res = await app.get("/remember");
    expect(() => res.assertSessionMissing("status")).toThrow("status");
  });

  it("round-trips actingAs through the encrypted cookie", async () => {
    const res = await app.actingAs({ id: 99 }).get("/whoami");

    res.assertJsonPath("userId", 99);
    res.assertAuthenticatedAs(99);
  });

  it("reports a guest as a guest", async () => {
    const res = await app.actingAsGuest().get("/whoami");
    res.assertJsonPath("userId", null);
    res.assertGuest();
  });

  it("merges withSession data alongside the acting user", async () => {
    const res = await app.actingAs({ id: 5 }).withSession({ locale: "fr" }).get("/remember");
    res.assertSessionHas("locale", "fr");
    res.assertAuthenticatedAs(5);
  });
});

// ── Cookies and JSON mode ─────────────────────────────────────────────────────

describe("TestApp — request shaping", () => {
  it("withCookie attaches a cookie to every request", async () => {
    const res = await app.withCookie("theme", "dark").get("/whoami");
    res.assertOk();
  });

  it("asJson sets the Accept header", async () => {
    const res = await app.asJson().post("/invalid", {});
    res.assertUnprocessable().assertInvalid("email");
  });
});

// ── Inertia ───────────────────────────────────────────────────────────────────

describe("TestResponse.assertInertia()", () => {
  it("reads the page object out of a full page load", async () => {
    const res = await app.get("/inertia");

    res.assertInertia("Posts/Index");
    res.assertInertia("Posts/Index", { posts: [{ id: 1, title: "Hello" }] });
    res.assertInertiaProp("auth");
  });

  it("names the component that actually rendered", async () => {
    const res = await app.get("/inertia");
    expect(() => res.assertInertia("Posts/Show")).toThrow("Posts/Index");
  });

  it("lists the props present when one is missing", async () => {
    const res = await app.get("/inertia");
    expect(() => res.assertInertiaProp("missing")).toThrow("posts");
  });

  it("reports a plain response as carrying no page object", async () => {
    const res = await app.get("/whoami");
    expect(res.inertia()).toBeNull();
    expect(() => res.assertInertia()).toThrow("no Inertia page object");
  });
});
