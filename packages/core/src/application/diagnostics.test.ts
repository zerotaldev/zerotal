/**
 * The diagnosis registry, and that a diagnosis reaches the page.
 *
 * The registry's one hard requirement is that it cannot make things worse: it
 * runs *while an error page is already being rendered*, so a diagnoser that
 * throws must not replace a real stack trace with a stack trace about the
 * diagnoser.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { registerErrorDiagnoser, _diagnoseError, _resetErrorDiagnosers } from "./diagnostics.ts";
import { renderDevErrorPage } from "./DevErrorPage.ts";

/**
 * Just the diagnosis panel.
 *
 * The whole page is the wrong thing to assert against: the stylesheet always
 * defines `.dx-title`, and the "Copy for AI" payload echoes the *source of the
 * running test file* back as JSON — so a test whose own source mentions a string
 * finds it in the output no matter what the panel did.
 */
function panel(html: string): string {
  const start = html.indexOf('<div class="dx">');
  if (start === -1) return "";
  // Bounded by the next section marker, and searched *forward from `start`*: the
  // stylesheet defines `.dx-detail` long before the panel exists, so anchoring on
  // a class name finds the CSS and inverts the slice.
  const end = html.indexOf("<!-- Body: frames", start);
  return html.slice(start, end === -1 ? undefined : end);
}

describe("the diagnoser registry", () => {
  beforeEach(() => _resetErrorDiagnosers());
  afterEach(() => _resetErrorDiagnosers());

  it("returns nothing when no diagnoser recognises the error", async () => {
    registerErrorDiagnoser(() => null);
    expect(await _diagnoseError(new Error("boom"))).toBeNull();
  });

  it("returns the first diagnoser that recognises it", async () => {
    registerErrorDiagnoser(() => null);
    registerErrorDiagnoser(() => ({ title: "first", detail: "d" }));
    registerErrorDiagnoser(() => ({ title: "second", detail: "d" }));
    expect((await _diagnoseError(new Error("boom")))?.title).toBe("first");
  });

  it("skips a diagnoser that throws, rather than losing the error page", async () => {
    registerErrorDiagnoser(() => {
      throw new Error("the diagnoser itself is broken");
    });
    registerErrorDiagnoser(() => ({ title: "still works", detail: "d" }));
    expect((await _diagnoseError(new Error("boom")))?.title).toBe("still works");
  });

  it("awaits an async diagnoser", async () => {
    registerErrorDiagnoser(async () => {
      await Bun.sleep(1);
      return { title: "async", detail: "d" };
    });
    expect((await _diagnoseError(new Error("boom")))?.title).toBe("async");
  });
});

describe("the dev error page", () => {
  beforeEach(() => _resetErrorDiagnosers());
  afterEach(() => _resetErrorDiagnosers());

  it("renders the diagnosis above the stack", async () => {
    registerErrorDiagnoser(() => ({
      title: "table `assets` does not exist, and 3 migrations have not run.",
      detail: "Running them is very likely the fix.",
      items: ["001_create_assets", "002_add_slug"],
    }));

    const html = await (await renderDevErrorPage(new Error("no such table: assets"))).text();

    expect(html).toContain("does not exist, and 3 migrations have not run.");
    expect(html).toContain("001_create_assets");
    // Above the frame list, because the answer is never in the stack for this
    // error class — every frame is inside the SQL driver.
    expect(html.indexOf('<div class="dx">')).toBeLessThan(html.indexOf('id="frameList"'));
  });

  it("offers no button when the diagnosis has no action", async () => {
    registerErrorDiagnoser(() => ({ title: "t", detail: "d" }));
    const html = await (await renderDevErrorPage(new Error("boom"))).text();
    expect(panel(html)).not.toBe("");
    expect(html).not.toContain('id="dxRun"');
  });

  it("renders the button and its token when there is an action", async () => {
    registerErrorDiagnoser(() => ({
      title: "t",
      detail: "d",
      action: {
        label: "Run 3 migrations",
        url: "/__zerotal/run-migrations",
        token: "tok-123",
        pendingLabel: "Migrating…",
      },
    }));
    const html = await (await renderDevErrorPage(new Error("boom"))).text();
    expect(html).toContain('id="dxRun"');
    expect(html).toContain("Run 3 migrations");
    expect(html).toContain("tok-123");
    expect(html).toContain("/__zerotal/run-migrations");
  });

  it("escapes a diagnosis, which can carry a table name from a hostile query", async () => {
    registerErrorDiagnoser(() => ({
      title: "<script>alert(1)</script>",
      detail: "d",
      items: ["<img onerror=alert(2)>"],
    }));
    const html = await (await renderDevErrorPage(new Error("boom"))).text();
    const dx = panel(html);
    expect(dx).not.toContain("<script>alert(1)</script>");
    expect(dx).not.toContain("<img onerror=alert(2)>");
    expect(dx).toContain("&lt;script&gt;");
  });

  it("renders normally when nothing diagnoses the error", async () => {
    const html = await (await renderDevErrorPage(new Error("boom"))).text();
    expect(panel(html)).toBe("");
    expect(html).toContain('id="frameList"');
  });
});
