import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Application } from "@zerotal/core";
import { HttpContext, RequestContext, Router } from "@zerotal/core";
import { InertiaDevtoolsMiddleware } from "./middleware.ts";
import { installInertiaObservability } from "./observability.ts";
import { clearEntries, setMaxEntries } from "./store.ts";
import { DEVTOOLS_REQUEST_HEADERS } from "./types.ts";
import { buildPageObject, _setHtmlTemplate } from "../inertia.ts";
import { always, defer, merge, optional } from "../props/PropTypes.ts";
import { share, flushShared } from "../share.ts";

// The recorder follows `devSurfacesEnabled()` unless config says otherwise, and
// config is not loaded in a unit test. `APP_ENV` is what that gate reads.
const priorEnv = Bun.env["APP_ENV"];

/** A stand-in for `@zerotal/devtools`' sink — this package must never import it. */
interface Recorded {
  ctx: object;
  channel: string;
  entry: Record<string, unknown>;
}

function fakeDevtools() {
  const descriptors: Array<Record<string, unknown>> = [];
  const recorded: Recorded[] = [];
  const sink = {
    channel: (d: Record<string, unknown>) => void descriptors.push(d),
    record: (ctx: object, channel: string, entry: Record<string, unknown>) =>
      void recorded.push({ ctx, channel, entry }),
  };
  const app = {
    container: { tryMake: (k: string) => (k === "devtools.trace" ? sink : undefined) },
  } as unknown as Application;
  return { app, descriptors, recorded };
}

/** An app with no devtools installed — the ordinary production shape. */
const bareApp = {
  container: { tryMake: () => undefined },
} as unknown as Application;

async function record(
  ctx: HttpContext,
  handler: () => Promise<Response> | Response,
): Promise<void> {
  const middleware = new InertiaDevtoolsMiddleware();
  await RequestContext.run(ctx, () => middleware.handle(ctx, async () => handler()));
}

describe("Inertia → devtools panel bridge", () => {
  let stop: () => void = () => {};

  beforeEach(() => {
    Bun.env["APP_ENV"] = "development";
    clearEntries();
    setMaxEntries(200);
    Router.reset();
    flushShared();
    _setHtmlTemplate("<!DOCTYPE html><html><body><!-- @inertia --></body></html>");
  });

  afterEach(() => {
    stop();
    stop = () => {};
    if (priorEnv === undefined) delete Bun.env["APP_ENV"];
    else Bun.env["APP_ENV"] = priorEnv;
  });

  it("does nothing when devtools is not installed", async () => {
    // The ordinary case, and it must stay silent: this package works whether or
    // not the panel is there, and the recorder calls the bridge unguarded.
    stop = installInertiaObservability(bareApp);
    await record(
      HttpContext.fake("http://localhost/posts"),
      () => new Response("{}", { headers: { "Content-Type": "application/json" } }),
    );
    // Nothing to assert on but the absence of a throw — which is the whole point.
    expect(true).toBe(true);
  });

  it("declares one channel, described as data", async () => {
    const { app, descriptors } = fakeDevtools();
    stop = installInertiaObservability(app);

    expect(descriptors).toHaveLength(1);
    const d = descriptors[0]!;
    expect(d["id"]).toBe("inertia");
    expect(d["render"]).toBe("tree");
    expect(d["treeField"]).toBe("propMeta");
    expect(d["treeBadge"]).toBe("inertiaType");
    // The batch is what folds a visit together with the loads it triggered.
    expect(d["traceGroup"]).toBe("batchId");
  });

  it("records the request against the context its SQL was recorded against", async () => {
    // This is the join. No key is matched: the entry goes onto the same
    // HttpContext, so devtools puts it on that request's trace by construction.
    const { app, recorded } = fakeDevtools();
    stop = installInertiaObservability(app);

    const ctx = HttpContext.fake("http://localhost/posts");
    await record(
      ctx,
      () => new Response("{}", { headers: { "Content-Type": "application/json" } }),
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.ctx).toBe(ctx);
    expect(recorded[0]!.channel).toBe("inertia");
  });

  it("carries the classification, the component, and the route", async () => {
    const { app, recorded } = fakeDevtools();
    stop = installInertiaObservability(app);
    Router.get("/posts", class {} as never, "index", []);

    const ctx = HttpContext.fake("http://localhost/posts", {
      headers: { "X-Inertia": "true" },
    });
    await record(ctx, async () => {
      await buildPageObject("Posts/Index", { title: "Posts" });
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    });

    const entry = recorded[0]!.entry;
    expect(entry["requestType"]).toBe("navigate");
    expect(entry["component"]).toBe("Posts/Index");
    expect(entry["status"]).toBe(200);
    expect(entry["url"]).toContain("/posts");
    expect(entry["entryId"]).toBeTruthy();
    expect(entry["componentPath"]).toContain("Posts/Index");
  });

  it("carries the per-prop metadata the panel draws as a tree", async () => {
    const { app, recorded } = fakeDevtools();
    stop = installInertiaObservability(app);
    share("auth", { id: 1 });

    await record(HttpContext.fake("http://localhost/posts"), async () => {
      await buildPageObject("Posts/Index", {
        title: "Posts",
        comments: defer(() => [], "secondary"),
        sidebar: optional(() => "later"),
        items: merge([1, 2, 3]),
        settings: always(() => ({})).once(),
      });
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    });

    const entry = recorded[0]!.entry;
    const propMeta = entry["propMeta"] as Record<string, Record<string, unknown>>;

    // The meta line's count and the tree are the same set — a row saying "7
    // props" above a tree of five is the kind of quiet disagreement that makes a
    // reader distrust the whole panel.
    expect(entry["props"]).toBe(Object.keys(propMeta).length);
    expect(propMeta["comments"]).toMatchObject({
      inertiaType: "defer",
      deferGroup: "secondary",
    });
    expect(propMeta["sidebar"]).toMatchObject({ inertiaType: "optional" });
    expect(propMeta["items"]).toMatchObject({ inertiaType: "merge", mergeDirection: "append" });
    expect(propMeta["settings"]).toMatchObject({ once: true });
    expect(propMeta["auth"]).toMatchObject({ shared: true });
    expect(propMeta["title"]).toEqual({});
  });

  it("carries the batch id, so a visit and its follow-ups fold together", async () => {
    const { app, recorded } = fakeDevtools();
    stop = installInertiaObservability(app);

    await record(
      HttpContext.fake("http://localhost/posts", {
        headers: { [DEVTOOLS_REQUEST_HEADERS.parent]: "visit-1" },
      }),
      () => new Response(null),
    );

    expect(recorded[0]!.entry["batchId"]).toBe("visit-1");
  });

  it("carries no request headers or bodies onto the channel", async () => {
    // The panel gets a view of the entry, not the entry. Headers and captured
    // bodies stay in the protocol store, which has its own retention — copying
    // them would put a second, longer-lived copy in the trace database.
    const { app, recorded } = fakeDevtools();
    stop = installInertiaObservability(app);

    await record(
      HttpContext.fake("http://localhost/posts", {
        headers: { authorization: "Bearer sk-live-secret" },
      }),
      () => new Response(null),
    );

    const serialised = JSON.stringify(recorded[0]!.entry);
    expect(serialised).not.toContain("sk-live-secret");
    expect(recorded[0]!.entry["http"]).toBeUndefined();
  });

  it("stops recording once the bridge is detached", async () => {
    const { app, recorded } = fakeDevtools();
    installInertiaObservability(app)();

    await record(HttpContext.fake("http://localhost/posts"), () => new Response(null));
    expect(recorded).toHaveLength(0);
  });
});
