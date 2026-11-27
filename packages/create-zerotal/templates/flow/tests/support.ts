/**
 * What the feature tests share: one booted app per file, a browser that keeps its cookies
 * between requests for the flows that take more than one, and the check that a response is
 * the page a test expects.
 */
import { config } from "zerotal";
import {
  createTestApp,
  migrateDatabase,
  type HtmlDocument,
  type TestApp,
  type TestResponse,
} from "zerotal/testing";
import { titled } from "../app/flow/lib/page";

/** Boot the app from its own bootstrap, against a fresh in-memory database. */
export async function bootApp(): Promise<TestApp> {
  // Sessions and signed links need a key; `??=` leaves a real one from .env alone.
  Bun.env.APP_KEY ??= "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  // Each run gets its own throwaway schema rather than the dev database.
  Bun.env.ZT_DB_URL ??= ":memory:";
  const app = await createTestApp(() => import("../bootstrap/app.ts").then((m) => m.default));
  // The real migrations — synchronize is off, so these are the only thing that builds
  // the schema, and the schema under test is the one that ships.
  await migrateDatabase();
  sendFormTokens(app);
  return app;
}

/** The anti-forgery token a test's own form posts carry. */
export const CSRF_TOKEN = "test-csrf-token";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Send the anti-forgery token with every POST, PUT, PATCH and DELETE, as the app's pages do.
 *
 * bootstrap/app.ts turns CSRF protection on, so a request without the session's token is
 * refused with a 419. Every form on a page carries it in a hidden `_token` field. A test that
 * posts straight to a handler has no page to take it from, so the session starts with a known
 * token and the request sends it back. A request that brings its own cookies (the `Browser`
 * below) or its own token is left alone, and tests/csrf.test.ts checks what happens without one.
 */
export function sendFormTokens(app: TestApp): void {
  const request = app.request.bind(app);
  app.request = (url, init = {}) => {
    const headers = { ...(init.headers as Record<string, string> | undefined) };
    const names = Object.keys(headers).map((name) => name.toLowerCase());
    const own = ["cookie", "x-csrf-token", "x-xsrf-token"].some((name) => names.includes(name));
    if (!UNSAFE_METHODS.has((init.method ?? "GET").toUpperCase()) || own) {
      return request(url, init);
    }
    app.withSession({ _csrf_token: CSRF_TOKEN });
    return request(url, { ...init, headers: { ...headers, "X-CSRF-TOKEN": CSRF_TOKEN } });
  };
}

/**
 * The response is the page with this title — "Sign in" for "Sign in — Acme" — and the page,
 * to read the rest of: `assertPage(res, "Projects").getByRole("link", { name: "New project" })`.
 *
 * A Flow page reaches a test as finished HTML, not as a component and its props, so a test
 * reads it the way a visitor does: the title, the text, a field by its label, a button by its
 * name. See "Reading the page" in the testing docs for the rest of what `res.html()` asks.
 */
export function assertPage(res: TestResponse, title: string): HtmlDocument {
  return res.assertOk().html().assertTitle(titled(title)());
}

/**
 * A browser for one test: sends the cookies earlier responses set, as a real one does.
 *
 * `app.actingAs(user)` is the quick way to be signed in for a single request. A flow
 * whose later steps depend on what the earlier ones stored in the session — sign in,
 * then the two-factor code; set two-factor up, then confirm it — needs this instead.
 */
export class Browser {
  private readonly jar = new Map<string, string>();

  constructor(private readonly app: TestApp) {
    app.actingAsGuest().withoutCookies();
  }

  get(url: string): Promise<TestResponse> {
    return this.send(url, { method: "GET" });
  }

  /**
   * A form post, as a browser sends one without JavaScript: with the `_token` field every form
   * on a page carries.
   */
  post(url: string, body: Record<string, unknown> = {}): Promise<TestResponse> {
    return this.form("POST", url, body);
  }

  put(url: string, body: Record<string, unknown> = {}): Promise<TestResponse> {
    return this.form("PUT", url, body);
  }

  patch(url: string, body: Record<string, unknown> = {}): Promise<TestResponse> {
    return this.form("PATCH", url, body);
  }

  delete(url: string, body: Record<string, unknown> = {}): Promise<TestResponse> {
    return this.form("DELETE", url, body);
  }

  /** A JSON request, as the passkey ceremonies make: the token goes in a header. */
  async json(url: string, body: unknown = {}): Promise<TestResponse> {
    return this.send(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-XSRF-TOKEN": await this.token(),
      },
      body: JSON.stringify(body),
    });
  }

  /**
   * This session's anti-forgery token, from the `XSRF-TOKEN` cookie every response sets. A
   * browser that has loaded no page yet loads one first, as a visitor would before posting.
   */
  async token(): Promise<string> {
    if (!this.jar.has("XSRF-TOKEN")) await this.get("/");
    return decodeURIComponent(this.jar.get("XSRF-TOKEN") ?? "");
  }

  /** The session cookie's value, to replay it from somewhere else. */
  sessionCookie(): string | undefined {
    return this.jar.get(String(config("session.cookie")));
  }

  private async form(
    method: string,
    url: string,
    body: Record<string, unknown>,
  ): Promise<TestResponse> {
    const params = new URLSearchParams({ _token: await this.token() });
    for (const [key, value] of Object.entries(body)) params.set(key, String(value));
    return this.send(url, {
      method,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  }

  private async send(
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
  ) {
    const cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join("; ");
    const res = await this.app.request(url, {
      ...init,
      headers: { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) },
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = attributes.some((a) => /^\s*max-age=0\s*$/i.test(a));
      if (expired || value === "") this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return res;
  }
}
