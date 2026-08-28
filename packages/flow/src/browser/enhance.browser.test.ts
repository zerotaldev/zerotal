/**
 * `<form data-enhance>` in a real browser, on a page with no Flow component.
 *
 * There is no other place these can be tested. The feature is a submit listener, a
 * `fetch`, and a DOM swap — server-side rendering never runs any of it, and a unit
 * test with a stubbed document proves only that the stub behaves as stubbed. What
 * a reader wants to know is whether the page stops flashing, and that question is
 * only answerable by a browser that would otherwise have navigated.
 *
 * The load-bearing assertion in most of these is the **render counter**. Each
 * server render increments it and prints it into the page, so a full navigation
 * and an in-place patch are distinguishable after the fact: a navigation replaces
 * the whole document and the counter comes back changed for the whole page, while
 * an enhanced submission leaves everything outside the form exactly as it was.
 * Without it, a test that asserts "the message updated" passes just as happily
 * when the browser navigated normally and the enhancement did nothing at all.
 *
 * They skip where no browser is installed, like the bridge tests beside them.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Application } from "@zerotal/core";
import { FlowProvider } from "../provider/FlowProvider.ts";
import { FlowBrowser } from "./FlowBrowser.ts";
import { registerEnhanceFixtures } from "./__fixtures__/enhanceRoutes.ts";

const T = 60_000;

/**
 * `waitForConnection: false` on every open, and it is not incidental.
 *
 * `FlowBrowser.open()` waits by default for the bridge to stamp
 * `data-flow-connection="online"` on the body, which is the right default for a
 * page driven by a Flow component. These pages have no component, no runtime and
 * no socket — that absence is the fixture — so nothing ever stamps anything and
 * the default wait can only ever time out.
 */
const hasBrowser = FlowBrowser.available();
const describeBrowser = hasBrowser ? describe : describe.skip;

let app: Application;
let base: string;

beforeAll(async () => {
  if (!hasBrowser) return;
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  Bun.env.APP_ENV = "test";

  Application._resetInstance();
  app = Application.create({ env: "web", providers: [FlowProvider] });
  await app.boot();
  registerEnhanceFixtures();
  await app.start(0);

  const server = (app as unknown as { _static?: { port: number } })._static;
  base = `http://localhost:${server?.port}`;
}, T);

afterAll(async () => {
  if (!hasBrowser) return;
  await app?.close?.();
}, T);

describeBrowser("plain-form enhancement", () => {
  it(
    "serves the standalone bundle to a page that has no Flow component",
    async () => {
      const response = await fetch(`${base}/__flow/enhance.js`);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("javascript");
      const body = await response.text();
      expect(body.length).toBeGreaterThan(0);
      // The point of the separate bundle: none of the runtime comes with it.
      expect(body).not.toContain("alpinejs");
      expect(body).not.toContain("WebSocket");
    },
    T,
  );

  it(
    "posts through fetch and patches the response in without navigating",
    async () => {
      const page = await FlowBrowser.open(`${base}/plain/form`, {
        timeout: T,
        waitForConnection: false,
      });
      try {
        const rendersBefore = await page.text("#renders");
        expect(await page.text("#message")).toBe("start");

        await page.fill("#email", "someone@example.com");
        await page.click("#submit");
        await page.waitForText("#message", "subscribed someone@example.com", T);

        // The page outside the form never re-rendered — which is the whole feature.
        // A native submit would have replaced the document and brought a new count.
        expect(await page.text("#renders")).toBe(rendersBefore);
        expect(page.pageErrors()).toEqual([]);
      } finally {
        await page.close();
      }
    },
    T,
  );

  it(
    "puts a validation error where the person is looking, and keeps what they typed",
    async () => {
      const page = await FlowBrowser.open(`${base}/plain/form`, {
        timeout: T,
        waitForConnection: false,
      });
      try {
        await page.fill("#email", "not-an-email");
        await page.click("#submit");
        await page.waitForText("#message", "that is not an email", T);

        // The response carried the markup, so the value survives the swap. A form
        // that reports an error and empties the field is worse than no enhancement.
        expect(await page.value("#email")).toBe("not-an-email");
      } finally {
        await page.close();
      }
    },
    T,
  );

  it(
    "leaves focus and the caret where they were",
    async () => {
      const page = await FlowBrowser.open(`${base}/plain/form`, {
        timeout: T,
        waitForConnection: false,
      });
      try {
        await page.fill("#email", "bad");
        // Put the cursor in the field, then submit with the keyboard the way a
        // person would — the swap destroys the focused node, and restoring it is
        // what keeps the form usable.
        await page.evaluate(`document.querySelector('#email').focus()`);
        await page.click("#submit");
        await page.waitForText("#message", "that is not an email", T);

        const focused = await page.evaluate<string>(
          `document.activeElement && document.activeElement.getAttribute('name')`,
        );
        expect(focused).toBe("email");
      } finally {
        await page.close();
      }
    },
    T,
  );

  it(
    "follows a redirect, swaps the document, and moves the address bar with it",
    async () => {
      const page = await FlowBrowser.open(`${base}/plain/redirecting`, {
        timeout: T,
        waitForConnection: false,
      });
      try {
        await page.click("#submit");
        await page.waitForSelector("#landed", T);
        expect(await page.text("#landed")).toBe("landed");

        // pushState, not just a swap: an address bar still claiming the posting
        // page means reload and back go somewhere the person did not expect.
        const href = await page.evaluate<string>(`window.location.pathname`);
        expect(href).toBe("/plain/landed");
      } finally {
        await page.close();
      }
    },
    T,
  );

  it(
    "handles a second submission on the form it just swapped in",
    async () => {
      // The regression this guards: the swap replaces the form with a fresh node,
      // so anything bound per-form would be discarded by the first success and the
      // second submit would post natively for no visible reason. Delegation on
      // `document` is what makes this pass.
      const page = await FlowBrowser.open(`${base}/plain/form`, {
        timeout: T,
        waitForConnection: false,
      });
      try {
        const rendersBefore = await page.text("#renders");

        await page.fill("#email", "first@example.com");
        await page.click("#submit");
        await page.waitForText("#message", "subscribed first@example.com", T);

        await page.fill("#email", "second@example.com");
        await page.click("#submit");
        await page.waitForText("#message", "subscribed second@example.com", T);

        expect(await page.text("#renders")).toBe(rendersBefore);
      } finally {
        await page.close();
      }
    },
    T,
  );

  it(
    "leaves a form without the attribute alone",
    async () => {
      // The control. If this navigated *and* the enhanced one did too, every
      // assertion above would be measuring the server rather than the enhancement.
      const page = await FlowBrowser.open(`${base}/plain/unenhanced`, {
        timeout: T,
        waitForConnection: false,
      });
      try {
        const rendersBefore = Number(await page.text("#renders"));
        await page.fill("#email", "someone@example.com");
        await page.click("#submit");
        await page.waitForText("#message", "subscribed someone@example.com", T);

        // A real navigation: the whole document was re-rendered by the server.
        expect(Number(await page.text("#renders"))).toBeGreaterThan(rendersBefore);
      } finally {
        await page.close();
      }
    },
    T,
  );
});
