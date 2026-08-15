import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { HttpContext, RequestContext, Router } from "@zerotal/core";
import { InertiaDevtoolsMiddleware } from "./middleware.ts";
import { clearEntries, listEntries, setMaxEntries } from "./store.ts";
import { DEVTOOLS_REQUEST_HEADERS, DEVTOOLS_RESPONSE_HEADERS } from "./types.ts";
import { REDACTED } from "./redact.ts";
import { buildPageObject, _setHtmlTemplate } from "../inertia.ts";
import { always, defer, merge, optional } from "../props/PropTypes.ts";
import { share, flushShared } from "../share.ts";

// The recorder follows `devSurfacesEnabled()` unless config says otherwise, and
// config is not loaded in a unit test. `APP_ENV` is what that gate reads.
const priorEnv = Bun.env["APP_ENV"];

function run<T>(ctx: HttpContext, fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(RequestContext.run(ctx, fn));
}

async function record(
  ctx: HttpContext,
  handler: () => Promise<Response> | Response,
): Promise<Response> {
  const middleware = new InertiaDevtoolsMiddleware();
  const out = await run(ctx, () => middleware.handle(ctx, async () => handler()));
  return out as Response;
}

describe("devtools recorder — middleware", () => {
  beforeEach(() => {
    Bun.env["APP_ENV"] = "development";
    clearEntries();
    setMaxEntries(200);
    Router.reset();
    flushShared();
  });

  afterEach(() => {
    if (priorEnv === undefined) delete Bun.env["APP_ENV"];
    else Bun.env["APP_ENV"] = priorEnv;
  });

  it("stamps the entry id on the response and stores an entry", async () => {
    const ctx = HttpContext.fake("http://localhost/posts");
    const response = await record(
      ctx,
      () =>
        new Response("{}", {
          headers: { "Content-Type": "application/json" },
        }),
    );

    const id = response.headers.get(DEVTOOLS_RESPONSE_HEADERS.id);
    expect(id).toBeTruthy();

    const entries = listEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.__meta.id).toBe(id!);
    expect(entries[0]!.__meta.method).toBe("GET");
    expect(entries[0]!.__meta.status).toBe(200);
    expect(entries[0]!.__meta.url).toContain("/posts");
  });

  it("starts a batch when the client names no parent, and joins one when it does", async () => {
    const solo = await record(HttpContext.fake("http://localhost/a"), () => new Response(null));
    // No parent header: the entry is its own batch root.
    expect(solo.headers.get(DEVTOOLS_RESPONSE_HEADERS.parentOut)).toBe(
      solo.headers.get(DEVTOOLS_RESPONSE_HEADERS.id),
    );

    const child = await record(
      HttpContext.fake("http://localhost/b", {
        headers: { [DEVTOOLS_REQUEST_HEADERS.parent]: "batch-root-1" },
      }),
      () => new Response(null),
    );
    expect(child.headers.get(DEVTOOLS_RESPONSE_HEADERS.parentOut)).toBe("batch-root-1");
    expect(listEntries()[0]!.__meta.batchId).toBe("batch-root-1");
  });

  it("carries the tab and visit ids into __meta", async () => {
    await record(
      HttpContext.fake("http://localhost/a", {
        headers: {
          [DEVTOOLS_REQUEST_HEADERS.tab]: "tab-7",
          [DEVTOOLS_REQUEST_HEADERS.visit]: "visit-9",
        },
      }),
      () => new Response(null),
    );
    const meta = listEntries()[0]!.__meta;
    expect(meta.tabUuid).toBe("tab-7");
    expect(meta.visitId).toBe("visit-9");
  });

  it("classifies the request type from the client's headers", async () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{}, "initial"],
      [{ "X-Inertia": "true" }, "navigate"],
      [{ "X-Inertia": "true", [DEVTOOLS_REQUEST_HEADERS.poll]: "1" }, "poll"],
      [{ "X-Inertia": "true", [DEVTOOLS_REQUEST_HEADERS.deferred]: "1" }, "deferred"],
      [{ "X-Inertia": "true", "X-Inertia-Partial-Component": "Posts/Index" }, "partial"],
      [{ "X-Inertia": "true", "X-Inertia-Prefetch": "true" }, "prefetch"],
    ];

    for (const [headers, expected] of cases) {
      clearEntries();
      await record(HttpContext.fake("http://localhost/a", { headers }), () => new Response(null));
      expect(listEntries()[0]!.__meta.requestType).toBe(expected as never);
    }
  });

  it("injects the discovery script tag into an HTML response", async () => {
    const response = await record(
      HttpContext.fake("http://localhost/"),
      () =>
        new Response("<html><head><title>x</title></head><body>hi</body></html>", {
          headers: { "Content-Type": "text/html" },
        }),
    );

    const html = await response.text();
    const id = response.headers.get(DEVTOOLS_RESPONSE_HEADERS.id)!;
    expect(html).toContain(
      `<script data-inertia-devtools-id type="application/json">"${id}"</script>`,
    );
    // Before </head>, so the extension sees it before any XHR can run.
    expect(html.indexOf("data-inertia-devtools-id")).toBeLessThan(html.indexOf("</head>"));
    expect(html).toContain("<body>hi</body>");
  });

  it("leaves a JSON response body untouched", async () => {
    const response = await record(
      HttpContext.fake("http://localhost/a", { headers: { "X-Inertia": "true" } }),
      () =>
        new Response(JSON.stringify({ component: "Posts/Index" }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    expect(await response.text()).toBe('{"component":"Posts/Index"}');
  });

  it("never touches a streaming response", async () => {
    const stream = new ReadableStream({ start: (c) => c.close() });
    const response = await record(
      HttpContext.fake("http://localhost/sse"),
      () => new Response(stream, { headers: { "Content-Type": "text/event-stream" } }),
    );
    // Untouched means no id header and nothing recorded — rebuilding the
    // Response to add one can stall a long-lived connection.
    expect(response.headers.get(DEVTOOLS_RESPONSE_HEADERS.id)).toBeNull();
    expect(listEntries()).toHaveLength(0);
  });

  it("redacts sensitive request headers before storing", async () => {
    await record(
      HttpContext.fake("http://localhost/a", {
        headers: { Authorization: "Bearer secret-token", Accept: "application/json" },
      }),
      () => new Response(null),
    );
    const headers = listEntries()[0]!.http.requestHeaders;
    expect(headers["authorization"]).toBe(REDACTED);
    expect(headers["accept"]).toBe("application/json");
  });

  it("records the matched route name", async () => {
    class PostController {}
    Router.get("/posts/:slug", PostController, "show").name("posts.show");

    await record(HttpContext.fake("http://localhost/posts/hello"), () => new Response(null));

    expect(listEntries()[0]!.route).toMatchObject({
      uri: "/posts/:slug",
      name: "posts.show",
    });
  });

  it("does not record the devtools read API itself", async () => {
    await record(
      HttpContext.fake("http://localhost/_inertia/devtools/entries"),
      () => new Response("[]"),
    );
    // Recording the act of reading the timeline would fill it with polls.
    expect(listEntries()).toHaveLength(0);
  });

  it("records nothing when dev surfaces are off", async () => {
    Bun.env["APP_ENV"] = "production";
    const response = await record(HttpContext.fake("http://localhost/a"), () => new Response(null));
    expect(response.headers.get(DEVTOOLS_RESPONSE_HEADERS.id)).toBeNull();
    expect(listEntries()).toHaveLength(0);
  });
});

describe("devtools recorder — prop capture", () => {
  beforeEach(() => {
    Bun.env["APP_ENV"] = "development";
    clearEntries();
    Router.reset();
    flushShared();
    _setHtmlTemplate("<!DOCTYPE html><html><body><!-- @inertia --></body></html>");
  });

  afterEach(() => {
    if (priorEnv === undefined) delete Bun.env["APP_ENV"];
    else Bun.env["APP_ENV"] = priorEnv;
  });

  it("describes each prop by the wrapper that produced it", async () => {
    const ctx = HttpContext.fake("http://localhost/posts");

    await record(ctx, async () => {
      await buildPageObject("Posts/Index", {
        title: "Posts",
        stats: always(() => ({ views: 1 })),
        comments: defer(() => [], "secondary"),
        sidebar: optional(() => "later"),
        items: merge([1, 2, 3]),
      });
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    });

    const props = listEntries()[0]!.props;
    expect(props["title"]).toEqual({});
    expect(props["stats"]).toMatchObject({ inertiaType: "always" });
    expect(props["comments"]).toMatchObject({ inertiaType: "defer", deferGroup: "secondary" });
    expect(props["sidebar"]).toMatchObject({ inertiaType: "optional" });
    expect(props["items"]).toMatchObject({ inertiaType: "merge", mergeDirection: "append" });
  });

  it("marks shared props as shared", async () => {
    share("auth", { id: 1 });
    const ctx = HttpContext.fake("http://localhost/posts");

    await record(ctx, async () => {
      await buildPageObject("Posts/Index", { title: "Posts" });
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    });

    const props = listEntries()[0]!.props;
    expect(props["auth"]).toMatchObject({ shared: true });
    expect(props["title"]!.shared).toBeUndefined();
  });

  it("records the component and redacts prop values", async () => {
    const ctx = HttpContext.fake("http://localhost/login");

    await record(ctx, async () => {
      await buildPageObject("Auth/Login", {
        email: "ada@example.com",
        form: { password: "hunter2" },
      });
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    });

    const stored = listEntries()[0]!;
    expect(stored.__meta.component).toBe("Auth/Login");
    expect(stored.componentPath).toContain("Auth/Login");
    expect(stored.propValues!["email"]).toBe("ada@example.com");
    expect(stored.propValues!["form"]).toEqual({ password: REDACTED });
  });
});
