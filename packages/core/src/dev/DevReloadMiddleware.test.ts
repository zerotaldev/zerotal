import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  DevReloadMiddleware,
  registerDevHtmlSnippet,
  setDevReloadClientActive,
  _resetDevHtmlSnippets,
} from "./DevReloadMiddleware.ts";

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

const ctx = (pathname = "/") => ({ url: { pathname } });

function run(response: Response | undefined, c = ctx()) {
  return new DevReloadMiddleware().handle(c as never, (async () => response) as never) as Promise<
    Response | undefined
  >;
}

beforeEach(() => setDevReloadClientActive(true));
afterEach(() => {
  _resetDevHtmlSnippets();
  setDevReloadClientActive(false);
});

describe("DevReloadMiddleware", () => {
  it("injects the live-reload client before </body> in HTML responses", async () => {
    const res = await run(html("<html><body><h1>Hi</h1></body></html>"));
    const text = await res!.text();
    expect(text).toContain("/__dev/ws");
    expect(text).toContain("location.reload()");
    // injected before the closing body tag
    expect(text.indexOf("/__dev/ws")).toBeLessThan(text.indexOf("</body>"));
  });

  it("leaves non-HTML responses untouched", async () => {
    const json = Response.json({ ok: true });
    const res = await run(json);
    expect(res).toBe(json);
    expect(await res!.text()).toBe('{"ok":true}');
  });

  it("does not double-inject when the page already has a /__dev/ws client", async () => {
    const res = await run(html("<body><script>new WebSocket('/__dev/ws')</script></body>"));
    const text = await res!.text();
    expect(text.split("/__dev/ws").length - 1).toBe(1); // exactly one occurrence
  });

  it("appends to the end when there is no </body>", async () => {
    const res = await run(html("<div>fragment</div>"));
    const text = await res!.text();
    expect(text.startsWith("<div>fragment</div>")).toBe(true);
    expect(text).toContain("/__dev/ws");
  });

  it("injects registered snippets and passes the context to them", async () => {
    registerDevHtmlSnippet("tool", (c) =>
      (c as { url: { pathname: string } }).url.pathname.startsWith("/__zerotal")
        ? ""
        : `<script src="/__zerotal/devtools/client.js"></script>`,
    );
    const onApp = await run(html("<body></body>"), ctx("/dashboard"));
    expect(await onApp!.text()).toContain("/__zerotal/devtools/client.js");

    // snippet opts out for its own path, but the reload client is still injected
    const onPanel = await run(html("<body></body>"), ctx("/__zerotal/devtools"));
    const panelText = await onPanel!.text();
    expect(panelText).not.toContain("client.js");
    expect(panelText).toContain("/__dev/ws");
  });

  it("registerDevHtmlSnippet is idempotent by name", async () => {
    registerDevHtmlSnippet("dup", () => "<!--A-->");
    registerDevHtmlSnippet("dup", () => "<!--B-->");
    const res = await run(html("<body></body>"));
    const text = await res!.text();
    expect(text).toContain("<!--A-->");
    expect(text).not.toContain("<!--B-->");
  });

  it("a throwing snippet does not break the response", async () => {
    registerDevHtmlSnippet("boom", () => {
      throw new Error("nope");
    });
    const res = await run(html("<body></body>"));
    expect(res!.status).toBe(200);
    expect(await res!.text()).toContain("/__dev/ws");
  });

  it("preserves status and drops stale content-length", async () => {
    const res = await run(html("<body>x</body>", 201));
    expect(res!.status).toBe(201);
    expect(res!.headers.get("content-length")).toBeNull();
  });

  it("omits the reload client when not under dev-worker, but still runs snippets", async () => {
    setDevReloadClientActive(false);
    registerDevHtmlSnippet("tool", () => "<!--tool-->");
    const res = await run(html("<body></body>"));
    const text = await res!.text();
    expect(text).not.toContain("/__dev/ws");
    expect(text).toContain("<!--tool-->");
  });
});
