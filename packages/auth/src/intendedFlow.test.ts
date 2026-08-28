/**
 * The documented sign-in flow, end to end, with a real session.
 *
 * `AuthMiddleware` writes `intended_url` and `redirect().intended()` consumes it.
 * Each half already had tests, and each half passed — but both were written against
 * a stubbed session whose `regenerate()` is a no-op, so neither could observe what
 * happens *between* them: `Auth.login()` issues a fresh session ID before elevating
 * privileges, and whether the data bag survives that is the whole question.
 *
 * A pair that is only ever tested apart is a pair nothing is checking. This runs the
 * three steps in order against a `SessionManager` — guest is intercepted, credentials
 * are accepted, the redirect lands — because that sequence is what the docs tell
 * people to write.
 */
import { describe, it, expect } from "bun:test";
import { Container, HttpContext, RequestContext, ScopedResolver, redirect } from "@zerotal/core";
import { SessionManager } from "@zerotal/session";
import { AuthMiddleware } from "./AuthMiddleware.ts";

/** A driver that persists nowhere — the manager's data bag is what is under test. */
const nowhere = {
  loadFromRequest: async () => ({ id: "s1", data: {} }),
  saveSession: async () => {},
  destroySession: async () => {},
};

/** A request context carrying a real session, as `SessionMiddleware` would attach one. */
function contextFor(url: string, session: SessionManager): HttpContext {
  const ctx = new HttpContext(new Request(url), new ScopedResolver(new Container()));
  (ctx as unknown as { session: SessionManager }).session = session;
  return ctx;
}

function newSession(): SessionManager {
  return new SessionManager("s1", {}, nowhere as never);
}

describe("AuthMiddleware and redirect().intended() as a pair", () => {
  it("sends a signed-in user back to the page they were trying to reach", async () => {
    const session = newSession();

    // 1. A guest asks for a protected page. The middleware records where they were
    //    headed and sends them to the login form.
    const guest = contextFor("http://localhost/trips/42/edit", session);
    const response = await new AuthMiddleware().handle(guest, async () => undefined);
    expect((response as Response | undefined)?.status ?? guest.response?.status).toBe(302);
    expect(session.get("intended_url")).toBe("http://localhost/trips/42/edit");

    // 2. They post credentials. `Auth.login()` rotates the session ID before
    //    elevating privileges — the step the isolated tests could not exercise.
    const before = session.id();
    session.regenerate();
    expect(session.id()).not.toBe(before);

    // 3. The login controller redirects them onward.
    const login = contextFor("http://localhost/login", session);
    RequestContext.run(login, () => redirect().intended("/dashboard"));

    expect(login.response?.headers.get("Location")).toBe("http://localhost/trips/42/edit");
    expect(login.response?.status).toBe(302);
  });

  it("survives the session ID rotation that login performs", () => {
    const session = newSession();
    session.set("intended_url", "http://localhost/invoices");
    session.regenerate();
    // The defence against session fixation is a new ID, not a new bag. If this ever
    // becomes false, the flow above breaks silently — the sign-in works and the
    // destination is quietly wrong.
    expect(session.get("intended_url")).toBe("http://localhost/invoices");
  });

  it("spends the intended URL, so a later navigation cannot be hijacked by it", () => {
    const session = newSession();
    session.set("intended_url", "http://localhost/trips/42/edit");

    const first = contextFor("http://localhost/login", session);
    RequestContext.run(first, () => redirect().intended("/dashboard"));
    expect(first.response?.headers.get("Location")).toBe("http://localhost/trips/42/edit");

    const second = contextFor("http://localhost/login", session);
    RequestContext.run(second, () => redirect().intended("/dashboard"));
    expect(second.response?.headers.get("Location")).toBe("/dashboard");
  });

  it("refuses a stored URL from another origin", () => {
    const session = newSession();
    // Nothing in the framework writes this, but a session store is not a trust
    // boundary — an open redirect out of a login form is worth closing here.
    session.set("intended_url", "https://evil.test/collect");

    const login = contextFor("http://localhost/login", session);
    RequestContext.run(login, () => redirect().intended("/dashboard"));
    expect(login.response?.headers.get("Location")).toBe("/dashboard");
  });

  it("answers an API client with 401 rather than storing an intended URL", async () => {
    const session = newSession();
    const ctx = new HttpContext(
      new Request("http://localhost/api/trips", { headers: { Accept: "application/json" } }),
      new ScopedResolver(new Container()),
    );
    (ctx as unknown as { session: SessionManager }).session = session;

    const response = (await new AuthMiddleware().handle(ctx, async () => undefined)) as Response;
    expect(response.status).toBe(401);
    // A JSON client has no login form to come back from; a stored URL would only
    // wait to misdirect whoever signs in on that session next.
    expect(session.get("intended_url")).toBeUndefined();
  });
});
