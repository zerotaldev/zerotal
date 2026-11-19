/**
 * The cookie helpers every session driver, CSRF and "remember me" go through.
 *
 * Bun 1.4 changed how `Bun.Cookie` writes `Expires`. The framework never asks it to: lifetimes
 * go out as `Max-Age`, assembled here, so the header an app sends is the same on every Bun.
 * Reading goes through Bun's `request.cookies` when the server provides it, and these pin that
 * it agrees with the header fallback on the values the framework writes.
 */
import { describe, it, expect, afterAll } from "bun:test";
import { buildCookie, parseCookieHeader, readCookie } from "./cookie.ts";

describe("buildCookie", () => {
  it("writes the lifetime as Max-Age and never as Expires", () => {
    const header = buildCookie({ name: "session", value: "abc", maxAge: 86400, secure: true });

    expect(header).toBe("session=abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400; Secure");
    expect(header).not.toContain("Expires");
  });

  it("clears with Max-Age=0", () => {
    expect(buildCookie({ name: "session", value: "", maxAge: 0 })).toBe(
      "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
  });

  it("writes a session cookie with no lifetime at all", () => {
    const header = buildCookie({ name: "XSRF-TOKEN", value: "t", httpOnly: false });

    expect(header).toBe("XSRF-TOKEN=t; Path=/; SameSite=Lax");
  });
});

describe("readCookie", () => {
  // The shapes the framework writes: an encrypted session (base64url with dots), a padded
  // base64 value, and a plain token.
  const values = {
    session: "eyJpdiI6IkFCQyJ9.c2lnbmF0dXJl-_x",
    padded: "YWJjZA==",
    token: "0123456789abcdef",
  };
  const cookieHeader = Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");

  const server = Bun.serve({
    port: 0,
    routes: {
      "/read": (req) =>
        Response.json({
          native: Object.fromEntries(
            Object.keys(values).map((name) => [name, readCookie(req, name) ?? null]),
          ),
          hasNativeMap: (req as { cookies?: unknown }).cookies !== undefined,
        }),
    },
    fetch: () => new Response("not found", { status: 404 }),
  });
  afterAll(() => {
    server.stop(true);
  });

  it("reads the same values off Bun's cookie map as off the Cookie header", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/read`, {
      headers: { Cookie: cookieHeader },
    });
    const body = (await res.json()) as { native: Record<string, string>; hasNativeMap: boolean };

    expect(body.hasNativeMap).toBe(true);
    expect(body.native).toEqual(values);
    for (const [name, value] of Object.entries(values)) {
      expect(parseCookieHeader(cookieHeader, name)).toBe(value);
    }
  });

  it("falls back to the Cookie header on a request Bun did not serve", () => {
    const req = new Request("http://localhost/", { headers: { Cookie: cookieHeader } });

    expect(readCookie(req, "session")).toBe(values.session);
    expect(readCookie(req, "missing")).toBeUndefined();
  });
});
