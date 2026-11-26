/**
 * A failed form leaves its errors and input for the next page only, and never a password.
 *
 * The validator and the exception handler wrote `errors` and `old` with `session.set`,
 * so they stayed until some later `validate()` passed. Every Inertia page after one
 * failure carried the stale `errors` prop (the starters' fresh two-factor setup screen
 * opened showing "That code did not match"), and `old` carried the submitted body as it
 * was: a change-password form that failed on its confirmation put the user's current
 * password, in plain text, into every later page's HTML. A JSON 422, which answers the
 * form where it is, left both behind for whatever page came next.
 *
 * Driven over real requests with a real session cookie, because the defect is in what
 * one request leaves for the next.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Application, Router, currentApp } from "@zerotal/core";
import type { HttpContext } from "@zerotal/core";
import { ValidationError } from "@zerotal/core/errors";
import { CookieDriver, SessionMiddleware } from "@zerotal/session";
import { createTestApp, type TestApp } from "./TestApp.ts";
import type { TestResponse } from "./TestResponse.ts";

const SECRET = "validation-session-secret-aaaaaaaaaaaaaaaa";

/** What a starter's `rejectInput()` does: set the errors, throw the redirect by name. */
function rejectInput(http: HttpContext, errors: Record<string, string>, json: boolean): never {
  http.session?.set("errors", errors);
  throw Object.assign(new Error("Validation failed"), {
    name: json ? "ValidationJsonError" : "ValidationRedirectError",
    redirectTo: "/state",
    errors,
  });
}

class FormController {
  async changePassword(http: HttpContext): Promise<void> {
    await http.body();
    throw new ValidationError("Check the form", {
      password_confirmation: ["The confirmation does not match."],
    });
  }

  rejectHere(http: HttpContext): void {
    rejectInput(http, { code: "That code did not match." }, false);
  }

  rejectJson(http: HttpContext): void {
    rejectInput(http, { password: "That password is not correct." }, true);
  }

  state(http: HttpContext): void {
    http.json({
      errors: http.session?.get("errors") ?? null,
      old: http.session?.get("old") ?? null,
    });
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
      Router.post("/settings/password", FormController, "changePassword");
      Router.post("/two-factor/confirm", FormController, "rejectHere");
      Router.post("/delete-account", FormController, "rejectJson");
      Router.get("/state", FormController, "state");
    },
  );
});

afterAll(async () => {
  await app.close();
});

/** Carry the session cookie a response set into the next request, as a browser does. */
function carry(res: TestResponse): void {
  const cookie = res.headers.get("Set-Cookie");
  if (cookie) app.withCookie("session", cookie.split(";")[0]!.slice("session=".length));
}

async function state(): Promise<{ errors: unknown; old: unknown }> {
  const res = await app.get("/state");
  carry(res);
  return res.json() as { errors: unknown; old: unknown };
}

describe("errors and old input after a failed form", () => {
  it("reach the page the form returns to, without the passwords, and are gone after it", async () => {
    app.withoutCookies();
    const failed = await app.postForm(
      "/settings/password",
      {
        current_password: "correct horse battery staple",
        password: "new-secret-1",
        password_confirmation: "new-secret-2",
        name: "Ada",
      },
      { Accept: "text/html", Referer: `${app.baseUrl}/settings/password` },
    );
    failed.assertStatus(303);
    carry(failed);

    const shown = await state();
    expect(shown.errors).toEqual({ password_confirmation: "The confirmation does not match." });
    expect(shown.old).toEqual({ name: "Ada" });

    expect(await state()).toEqual({ errors: null, old: null });
  });

  it("set by hand before a redirect, last for one page too", async () => {
    app.withoutCookies();
    const failed = await app.postForm(
      "/two-factor/confirm",
      { code: "000000" },
      {
        Accept: "text/html",
      },
    );
    failed.assertStatus(303);
    carry(failed);

    expect((await state()).errors).toEqual({ code: "That code did not match." });
    expect((await state()).errors).toBeNull();
  });

  it("are not left behind by a JSON 422, which answers the form where it is", async () => {
    app.withoutCookies();
    const failed = await app.post(
      "/delete-account",
      { password: "wrong" },
      {
        Accept: "application/json",
      },
    );
    failed.assertStatus(422);
    failed.assertJsonPath("errors.password", "That password is not correct.");
    carry(failed);

    expect(await state()).toEqual({ errors: null, old: null });
  });
});
