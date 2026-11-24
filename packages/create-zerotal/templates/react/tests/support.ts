/**
 * What the feature tests share: one booted app per file, and a browser that keeps its
 * cookies between requests for the flows that take more than one.
 */
import { config } from "zerotal";
import { createTestApp, migrateDatabase, type TestApp, type TestResponse } from "zerotal/testing";

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
  return app;
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

  /** A form post, as a browser sends one without JavaScript. */
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

  /** A JSON request, as the passkey ceremonies make. */
  json(url: string, body: unknown = {}): Promise<TestResponse> {
    return this.send(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  }

  /** The session cookie's value, to replay it from somewhere else. */
  sessionCookie(): string | undefined {
    return this.jar.get(String(config("session.cookie")));
  }

  private form(method: string, url: string, body: Record<string, unknown>): Promise<TestResponse> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) params.set(key, String(value));
    return this.send(url, {
      method,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  }

  private async send(url: string, init: { method: string; headers?: Record<string, string>; body?: string }) {
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
