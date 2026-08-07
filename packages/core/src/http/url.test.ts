import { describe, it, expect, beforeEach, afterEach, beforeAll } from "bun:test";
import { url, Url, UrlKeyMissingError } from "./url.ts";
import { URLSigner } from "../crypt/URLSigner.ts";
import { HttpContext } from "../pipeline/HttpContext.ts";
import { RequestContext } from "../context/RequestContext.ts";
import { Router } from "../router/Router.ts";

function makeCtx(u = "http://localhost/", init: RequestInit = {}): HttpContext {
  return HttpContext.fake(u, init);
}
function inRequest<T>(ctx: HttpContext, fn: () => T): T {
  return RequestContext.run(ctx, fn);
}

describe("url(path)", () => {
  const prev = Bun.env.APP_URL;
  beforeEach(() => {
    Bun.env.APP_URL = "https://app.test";
  });
  afterEach(() => {
    if (prev === undefined) delete Bun.env.APP_URL;
    else Bun.env.APP_URL = prev;
  });

  it("generates a fully-qualified URL", () => {
    expect(url("user/profile")).toBe("https://app.test/user/profile");
  });

  it("appends extra path segments", () => {
    expect(url("user/profile", [1])).toBe("https://app.test/user/profile/1");
    expect(url("posts", [42, "edit"])).toBe("https://app.test/posts/42/edit");
  });

  it("normalises leading/trailing slashes on the path", () => {
    expect(url("/user/profile/")).toBe("https://app.test/user/profile");
  });

  it("leaves an already-absolute URL absolute", () => {
    expect(url("https://other.test/x")).toBe("https://other.test/x");
  });

  it("secure() forces https", () => {
    Bun.env.APP_URL = "http://app.test";
    expect(url().secure("pay")).toBe("https://app.test/pay");
  });
});

describe("url() — UrlGenerator", () => {
  const prev = Bun.env.APP_URL;
  beforeEach(() => {
    Bun.env.APP_URL = "https://app.test";
    Router.reset();
    Router.get("/posts/:id", () => {}).name("posts.show");
  });
  afterEach(() => {
    if (prev === undefined) delete Bun.env.APP_URL;
    else Bun.env.APP_URL = prev;
  });

  it("current() returns the URL without the query string", () => {
    const ctx = makeCtx("http://localhost/dashboard?tab=2");
    expect(inRequest(ctx, () => url().current())).toBe("http://localhost/dashboard");
  });

  it("full() returns the URL with the query string", () => {
    const ctx = makeCtx("http://localhost/dashboard?tab=2");
    expect(inRequest(ctx, () => url().full())).toBe("http://localhost/dashboard?tab=2");
  });

  it("previous() returns the Referer, or a fallback", () => {
    const withRef = makeCtx("http://localhost/x", {
      headers: { Referer: "http://localhost/prev" },
    });
    expect(inRequest(withRef, () => url().previous())).toBe("http://localhost/prev");

    const noRef = makeCtx("http://localhost/x");
    expect(inRequest(noRef, () => url().previous("/home"))).toBe("https://app.test/home");
  });

  it("to() and route() build fully-qualified URLs", () => {
    expect(url().to("posts", [42])).toBe("https://app.test/posts/42");
    expect(url().route("posts.show", { id: 42 })).toBe("https://app.test/posts/42");
  });

  it("query() appends a query string", () => {
    expect(url().query("search", { q: "zerotal", page: 2 })).toBe(
      "https://app.test/search?q=zerotal&page=2",
    );
  });

  it("intended() returns a string — stored intended_url, then the fallback", () => {
    const stored = makeCtx();
    (stored as unknown as Record<string, unknown>)["session"] = {
      get: (k: string) => (k === "intended_url" ? "http://localhost/profile" : undefined),
      forget: () => {},
    };
    const out = inRequest(stored, () => url().intended("/dashboard"));
    expect(out).toBe("http://localhost/profile");
    expect(typeof out).toBe("string");

    const empty = makeCtx();
    (empty as unknown as Record<string, unknown>)["session"] = {
      get: () => undefined,
      forget: () => {},
    };
    expect(inRequest(empty, () => url().intended("/dashboard"))).toBe("/dashboard");
  });
});

// ── Url — signed links (generation + signing share one facade) ──────────────────

describe("Url.sign / verify", () => {
  beforeAll(() => Url.setSecret("url-facade-secret-key"));

  it("round-trips a signed URL via the configured secret", () => {
    const link = Url.sign("https://example.com/verify", { email: "u@x.com" }, 15);
    expect(Url.verify(link)).toBe(true);
  });

  it("verify() is false for a link signed with a different secret", () => {
    const other = new URLSigner("a-completely-different-secret");
    const link = other.sign("https://example.com/verify");
    expect(Url.verify(link)).toBe(false);
  });

  it("setSecret() swaps the signing key", () => {
    const link = Url.sign("https://example.com/v");
    Url.setSecret("rotated-secret");
    expect(Url.verify(link)).toBe(false);
    Url.setSecret("url-facade-secret-key"); // restore
    expect(Url.verify(link)).toBe(true);
  });

  it("url() exposes the same signing facade", () => {
    const link = url().sign("https://example.com/v", { t: "1" });
    expect(url().verify(link)).toBe(true);
  });
});

describe("UrlKeyMissingError", () => {
  it("has the E_URL_NO_KEY code", () => {
    expect(new UrlKeyMissingError().code).toBe("E_URL_NO_KEY");
  });
});
