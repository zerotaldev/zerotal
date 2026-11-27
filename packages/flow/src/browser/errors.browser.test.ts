/**
 * What the browser does with an error frame, in a real browser.
 *
 * An error frame used to reach `console.error` and nothing else, so in production the visitor saw
 * a button that did nothing. And "Invalid snapshot" left the page refusing every later action
 * until they reloaded by hand. Now the frame is announced as a `flow:error` window event, a
 * default notice goes out through `flow:flash` unless a listener calls `preventDefault()`, and an
 * invalid snapshot reloads the page once.
 *
 * Skipped where no browser is installed, as the bridge suite is.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Application, Router } from "@zerotal/core";
import { FlowProvider } from "../provider/FlowProvider.ts";
import { FlowBrowser } from "./FlowBrowser.ts";
import { FailingPage } from "./__fixtures__/FailingPage.tsx";

const T = 60_000;
const KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";

const hasBrowser = FlowBrowser.available();
const describeBrowser = hasBrowser ? describe : describe.skip;

let app: Application;
let url: string;

/** Record every `flow:error` and `flow:flash` the page sees, optionally taking errors over. */
const RECORD = (takeOver: boolean): string => `(() => {
  window.__errors = [];
  window.__flashes = [];
  window.addEventListener("flow:error", (e) => {
    window.__errors.push(e.detail);
    ${takeOver ? "e.preventDefault();" : ""}
  });
  window.addEventListener("flow:flash", (e) => window.__flashes.push(e.detail));
  return true;
})()`;

beforeAll(async () => {
  if (!hasBrowser) return;
  Bun.env.APP_KEY = KEY;
  Bun.env.APP_ENV = "test";

  Application._resetInstance();
  app = Application.create({ env: "web", providers: [FlowProvider] });
  await app.boot();
  Router.flow("/failing", FailingPage);
  await app.start(0);

  const server = (app as unknown as { _static?: { port: number } })._static;
  url = `http://localhost:${server?.port}/failing`;
}, T);

afterAll(async () => {
  if (!hasBrowser) return;
  Bun.env.APP_KEY = KEY;
  await app?.close?.();
}, T);

describeBrowser("an error frame in the browser", () => {
  it(
    "is announced as flow:error, and shown as a notice when nothing handles it",
    async () => {
      const page = await FlowBrowser.open(url, { timeout: T });
      try {
        await page.evaluate(RECORD(false));

        await page.click("#break");
        await page.waitUntil("window.__flashes.length === 1", "the default notice", T);

        const [detail] =
          await page.evaluate<{ code: string; component: string }[]>("window.__errors");
        expect(detail?.code).toBe("server_error");
        expect(typeof detail?.component).toBe("string");
        const [notice] =
          await page.evaluate<{ level: string; message: string }[]>("window.__flashes");
        expect(notice?.level).toBe("error");
        expect(notice?.message.length).toBeGreaterThan(0);
      } finally {
        await page.close();
      }
    },
    T,
  );

  it(
    "shows no notice when a listener calls preventDefault()",
    async () => {
      const page = await FlowBrowser.open(url, { timeout: T });
      try {
        await page.evaluate(RECORD(true));

        await page.click("#break");
        await page.waitUntil("window.__errors.length === 1", "the flow:error event", T);
        // Give a notice that should not come the time it would take to arrive.
        await Bun.sleep(200);

        expect(await page.evaluate<unknown[]>("window.__flashes")).toEqual([]);
      } finally {
        await page.close();
      }
    },
    T,
  );

  it(
    "reloads the page once when its snapshot no longer verifies, and the page works again",
    async () => {
      const page = await FlowBrowser.open(url, { timeout: T });
      try {
        await page.evaluate("window.__beforeReload = true");
        // A rotated key: every snapshot signed before it is now refused as invalid.
        Bun.env.APP_KEY = "test-app-key-bbbbbbbbbbbbbbbbbbbbbbbb";

        await page.click("#increment");
        await page.waitUntil(
          `window.__beforeReload === undefined && !!document.body && ` +
            `document.body.getAttribute("data-flow-connection") === "online"`,
          "the page to reload",
          T,
        );

        // The fresh page carries a snapshot signed with the new key, so actions work again.
        await page.click("#increment");
        await page.waitForText("#count", "1", T);
      } finally {
        Bun.env.APP_KEY = KEY;
        await page.close();
      }
    },
    T,
  );
});
