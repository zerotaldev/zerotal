/**
 * The URL an action runs against.
 *
 * An action's request used to be a GET to the route pattern stored in the snapshot memo:
 * `/:tenant/posts/:post`, with no params and no query string. So `refresh()` and the browser's
 * resync re-ran `onMount(ctx)` with empty params, `currentUrl()` returned the pattern, and a
 * middleware reading the tenant segment saw none. The page's real address is now signed into
 * the memo when it renders, and an action's request is rebuilt from it.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import {
  Container,
  HttpContext,
  RequestContext,
  Router,
  ScopedResolver,
  request,
} from "@zerotal/core";
import type { NextFn } from "@zerotal/core";
import { Component } from "../Component.ts";
import { expose, locked } from "../decorators.ts";
import { _signSnapshot, verifySnapshot } from "../dehydrate.ts";
import { _getPageEntries } from "../registry.ts";
import { _makeFlowHandler, flowRoute } from "../router.ts";
import type { Snapshot } from "../types.ts";
import { _handleFlowMessage, _resetInvalidFrames, _routeParamsFor } from "./FlowProvider.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

type Frame = Record<string, unknown>;
type Deps = Parameters<typeof _handleFlowMessage>[2];
type Socket = Parameters<typeof _handleFlowMessage>[0];

const PATTERN = "/:tenant/posts/:post";
const ADDRESS = "/acme/posts/7?tab=comments";

/** What each `onMount()` and the route middleware saw. */
let mounts: { params: Record<string, unknown>; url: string; current: string }[] = [];
let tenantsSeen: unknown[] = [];

class TenantMiddleware {
  async handle(ctx: HttpContext, next: NextFn): Promise<Response | void> {
    tenantsSeen.push((ctx.params as Record<string, unknown>)["tenant"]);
    return next();
  }
}

class TenantPostPage extends Component {
  @locked title = "";
  @expose note = "";

  override async onMount(ctx?: HttpContext): Promise<void> {
    mounts.push({
      params: { ...((ctx?.params as Record<string, unknown> | undefined) ?? {}) },
      url: request().url.href,
      current: this.currentUrl(),
    });
    this.title = `post ${String((ctx?.params as Record<string, unknown> | undefined)?.["post"])}`;
  }

  @expose async touch(): Promise<void> {
    this.note = "touched";
  }

  override async render() {
    return { html: `<h1>${this.title}</h1>` };
  }
}

function socket(): { ws: Socket; frames: Frame[] } {
  const frames: Frame[] = [];
  const ws = {
    data: { origin: "http://localhost", headers: new Headers(), remoteIp: "203.0.113.9" },
    send(message: string): void {
      frames.push(JSON.parse(message) as Frame);
    },
  };
  return { ws: ws as unknown as Socket, frames };
}

const deps = (): Deps => ({ container: new Container(), globalMiddleware: () => [] });

/** Render the page as the router does at `address`, and return the snapshot it shipped. */
async function firstRender(address = ADDRESS): Promise<Snapshot> {
  const ctx = new HttpContext(
    new Request(`http://localhost${address}`),
    new ScopedResolver(new Container()),
  );
  ctx.params = { tenant: "acme", post: "7" };
  const Handler = _makeFlowHandler(PATTERN, TenantPostPage as never);
  await RequestContext.run(ctx, () => new Handler().handle(ctx));
  const body = await ctx.response!.text();
  const island = /<script type="application\/json" id="flow-state-[^"]+">([\s\S]*?)<\/script>/.exec(
    body,
  );
  return JSON.parse(island![1]!) as Snapshot;
}

function call(method: string, snapshot: Snapshot): string {
  return JSON.stringify({
    type: "call",
    component: snapshot.memo.id,
    method,
    args: [],
    updates: {},
    snapshot,
  });
}

beforeEach(() => {
  _resetInvalidFrames();
  Router.reset();
  _getPageEntries().delete("TenantPostPage");
  flowRoute(PATTERN, TenantPostPage as never, [TenantMiddleware as never]);
  mounts = [];
  tenantsSeen = [];
});

afterEach(() => {
  Router.reset();
  _getPageEntries().delete("TenantPostPage");
});

describe("the page's address in the snapshot", () => {
  it("is signed into the memo when the page renders, path and query", async () => {
    const snapshot = await firstRender();

    expect(snapshot.memo.path).toBe(PATTERN);
    expect(snapshot.memo.url).toBe(ADDRESS);
    expect(verifySnapshot(snapshot)).toBe(true);
    // Changing it breaks the signature, so the browser cannot point an action elsewhere.
    expect(verifySnapshot({ ...snapshot, memo: { ...snapshot.memo, url: "/evil/posts/7" } })).toBe(
      false,
    );
  });
});

describe("an action's request", () => {
  it("gives refresh() the route params and URL the first render had", async () => {
    const snapshot = await firstRender();
    const first = mounts[0]!;
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("$refresh", snapshot), deps());

    expect(frames.find((f) => f["type"] === "error")).toBeUndefined();
    const again = mounts[1]!;
    expect(again.params).toEqual({ tenant: "acme", post: "7" });
    expect(again.params).toEqual(first.params);
    expect(again.url).toBe(`http://localhost${ADDRESS}`);
    expect(again.current).toBe(first.current);
  });

  it("lets the route's middleware read the segment it is scoped by", async () => {
    const snapshot = await firstRender();
    const { ws } = socket();

    await _handleFlowMessage(ws, call("touch", snapshot), deps());

    expect(tenantsSeen).toEqual(["acme"]);
  });

  it("keeps the address on the snapshot the action sends back", async () => {
    const snapshot = await firstRender();
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("touch", snapshot), deps());

    const patch = frames.find((f) => f["type"] === "patch")!;
    expect((patch["memo"] as Snapshot["memo"]).url).toBe(ADDRESS);
  });
});

describe("a snapshot signed by 1.18", () => {
  it("is refused with a reload instruction, before any middleware runs", async () => {
    const current = await firstRender();
    const { url: _dropped, ...memo } = current.memo;
    // Genuinely signed, as 1.18.x signed it: no address in the memo.
    const legacy = _signSnapshot({ data: current.data, memo });
    expect(verifySnapshot(legacy)).toBe(true);
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("touch", legacy), deps());

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      type: "error",
      component: current.memo.id,
      code: "stale_snapshot",
      reload: true,
    });
    expect(tenantsSeen).toEqual([]);
  });
});

describe("matching the route params again", () => {
  it.each([
    ["/:tenant/posts/:post", "/acme/posts/7", { tenant: "acme", post: "7" }],
    ["/posts/:post", "/posts/hello%20world", { post: "hello world" }],
    ["/posts/:post", "/posts/7/", { post: "7" }],
    ["/docs/*", "/docs/a/b/c", {}],
    ["/", "/", {}],
    ["/posts/:post", "/users/7", {}],
    ["/posts/:post", "/posts/7/edit", {}],
    ["/posts/:post/edit", "/posts/7", {}],
  ])("matches %s against %s", (pattern, pathname, expected) => {
    expect(_routeParamsFor(pattern, pathname)).toEqual(expected);
  });
});
