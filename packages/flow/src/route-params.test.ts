import { beforeAll, describe, expect, test } from "bun:test";
import type { HttpContext } from "@zerotal/core";
import { Component } from "./Component.ts";
import type { HtmlNode } from "./jsx-runtime.ts";
import {
  expose,
  locked,
  param,
  url,
  session,
  getRouteParamProps,
  getExposedProps,
  getLockedProps,
  getSessionProps,
  sessionKeyFor,
} from "./decorators.ts";
import { _seedRouteParams } from "./router.ts";

class FakePost {
  constructor(public id: number) {}
}

class PostPage extends Component {
  @locked post: FakePost | null = null;
  @locked slug: string = "";
  @expose tab: string = "overview";
  @locked untouched: string = "keep me";
  notSerialized: string = "keep me too";
  override async render(): Promise<HtmlNode> {
    return { html: "<div></div>" };
  }
}

class RenamedPage extends Component {
  @locked @param("post") article: FakePost | null = null;
  @locked @param year: string = "";
  override async render(): Promise<HtmlNode> {
    return { html: "<div></div>" };
  }
}

/** Minimal stand-in — the seeder only reads `ctx.params`. */
const ctxWith = (params: Record<string, unknown>): HttpContext =>
  ({ params }) as unknown as HttpContext;

describe("@param / implicit route-param seeding", () => {
  test("fills a serialized field whose name matches a route segment", () => {
    const page = new PostPage();
    const post = new FakePost(7);

    _seedRouteParams(page, ctxWith({ post, slug: "hello", tab: "comments" }));

    expect(page.post).toBe(post); // the resolved model, by reference
    expect(page.slug).toBe("hello");
    expect(page.tab).toBe("comments"); // @expose is seeded too
  });

  test("leaves fields the route did not match", () => {
    const page = new PostPage();

    _seedRouteParams(page, ctxWith({ slug: "hello" }));

    expect(page.post).toBeNull();
    expect(page.untouched).toBe("keep me");
  });

  test("ignores fields that are not serialized", () => {
    const page = new PostPage();

    _seedRouteParams(page, ctxWith({ notSerialized: "overwritten" }));

    expect(page.notSerialized).toBe("keep me too");
  });

  test("@param reads a differently-named segment", () => {
    const page = new RenamedPage();
    const post = new FakePost(3);

    _seedRouteParams(page, ctxWith({ post, year: "2026" }));

    expect(page.article).toBe(post); // :post -> article
    expect(page.year).toBe("2026"); // bare @param uses the field's own name
  });

  test("registers the param name in the decorator metadata", () => {
    expect(getRouteParamProps(new RenamedPage())).toEqual(
      new Map([
        ["article", "post"],
        ["year", undefined],
      ]),
    );
  });

  // The seeder runs on the initial GET only. A WebSocket action rebuilds the context from
  // the stored route pattern, so `ctx.params` is empty — were it to run there, it would
  // wipe the value the snapshot just restored. This pins that it cannot.
  test("empty params never clobber an already-restored value", () => {
    const page = new PostPage();
    const restored = new FakePost(42);
    page.post = restored;
    page.slug = "from-snapshot";

    _seedRouteParams(page, ctxWith({}));

    expect(page.post).toBe(restored);
    expect(page.slug).toBe("from-snapshot");
  });
});

// ── @param(Model) — match by type, not by segment name ────────────────────────

class FakeUser {
  constructor(public id: number) {}
}

class TypedPage extends Component {
  @locked @param(FakeUser) viewer: FakeUser | null = null;
  @locked @param(FakePost) subject: FakePost | null = null;
  override async render(): Promise<HtmlNode> {
    return { html: "<div></div>" };
  }
}

describe("@param(Model) — matched by type", () => {
  test("finds the segment that resolved to an instance of the token", () => {
    const page = new TypedPage();
    const user = new FakeUser(1);
    const post = new FakePost(2);

    // Segment names deliberately unrelated to the field names.
    _seedRouteParams(page, ctxWith({ author: user, article: post, tab: "comments" }));

    expect(page.viewer).toBe(user);
    expect(page.subject).toBe(post);
  });

  test("leaves the field alone when no segment holds that type", () => {
    const page = new TypedPage();

    _seedRouteParams(page, ctxWith({ tab: "comments" }));

    expect(page.viewer).toBeNull();
    expect(page.subject).toBeNull();
  });

  test("takes the leftmost when a route binds the same model twice", () => {
    const page = new TypedPage();
    const first = new FakeUser(1);
    const second = new FakeUser(2);

    _seedRouteParams(page, ctxWith({ user: first, friend: second }));

    expect(page.viewer).toBe(first);
  });
});

// ── decorator defaults ────────────────────────────────────────────────────────

class DefaultsPage extends Component {
  @url page = 1; // a URL-synced field is client-visible by definition
  @session tag = ""; // session state stays on the server
  @locked @session theme = "light"; // …unless it opts in
  override async render(): Promise<HtmlNode> {
    return { html: "<div></div>" };
  }
}

describe("decorator defaults", () => {
  test("@url implies @expose — no need to write both", () => {
    expect(getExposedProps(new DefaultsPage())).toContain("page");
  });

  test("@session alone is server-only — never enters the snapshot", () => {
    const page = new DefaultsPage();

    expect(getExposedProps(page)).not.toContain("tag");
    expect(getLockedProps(page)).not.toContain("tag");
  });

  test("@locked @session opts the value into the snapshot, read-only", () => {
    const page = new DefaultsPage();

    expect(getLockedProps(page)).toContain("theme");
  });
});

// ── child components: props, not route segments ───────────────────────────────

let mountedChild: SetupChild | null = null;

class SetupChild extends Component {
  @locked label = "";
  @locked derived = "";
  @locked post: FakePost | null = null; // named after a segment on the parent's route
  sawContext = false;

  override async onMount(ctx?: never): Promise<void> {
    // Capturing the mounted instance for assertions is the point of this fixture.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    mountedChild = this;
    this.sawContext = ctx !== undefined;
    // Props are already assigned by the time any hook runs, so derive straight from them.
    this.derived = `from:${this.label || "none"}`;
  }

  override async render() {
    return { html: `<p>${this.label}</p>` } as never;
  }
}

class SetupParent extends Component {
  override async render() {
    return (await this.child(SetupChild, { props: { label: "hi" } })) as never;
  }
}

describe("child components", () => {
  beforeAll(() => {
    Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  });

  test("props are assigned before the hooks run, so onMount can derive from them", async () => {
    mountedChild = null;
    const parent = new SetupParent();
    parent._flowId = "p1";
    parent._flowPath = "/posts/:post";

    await parent.render();

    expect(mountedChild).not.toBeNull();
    expect(mountedChild!.label).toBe("hi"); // same-named field assigned from the prop
    expect(mountedChild!.derived).toBe("from:hi"); // and onMount could already read it
  });

  test("a child is never seeded from the route — `post` stays empty on /posts/:post", async () => {
    mountedChild = null;
    const parent = new SetupParent();
    parent._flowId = "p2";
    parent._flowPath = "/posts/:post";

    await parent.render();

    // Seeding is the routed page's business; a child gets only what its parent hands it.
    expect(mountedChild!.post).toBeNull();
  });
});

// ── @session keys ─────────────────────────────────────────────────────────────

class SessionPage extends Component {
  @session userId = ""; // the session's own `userId`
  @session({ key: "s" }) whatever = 0; // the session's `s`
  @session({ scoped: true }) draft = ""; // namespaced to this component
  @session({ key: "d", scoped: true }) both = "";
  override async render(): Promise<HtmlNode> {
    return { html: "<div></div>" };
  }
}

describe("@session key resolution", () => {
  const keyOf = (prop: string) =>
    sessionKeyFor(prop, getSessionProps(new SessionPage()).get(prop)!, "SessionPage");

  test("reads the session's own key by default — shared with controllers", () => {
    expect(keyOf("userId")).toBe("userId");
  });

  test("{ key } reads a differently-named session key", () => {
    expect(keyOf("whatever")).toBe("s");
  });

  test("{ scoped } namespaces the key to the component", () => {
    expect(keyOf("draft")).toBe("flow:SessionPage:draft");
  });

  test("{ key, scoped } namespaces the custom key", () => {
    expect(keyOf("both")).toBe("flow:SessionPage:d");
  });

  test("a session field is never in the snapshot unless it opts in", () => {
    const page = new SessionPage();

    expect(getExposedProps(page)).not.toContain("userId");
    expect(getLockedProps(page)).not.toContain("userId");
  });
});
