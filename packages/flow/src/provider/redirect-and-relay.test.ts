/**
 * What an action that redirects or touches cookies sends the browser, through the server's own
 * handler.
 *
 * A flash chained onto a redirect (`this.redirect("/").withSuccess("Saved.")`, as the docs teach)
 * was queued and then dropped, because the handler returned the redirect before it sent flashes.
 * And the cookie relay read `Headers.get("Set-Cookie")`, which joins every cookie an action set
 * into one comma-separated value: a browser reads that as one broken cookie.
 */
import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, utimesSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Container } from "@zerotal/core";
import type { MiddlewareClass, HttpContext, NextFn } from "@zerotal/core";
import { Component } from "../Component.ts";
import { expose } from "../decorators.ts";
import { dehydrate } from "../dehydrate.ts";
import { registerPage, _getPageEntries } from "../registry.ts";
import {
  _handleFlowMessage,
  _holdSessionCookies,
  _sessionRelayResponse,
  _sweepTempUploadDir,
} from "./FlowProvider.ts";
import { _holdFlashes, _takeHeldFlashes } from "../client/bridge.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

type Frame = Record<string, unknown>;
type Socket = Parameters<typeof _handleFlowMessage>[0];

class SignInPage extends Component {
  @expose email = "";

  @expose async signIn(): Promise<void> {
    this.redirect("/dashboard", 303).withSuccess("Welcome back.");
  }

  @expose async signInQuietly(): Promise<void> {
    this.redirect("/dashboard");
  }

  override async render() {
    return { html: `<p>${this.email}</p>` };
  }
}

/** Stands in for the session middleware (persistent by name) plus a remember-me cookie. */
class SessionMiddleware {
  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    await next();
    http.response?.headers.append("Set-Cookie", "zt_session=abc; Path=/; HttpOnly; SameSite=Lax");
    http.response?.headers.append("Set-Cookie", "remember=xyz; Path=/; HttpOnly; Max-Age=2592000");
  }
}

async function send(method: string, middleware: MiddlewareClass[] = []): Promise<Frame[]> {
  const page = new SignInPage();
  page._flowId = "sign-in-1";
  page._flowPath = "/sign-in";
  await page.onBoot();
  const snapshot = dehydrate(page, { id: "sign-in-1", name: "SignInPage", path: "/sign-in" });
  const frames: Frame[] = [];
  const ws = {
    data: { origin: "http://localhost", headers: new Headers(), remoteIp: "127.0.0.1" },
    send(message: string): void {
      frames.push(JSON.parse(message) as Frame);
    },
  };
  await _handleFlowMessage(
    ws as unknown as Socket,
    JSON.stringify({
      type: "call",
      component: "sign-in-1",
      method,
      args: [],
      updates: {},
      snapshot,
    }),
    { container: new Container(), globalMiddleware: () => middleware },
  );
  return frames;
}

beforeEach(() => {
  _getPageEntries().delete("SignInPage");
  registerPage("/sign-in", SignInPage);
});

describe("a flash chained onto a redirect", () => {
  it("rides on the redirect frame", async () => {
    const frames = await send("signIn");

    const redirect = frames.find((f) => f["type"] === "redirect");
    expect(redirect?.["url"]).toBe("/dashboard");
    expect(redirect?.["flashes"]).toEqual([
      expect.objectContaining({ message: "Welcome back.", level: "success" }),
    ]);
  });

  it("is absent when the action flashed nothing", async () => {
    const frames = await send("signInQuietly");

    expect(frames.find((f) => f["type"] === "redirect")).not.toHaveProperty("flashes");
  });

  it("is held across the navigation and replayed once", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };

    _holdFlashes(storage, [{ level: "success", message: "Welcome back." }]);

    expect(_takeHeldFlashes(storage)).toEqual([{ level: "success", message: "Welcome back." }]);
    expect(_takeHeldFlashes(storage)).toEqual([]);
  });

  it("holds nothing for an empty or missing list", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };

    _holdFlashes(storage, []);
    _holdFlashes(storage, undefined);

    expect(store.size).toBe(0);
  });
});

describe("the session cookie relay", () => {
  it("relays every cookie an action set, each as its own header", async () => {
    const frames = await send("signIn", [SessionMiddleware as unknown as MiddlewareClass]);
    const token = String(frames.find((f) => f["type"] === "redirect")?.["sessionToken"]);

    const cookies = _sessionRelayResponse(token).headers.getSetCookie();

    expect(cookies).toEqual([
      "zt_session=abc; Path=/; HttpOnly; SameSite=Lax",
      "remember=xyz; Path=/; HttpOnly; Max-Age=2592000",
    ]);
  });

  it("answers a token once", () => {
    const token = _holdSessionCookies(["a=1; Path=/"]);

    expect(_sessionRelayResponse(token).headers.getSetCookie()).toEqual(["a=1; Path=/"]);
    expect(_sessionRelayResponse(token).headers.getSetCookie()).toEqual([]);
  });

  it("answers an unknown token with no cookies", () => {
    const response = _sessionRelayResponse("not-a-token");

    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

describe("the temporary upload sweep", () => {
  it("removes files older than the limit and keeps newer ones", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flow-tmp-"));
    try {
      const old = join(dir, "old.png");
      const fresh = join(dir, "fresh.png");
      writeFileSync(old, "x");
      writeFileSync(fresh, "x");
      const sevenHoursAgo = (Date.now() - 7 * 60 * 60 * 1000) / 1000;
      utimesSync(old, sevenHoursAgo, sevenHoursAgo);

      const removed = await _sweepTempUploadDir(dir, 6 * 60 * 60 * 1000);

      expect(removed).toBe(1);
      expect(existsSync(old)).toBe(false);
      expect(existsSync(fresh)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is nothing to do when the directory does not exist", async () => {
    expect(await _sweepTempUploadDir(join(tmpdir(), "flow-tmp-never-made-xyz"))).toBe(0);
  });
});
