import { describe, it, expect, beforeEach } from "bun:test";
import { HttpContext } from "../pipeline/HttpContext.ts";
import { RequestContext } from "../context/RequestContext.ts";
import {
  ResponseBuilder,
  MarkdownBuilder,
  redirect,
  redirectTo,
  json,
  view,
  html,
  abort,
} from "./response.ts";
import { HttpError, UnauthorizedError, ForbiddenError } from "../errors/HttpError.ts";
import { Router } from "../router/Router.ts";

function makeCtx(url = "http://localhost/", init: RequestInit = {}): HttpContext {
  return HttpContext.fake(url, init);
}

function inRequest<T>(ctx: HttpContext, fn: () => T): T {
  return RequestContext.run(ctx, fn);
}

describe("ResponseBuilder", () => {
  it("flash helpers forward to ctx.flash", () => {
    const ctx = makeCtx();
    const builder = new ResponseBuilder(ctx);
    expect(builder.with("key", "value")).toBe(builder);
    expect(builder.withErrors({ email: "required" })).toBe(builder);
    expect(builder.withSuccess("Saved!")).toBe(builder);
    expect(builder.withError("Oops")).toBe(builder);
    expect(builder.withWarning("Watch out")).toBe(builder);
    expect(builder.withInfo("FYI")).toBe(builder);
  });
  it("is PromiseLike<void> — then() resolves to undefined", async () => {
    const ctx = makeCtx();
    const builder = new ResponseBuilder(ctx);
    const result = await Promise.resolve(builder);
    expect(result).toBeUndefined();
  });
});

describe("redirect().back()", () => {
  it("redirects to Referer when present", () => {
    const ctx = makeCtx("http://localhost/", { headers: { Referer: "http://localhost/posts" } });
    inRequest(ctx, () => redirect().back());
    expect(ctx.response?.status).toBe(302);
    expect(ctx.response?.headers.get("Location")).toBe("http://localhost/posts");
  });
  it("falls back to / when no Referer", () => {
    const ctx = makeCtx();
    inRequest(ctx, () => redirect().back());
    expect(ctx.response?.headers.get("Location")).toBe("/");
  });
  it("respects custom status", () => {
    const ctx = makeCtx("http://localhost/", { headers: { Referer: "http://localhost/form" } });
    inRequest(ctx, () => redirect().back(303));
    expect(ctx.response?.status).toBe(303);
  });
  it("returns a ResponseBuilder for chaining", () => {
    const ctx = makeCtx();
    const result = inRequest(ctx, () => redirect().back());
    expect(result).toBeInstanceOf(ResponseBuilder);
  });
  it("throws outside a request context", () => {
    expect(() => redirect().back()).toThrow("[Zerotal] Response helpers");
  });
});

describe("redirect()", () => {
  it("sets the Location header", () => {
    const ctx = makeCtx();
    inRequest(ctx, () => redirect("/dashboard"));
    expect(ctx.response?.headers.get("Location")).toBe("/dashboard");
    expect(ctx.response?.status).toBe(302);
  });
  it("respects a custom status", () => {
    const ctx = makeCtx();
    inRequest(ctx, () => redirect("/login", 301));
    expect(ctx.response?.status).toBe(301);
  });
  it("returns ResponseBuilder — supports chaining", () => {
    const ctx = makeCtx();
    const result = inRequest(ctx, () => redirect("/dashboard").with("notice", "ok"));
    expect(result).toBeInstanceOf(ResponseBuilder);
  });
});

describe("redirectTo()", () => {
  beforeEach(() => {
    Router.reset();
    Router.get("/posts/:id", () => {}).name("posts.show");
  });
  it("resolves named route and redirects", () => {
    const ctx = makeCtx();
    inRequest(ctx, () => redirectTo("posts.show", { id: 42 }));
    expect(ctx.response?.headers.get("Location")).toBe("/posts/42");
  });
  it("throws when named route is not registered", () => {
    const ctx = makeCtx();
    expect(() => inRequest(ctx, () => redirectTo("unknown.route"))).toThrow();
  });
});

describe("redirect() — unified builder", () => {
  beforeEach(() => {
    Router.reset();
    Router.get("/u/:username", () => {}).name("profile");
  });

  it("redirect(url, status).withError() — direct form still works", () => {
    const ctx = makeCtx();
    const result = inRequest(ctx, () =>
      redirect("/login", 302).withError("Please log in to continue."),
    );
    expect(ctx.response?.headers.get("Location")).toBe("/login");
    expect(ctx.response?.status).toBe(302);
    expect(result).toBeInstanceOf(ResponseBuilder);
  });

  it("redirect().back().withErrors() sets Referer redirect", () => {
    const ctx = makeCtx("http://localhost/x", {
      headers: { Referer: "http://localhost/previous" },
    });
    const result = inRequest(ctx, () =>
      redirect().back().withErrors({ email: "Invalid email or password." }),
    );
    expect(ctx.response?.headers.get("Location")).toBe("http://localhost/previous");
    expect(result).toBeInstanceOf(ResponseBuilder);
  });

  it("redirect().to(name, params) resolves a named route", () => {
    const ctx = makeCtx();
    const result = inRequest(ctx, () =>
      redirect().to("profile", { username: "alice" }).withSuccess("Profile updated."),
    );
    expect(ctx.response?.headers.get("Location")).toBe("/u/alice");
    expect(result).toBeInstanceOf(ResponseBuilder);
  });

  it("redirect().intended(fallback) falls back when nothing stored", () => {
    const ctx = makeCtx();
    inRequest(ctx, () => redirect().intended("/home").withInfo("Please log in to continue."));
    expect(ctx.response?.headers.get("Location")).toBe("/home");
  });

  it("redirect().away(url) redirects to a raw URL", () => {
    const ctx = makeCtx();
    inRequest(ctx, () => redirect().away("/dashboard", 303));
    expect(ctx.response?.headers.get("Location")).toBe("/dashboard");
    expect(ctx.response?.status).toBe(303);
  });
});

describe("json()", () => {
  it("sets a JSON response", () => {
    const ctx = makeCtx();
    inRequest(ctx, () => json({ ok: true }));
    expect(ctx.response?.status).toBe(200);
    expect(ctx.response?.headers.get("Content-Type")).toContain("application/json");
  });
  it("respects a custom status", () => {
    const ctx = makeCtx();
    inRequest(ctx, () => json({ error: "bad" }, 422));
    expect(ctx.response?.status).toBe(422);
  });
});

describe("view()", () => {
  it("sets an HTML response with DOCTYPE", async () => {
    const ctx = makeCtx();
    inRequest(ctx, () => view("<html><body>hello</body></html>"));
    expect(ctx.response?.status).toBe(200);
    expect(ctx.response?.headers.get("Content-Type")).toContain("text/html");
    const text = await ctx.response?.text();
    expect(text).toStartWith("<!DOCTYPE html>");
  });
});

describe("html()", () => {
  it("sets an HTML response without DOCTYPE", async () => {
    const ctx = makeCtx();
    inRequest(ctx, () => html("<p>Fragment</p>"));
    const text = await ctx.response?.text();
    expect(text).toBe("<p>Fragment</p>");
  });
});

describe("abort()", () => {
  it("abort(message) throws a 500 HttpError", () => {
    expect(() => abort("Something went wrong")).toThrow(HttpError);
    try {
      abort("Something went wrong");
    } catch (e) {
      expect((e as HttpError).status).toBe(500);
      expect((e as HttpError).message).toBe("Something went wrong");
    }
  });
  it("abort(status, message) throws HttpError with that status", () => {
    try {
      abort(400, "Bad input");
    } catch (e) {
      expect((e as HttpError).status).toBe(400);
      expect((e as HttpError).message).toBe("Bad input");
    }
  });
  it("abort(ErrorClass) throws an instance of that class", () => {
    expect(() => abort(UnauthorizedError)).toThrow(UnauthorizedError);
    expect(() => abort(ForbiddenError)).toThrow(ForbiddenError);
  });
  it('abort(status) without message defaults to "Aborted"', () => {
    try {
      abort(503);
    } catch (e) {
      expect((e as HttpError).status).toBe(503);
      expect((e as HttpError).message).toBe("Aborted");
    }
  });
});

describe("redirect().intended()", () => {
  it("redirects to stored intended_url and forgets it", () => {
    const ctx = makeCtx();
    let forgotKey: string | undefined;
    (ctx as unknown as Record<string, unknown>)["session"] = {
      get: (k: string) => (k === "intended_url" ? "http://localhost/dashboard" : undefined),
      forget: (k: string) => {
        forgotKey = k;
      },
    };
    inRequest(ctx, () => redirect().intended("/fallback"));
    expect(ctx.response?.headers.get("Location")).toBe("http://localhost/dashboard");
    expect(forgotKey).toBe("intended_url");
  });
  it("falls back to the default when no intended_url in session", () => {
    const ctx = makeCtx();
    (ctx as unknown as Record<string, unknown>)["session"] = {
      get: () => undefined,
      forget: () => {},
    };
    inRequest(ctx, () => redirect().intended("/home"));
    expect(ctx.response?.headers.get("Location")).toBe("/home");
  });
  it('falls back to "/" when no session and no argument', () => {
    const ctx = makeCtx();
    inRequest(ctx, () => redirect().intended());
    expect(ctx.response?.headers.get("Location")).toBe("/");
  });
});

describe("MarkdownBuilder", () => {
  it("is PromiseLike<void> — then() resolves to undefined", async () => {
    const builder = new MarkdownBuilder("# Hello", {}, 200);
    const result = await Promise.resolve(builder);
    expect(result).toBeUndefined();
  });
  it("withLayout() throws outside a request context", () => {
    const builder = new MarkdownBuilder("# Hello", {}, 200);
    expect(() => builder.withLayout((p) => `<html>${p.content}</html>`, {})).toThrow("[Zerotal]");
  });
});

// ── markdown() helper ─────────────────────────────────────────────────────────

import { markdown, file } from "./response.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, rm } from "node:fs/promises";

describe("markdown() helper", () => {
  it("sets ctx.response to text/html", () => {
    const ctx = makeCtx();
    inRequest(ctx, () => markdown("# Hello"));
    expect(ctx.response?.headers.get("Content-Type")).toContain("text/html");
  });

  it("returns a MarkdownBuilder", () => {
    const ctx = makeCtx();
    const builder = inRequest(ctx, () => markdown("# Test", {}, 200));
    expect(builder).toBeInstanceOf(MarkdownBuilder);
  });

  it("uses the provided status code", () => {
    const ctx = makeCtx();
    inRequest(ctx, () => markdown("# Gone", {}, 410));
    expect(ctx.response?.status).toBe(410);
  });
});

// ── file() helper ─────────────────────────────────────────────────────────────

describe("file() helper", () => {
  it("sets ctx.response with Content-Disposition: attachment", async () => {
    const tmp = join(tmpdir(), `reno-file-${Date.now()}.txt`);
    await writeFile(tmp, "hello file");
    const ctx = makeCtx();
    await inRequest(ctx, () => file(tmp));
    expect(ctx.response?.headers.get("Content-Disposition")).toContain("attachment");
    expect(ctx.response?.headers.get("Content-Disposition")).toContain(
      tmp.replace(/\\/g, "/").split("/").pop()!,
    );
    await rm(tmp, { force: true });
  });

  it("respects custom filename and inline disposition", async () => {
    const tmp = join(tmpdir(), `reno-file2-${Date.now()}.txt`);
    await writeFile(tmp, "inline content");
    const ctx = makeCtx();
    await inRequest(ctx, () => file(tmp, { filename: "custom.txt", disposition: "inline" }));
    const disp = ctx.response?.headers.get("Content-Disposition") ?? "";
    expect(disp).toContain("inline");
    expect(disp).toContain("custom.txt");
    await rm(tmp, { force: true });
  });

  it("throws NotFoundError when the file does not exist", async () => {
    const ctx = makeCtx();
    await expect(inRequest(ctx, () => file("/no/such/file.txt"))).rejects.toThrow("File not found");
  });
});
