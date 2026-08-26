/**
 * Telling the page apart from the files the page pulled in.
 *
 * Live mode selected every trace as it arrived, so opening `/login` selected
 * `/login` and then, milliseconds later, `/favicon.ico`. The bar named a request
 * nobody asked about and the detail below it described that request's headers
 * and its empty session, while the page under inspection had scrolled into the
 * list. Nothing shown was wrong; it was all about the wrong request.
 *
 * Two properties matter here, and they pull against each other:
 *
 * 1. **An asset must not steal the selection**, which is the bug.
 * 2. **Nothing else may be mistaken for one.** A form post, an Inertia visit, a
 *    fetch — those are the requests most worth watching, and suppressing one
 *    would be a worse bug than the one being fixed. So the classifier defaults to
 *    `api` and only says `asset` when something actually says so.
 */
import { describe, it, expect } from "bun:test";
import { requestKind } from "./kind.ts";
import { matchesFacets, noFacets } from "./filter.ts";
import { Store } from "./state.ts";
import type { RequestTrace } from "../RequestTrace.ts";

function trace(overrides: Partial<RequestTrace> = {}): RequestTrace {
  return {
    id: "t1",
    requestId: "r1",
    method: "GET",
    path: "/posts",
    statusCode: 200,
    startMs: 0,
    durationMs: 1,
    queries: [],
    warnings: [],
    memory: 0,
    queryParams: {},
    headers: {},
    responseHeaders: {},
    session: [],
    route: null,
    auth: null,
    exception: null,
    logs: [],
    mail: [],
    cache: [],
    jobs: [],
    channels: {},
    ...overrides,
  };
}

const dest = (value: string, over: Partial<RequestTrace> = {}): RequestTrace =>
  trace({ headers: { "sec-fetch-dest": value }, ...over });

const served = (type: string, over: Partial<RequestTrace> = {}): RequestTrace =>
  trace({ responseHeaders: { "content-type": type }, ...over });

describe("what the browser says it wanted", () => {
  it("reads a navigation as the page", () => {
    expect(requestKind(dest("document"))).toBe("document");
    expect(requestKind(dest("iframe"))).toBe("document");
  });

  it("reads a sub-resource as an asset", () => {
    for (const d of ["image", "style", "script", "font", "manifest", "video"]) {
      expect(requestKind(dest(d)), d).toBe("asset");
    }
  });

  it("reads a script-initiated request as the app talking", () => {
    // `empty` is what fetch and XHR send — the form post and the Inertia visit.
    expect(requestKind(dest("empty"))).toBe("api");
  });

  it("believes the browser over the path", () => {
    // An app that serves an API from a `.js` route, or hashes its asset names.
    // The header is the only source here that cannot be fooled, so it wins.
    expect(requestKind(dest("empty", { path: "/reports/summary.js" }))).toBe("api");
    expect(requestKind(dest("style", { path: "/theme" }))).toBe("asset");
  });
});

describe("what was actually served", () => {
  it("reads HTML as the page, whatever asked for it", () => {
    // No `Sec-Fetch-Dest` at all: curl, a webhook, an older client. A page is
    // still a page.
    expect(requestKind(served("text/html; charset=utf-8"))).toBe("document");
  });

  it("reads a file's content type as an asset", () => {
    for (const type of ["text/css", "image/png", "font/woff2", "application/javascript"]) {
      expect(requestKind(served(type)), type).toBe("asset");
    }
  });

  it("does not read JSON as an asset", () => {
    expect(requestKind(served("application/json"))).toBe("api");
  });
});

describe("the path, when nothing else said anything", () => {
  it("classifies by extension", () => {
    // The common case is a 404: the response carries no useful type because
    // there was nothing to serve, and this is all that is left.
    expect(requestKind(trace({ path: "/favicon.ico", statusCode: 404 }))).toBe("asset");
    expect(requestKind(trace({ path: "/css/app.css" }))).toBe("asset");
    expect(requestKind(trace({ path: "/js/app.js?v=abc123" }))).toBe("asset");
  });

  it("calls anything it cannot place `api`, never `asset`", () => {
    // Being wrong here decides whether a request is skipped over, and skipping
    // the wrong one is how the panel stops showing what you came to see.
    expect(requestKind(trace({ path: "/login" }))).toBe("api");
    expect(requestKind(trace({ path: "/" }))).toBe("api");
  });
});

describe("the selection in live mode", () => {
  const state = (): Store => {
    const s = new Store(false);
    s.live = true;
    return s;
  };

  it("keeps the page selected when its favicon arrives", () => {
    // The reported bug, exactly: a login page, then the browser's own follow-up.
    const s = state();
    const page = dest("document", { id: "page", path: "/login" });
    s.addTrace(page);
    s.addTrace(dest("image", { id: "icon", path: "/favicon.ico", statusCode: 404 }));

    expect(s.selected?.id).toBe("page");
    // Still recorded — suppressed from the selection, not from the panel.
    expect(s.traces.map((t) => t.id)).toEqual(["icon", "page"]);
  });

  it("moves to the form post that follows", () => {
    // The half that must not break. This is the request worth watching, and a
    // rule of "only ever select documents" would have hidden it.
    const s = state();
    s.addTrace(dest("document", { id: "page", path: "/login" }));
    s.addTrace(dest("image", { id: "icon", path: "/favicon.ico" }));
    s.addTrace(dest("empty", { id: "post", path: "/login", method: "POST" }));

    expect(s.selected?.id).toBe("post");
  });

  it("selects an asset rather than showing nothing", () => {
    // A panel opened mid-load, or a page whose document 304s while its assets do
    // not. Something beats an empty detail pane.
    const s = state();
    s.addTrace(dest("style", { id: "css", path: "/css/app.css" }));

    expect(s.selected?.id).toBe("css");
  });

  it("still counts assets as pending when live is off", () => {
    // Paused means paused. The count is how many arrived while you were reading,
    // and quietly not counting some would make it lie.
    const s = new Store(false);
    s.live = false;
    s.addTrace(dest("image", { id: "icon" }));
    s.addTrace(dest("document", { id: "page" }));

    expect(s.pending).toBe(2);
    expect(s.selected).toBeNull();
  });
});

describe("the kind facet", () => {
  it("shows only what is picked", () => {
    const assets = { ...noFacets(), kinds: ["asset" as const] };
    expect(matchesFacets(dest("image"), assets)).toBe(true);
    expect(matchesFacets(dest("document"), assets)).toBe(false);
  });

  it("subtracts assets when the app's own traffic is picked", () => {
    // The everyday use: a list without fifty stylesheet fetches in it.
    const own = { ...noFacets(), kinds: ["document" as const, "api" as const] };
    expect(matchesFacets(dest("document"), own)).toBe(true);
    expect(matchesFacets(dest("empty"), own)).toBe(true);
    expect(matchesFacets(dest("script"), own)).toBe(false);
  });

  it("narrows by nothing when nothing is picked", () => {
    expect(matchesFacets(dest("image"), noFacets())).toBe(true);
  });
});
