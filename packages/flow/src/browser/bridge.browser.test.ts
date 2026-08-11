/**
 * The WebSocket bridge, end to end, in a real browser.
 *
 * This is the layer the rest of the suite cannot reach. `FlowTest` calls actions
 * directly — it never renders an attribute the client must find, never dispatches
 * a DOM event, never opens the socket. Every silent failure Flow has shipped
 * lived in that gap: a binding the compiler dropped, a click the bridge cancelled,
 * an action the server refused and mentioned only to `console.error`. A suite that
 * cannot see any of those is not measuring the thing that breaks.
 *
 * So these tests do what a user does. Chrome dispatches the click, the page's own
 * delegated listener picks it up, the frame crosses a real socket, the server runs
 * the action, and the patch comes back and changes the DOM. Each assertion below
 * fails if *any* link in that chain is broken, which is what makes them worth the
 * seconds they cost.
 *
 * They skip — rather than fail — where no browser is installed, so a contributor
 * without Chrome still gets a green suite.
 *
 * Each test launches its own browser. Sharing one across the file is faster and
 * works standalone, but Bun's test runner reaps child processes between tests, so
 * a shared Chrome dies mid-suite and every assertion after it hangs. A second per
 * test is the price of a harness that fails for real reasons only.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Application, Router } from "@zerotal/core";
import { FlowProvider } from "../provider/FlowProvider.ts";
import { FlowBrowser } from "./FlowBrowser.ts";
import { CounterPage } from "./__fixtures__/CounterPage.tsx";

/**
 * Browser work is slower than a unit test, so be explicit rather than inherit 5s —
 * and generous, because the monorepo sweep runs 25 packages at once and a Chrome
 * launch under that much CPU contention is far slower than the ~1s it takes idle.
 * A high ceiling costs nothing when things are fast: every wait polls and returns
 * as soon as its condition holds.
 */
const T = 60_000;

const hasBrowser = FlowBrowser.available();
const describeBrowser = hasBrowser ? describe : describe.skip;

let app: Application;
let url: string;

beforeAll(async () => {
  if (!hasBrowser) return;
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  Bun.env.APP_ENV = "test";

  Application._resetInstance();
  app = Application.create({ env: "web", providers: [FlowProvider] });
  // `Router.flow` is a macro FlowProvider installs in onRegister(), so the route
  // is registered after boot and before the server starts serving it.
  await app.boot();
  Router.flow("/counter", CounterPage);
  await app.start(0);

  const server = (app as unknown as { _static?: { port: number } })._static;
  url = `http://localhost:${server?.port}/counter`;
}, T);

afterAll(async () => {
  if (!hasBrowser) return;
  // `close()`, not `stop()`: the latter ends with `process.exit(0)`, which kills
  // the test run before Bun prints its summary — the suite passes and reports
  // nothing, which looks exactly like a suite that never ran.
  await app?.close?.();
}, T);

describeBrowser("Flow bridge — real browser, real socket", () => {
  it(
    "connects its WebSocket and marks the document online",
    async () => {
      const page = await FlowBrowser.open(url, { timeout: T });
      try {
        // `open` already waits for this; asserting it makes the precondition
        // explicit rather than implied by the next test passing.
        expect(await page.attr("body", "data-flow-connection")).toBe("online");
        expect(await page.text("#count")).toBe("0");
      } finally {
        await page.close();
      }
    },
    T,
  );

  it(
    "a real click runs the server action and patches the DOM back",
    async () => {
      const page = await FlowBrowser.open(url, { timeout: T });
      try {
        await page.click("#increment");
        await page.waitForText("#count", "1", T);

        await page.click("#increment");
        await page.waitForText("#count", "2", T);

        // A refused action is reported *only* here (B15), so an empty console is
        // part of the assertion, not a nicety.
        expect(page.consoleErrors()).toEqual([]);
        expect(page.pageErrors()).toEqual([]);
      } finally {
        await page.close();
      }
    },
    T,
  );

  it(
    "a typed value reaches the server through flow:model",
    async () => {
      const page = await FlowBrowser.open(url, { timeout: T });
      try {
        // The input must actually carry a binding — the field reports' commonest
        // silent failure was this attribute quietly going missing.
        expect(await page.attr("#name", "flow:model")).toBe("name");

        await page.fill("#name", "Ada");
        await page.click("#greet");
        // The greeting is built on the server from the model-bound field, so this
        // passing means the typed text crossed the socket rather than merely
        // sitting in the DOM.
        await page.waitForText("#greeting", "Hello, Ada!", T);

        expect(page.consoleErrors()).toEqual([]);
      } finally {
        await page.close();
      }
    },
    T,
  );

  it(
    "state survives across several round-trips in one session",
    async () => {
      const page = await FlowBrowser.open(url, { timeout: T });
      try {
        await page.fill("#name", "Grace");
        await page.click("#increment");
        await page.waitForText("#count", "1", T);

        // The name was typed before an unrelated action. If the snapshot
        // round-trip drops it, the greeting comes back empty — which is exactly
        // how a lost binding presents in production.
        await page.click("#greet");
        await page.waitForText("#greeting", "Hello, Grace!", T);
        expect(await page.text("#count")).toBe("1");
      } finally {
        await page.close();
      }
    },
    T,
  );
});
