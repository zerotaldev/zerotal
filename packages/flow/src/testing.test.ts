/**
 * `FlowTest` drives the server's own pipeline, so a test fails where production would.
 *
 * Each case below passed against the in-process copy `FlowTest` used to run, and was wrong:
 * the copy kept one instance alive, called any method, ran no middleware, opened no request
 * scope, and turned a render that threw into empty markup.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { RequestContext, type HttpContext, type NextFn } from "@zerotal/core";
import { Component } from "./Component.ts";
import { expose, locked, reactive, url } from "./decorators.ts";
import { flowRoute } from "./router.ts";
import { FlowTest } from "./testing.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

class NotePage extends Component {
  @expose title = "";
  /** Not state: nothing carries it from one request to the next. */
  draft = "";
  @locked owner = "";

  @expose async write(): Promise<void> {
    this.draft = "typed";
    this.title = "saved";
  }

  /** A helper the page uses itself. The browser may not call it. */
  async purge(): Promise<void> {
    this.title = "purged";
  }

  @expose async whoAmI(): Promise<void> {
    const user = (RequestContext.tryGet() as { user?: { id: unknown } } | undefined)?.user;
    this.title = user ? `user ${String(user.id)}` : "guest";
  }

  override async render(): Promise<HtmlNode> {
    return { html: `<p>title:${this.title} draft:${this.draft}</p>` };
  }
}

describe("state between actions", () => {
  it("rebuilds the page from its snapshot, so an undecorated field is gone on the next action", async () => {
    const t = await FlowTest.mount(NotePage);
    await t.call("write");

    // The action's own render saw the value it set…
    t.assertSee("draft:typed");
    // …but the page the next action starts from holds only what the snapshot carried.
    expect(t.page().title).toBe("saved");
    expect(t.page().draft).toBe("");

    await t.render();
    t.assertSee("title:saved").assertSee("draft:</p>");
  });

  it("hands back a new instance after every action, as the server builds one per request", async () => {
    const t = await FlowTest.mount(NotePage);
    const before = t.page();
    await t.call("write");
    expect(t.page()).not.toBe(before);
  });

  it("refuses to set() a field the snapshot does not carry", async () => {
    const t = await FlowTest.mount(NotePage);
    await expect(t.set("draft", "x")).rejects.toThrow(
      /"draft" on NotePage is not part of its snapshot/,
    );
  });

  it("sets @locked state as setup, which update() — the browser's write — may not", async () => {
    const t = await FlowTest.mount(NotePage);
    await t.set("owner", "ada");
    expect(t.page().owner).toBe("ada");
    await expect(t.update("owner", "eve")).rejects.toThrow(/ignores a browser write.*@locked/);
  });
});

describe("what the browser may call", () => {
  it("refuses a method that is not @expose()d, with the server's own message", async () => {
    const t = await FlowTest.mount(NotePage);
    await expect(t.call("purge")).rejects.toThrow('Method "purge" is not allowed');
    expect(t.page().title).toBe("");
  });

  it("keeps the refusal for an error-path test that tolerates it", async () => {
    const t = (await FlowTest.mount(NotePage)).tolerateErrors();
    await t.call("purge");
    t.assertErrored("is not allowed");
    expect(t.frames().map((frame) => frame.type)).toEqual(["error"]);
  });
});

/** Throws from `render()` once `broken` is on. */
class FragilePage extends Component {
  @expose broken = false;

  @expose async breakIt(): Promise<void> {
    this.broken = true;
  }

  override async render(): Promise<HtmlNode> {
    if (this.broken) throw new TypeError("render broke");
    return { html: "<p>fine</p>" };
  }
}

class BrokenOnMountPage extends Component {
  override async render(): Promise<HtmlNode> {
    throw new RangeError("first paint broke");
  }
}

describe("a render that throws", () => {
  it("fails the mount with the error itself", async () => {
    const error = await FlowTest.mount(BrokenOnMountPage).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toBe("first paint broke");
    expect((error as Error).stack).toContain("testing.test.ts");
  });

  it("fails the action with the error and its stack, not empty markup", async () => {
    const t = await FlowTest.mount(FragilePage);
    const error = await t.call("breakIt").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe("render broke");
    expect((error as Error).stack).toContain("testing.test.ts");
    // Nothing came back to patch with, so the page is still what the visitor last saw.
    t.assertSee("fine");
  });
});

// ── Middleware, request scope, URL and route parameters ─────────────────────────

/** The path of every request the route's middleware saw. */
const seen: string[] = [];

class Recorder {
  handle(ctx: HttpContext, next: NextFn): Promise<Response | void> {
    seen.push(new URL(ctx.request.url).pathname);
    return next();
  }
}

class Gate {
  async handle(ctx: HttpContext, next: NextFn): Promise<Response | void> {
    if ((ctx as { user?: unknown }).user) return next();
    ctx.response = new Response(null, { status: 302, headers: { Location: "/login" } });
    return ctx.response;
  }
}

class MonotonicCounterPage extends Component {
  @locked({ monotonic: true }) count = 0;

  @expose bump(): void {
    this.count++;
  }

  override async render(): Promise<HtmlNode> {
    return { html: `<p>count:${this.count}</p>` };
  }
}

class ReactiveChild extends Component {
  @reactive limit = 5;

  override async render(): Promise<HtmlNode> {
    return { html: `<p>limit:${this.limit}</p>` };
  }
}

class RoutedPage extends Component {
  @locked post = "";
  @url search = "";
  @expose count = 0;

  @expose async bump(): Promise<void> {
    this.count++;
  }

  override async render(): Promise<HtmlNode> {
    return { html: `<p>post:${this.post} search:${this.search} count:${this.count}</p>` };
  }
}

class GatedPage extends Component {
  @expose ticks = 0;

  @expose async tick(): Promise<void> {
    this.ticks++;
  }

  override async render(): Promise<HtmlNode> {
    return { html: `<p>ticks:${this.ticks}</p>` };
  }
}

beforeAll(() => {
  flowRoute("/flowtest-posts/:post", RoutedPage, [Recorder]);
  flowRoute("/flowtest-gated", GatedPage, [Gate]);
});

describe("the route the page is served at", () => {
  it("runs the route's middleware on the mount and again on every action", async () => {
    seen.length = 0;
    const t = await FlowTest.mount(RoutedPage, {}, { url: "/flowtest-posts/42" });
    await t.call("bump");
    await t.call("bump");

    // An action runs against the address the page was rendered at, as in production.
    expect(seen).toEqual(["/flowtest-posts/42", "/flowtest-posts/42", "/flowtest-posts/42"]);
    t.assertSee("count:2");
  });

  it("seeds a field named after a route segment, as the router does", async () => {
    const t = await FlowTest.mount(RoutedPage, {}, { url: "/flowtest-posts/42" });
    t.assertSee("post:42");
    expect(t.page().post).toBe("42");
  });

  it("takes route parameters given directly, over what the URL says", async () => {
    const t = await FlowTest.mount(
      RoutedPage,
      {},
      { url: "/flowtest-posts/1", params: { post: "7" } },
    );
    expect(t.page().post).toBe("7");
  });

  it("reads @url fields from the query string", async () => {
    const t = await FlowTest.mount(RoutedPage, {}, { url: "/flowtest-posts/1?search=bun" });
    t.assertSee("search:bun");
    expect(t.page().search).toBe("bun");
  });

  it("asks for a URL when the route has segments to fill", async () => {
    await expect(FlowTest.mount(RoutedPage)).rejects.toThrow(/pass a URL to mount it at/);
  });

  it("follows the redirect a middleware answers a guest with", async () => {
    const t = await FlowTest.mount(GatedPage);
    t.assertRedirectedTo("/login");
    await expect(t.call("tick")).rejects.toThrow(/the mount redirected to \/login/);
  });
});

describe("the request scope", () => {
  it("runs every action inside a request, as a guest unless told otherwise", async () => {
    const t = await FlowTest.mount(NotePage);
    await t.call("whoAmI");
    expect(t.page().title).toBe("guest");
  });

  it("signs the page in as actingAs()'s user, for the middleware and the page alike", async () => {
    const t = await FlowTest.actingAs({ id: 7 }).mount(GatedPage);
    await t.call("tick");
    t.assertSee("ticks:1");
    expect(t.snapshot()?.memo.sub).toBe("7");

    const notes = await FlowTest.actingAs({ id: "ada" }).mount(NotePage);
    await notes.call("whoAmI");
    expect(notes.page().title).toBe("user ada");
  });

  it("refuses the next action once the user changes, as a page left open across a sign-out", async () => {
    const t = await FlowTest.actingAs({ id: 7 }).mount(GatedPage);
    t.actingAs({ id: 8 });
    await expect(t.call("tick")).rejects.toThrow("Your session changed — reload the page.");
  });
});

/** A static page: plain markup, no snapshot, nothing for the browser to call back. */
class StaticPage extends Component {
  static override interactive = false;
  /** Display data, loaded per request; nothing carries it to another. */
  items: string[] = [];

  override async onMount(): Promise<void> {
    this.items = ["loaded"];
  }

  @expose async noop(): Promise<void> {}

  override async render(): Promise<HtmlNode> {
    return { html: `<ul>${this.items.map((i) => `<li>${i}</li>`).join("")}</ul>` };
  }
}

describe("a static page", () => {
  it("is the instance the mount built, rendered again with what set() puts on it", async () => {
    const t = await FlowTest.mount(StaticPage);
    t.assertSee("<li>loaded</li>");
    expect(t.document()).toContain("<div data-flow-page><ul><li>loaded</li></ul></div>");

    await t.set("items", ["one", "two"]);
    t.assertSee("<li>two</li>").assertDontSee("loaded");
  });

  it("has nothing to send an action with", async () => {
    const t = await FlowTest.mount(StaticPage);
    await expect(t.call("noop")).rejects.toThrow(/is static .* and has no snapshot/);
  });
});

describe("set() on a page whose state only moves forward", () => {
  it("keeps the snapshot's sequence, so the actions after it are accepted", async () => {
    const t = await FlowTest.mount(MonotonicCounterPage);
    await t.set("count", 5);
    await t.call("bump");
    await t.call("bump");
    t.assertSee("count:7");
  });
});

describe("update() on a prop the parent owns", () => {
  it("says the server ignores the write, rather than passing", async () => {
    const t = await FlowTest.mount(ReactiveChild);
    await expect(t.update("limit", 9)).rejects.toThrow(/@reactive/);
  });
});
