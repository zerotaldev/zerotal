/**
 * A Flow page under a strict Content-Security-Policy, in a real browser.
 *
 * The policy is the one the CSP-safe docs recommend: scripts from the page's own
 * origin only — no nonce, no `'unsafe-inline'` and no `'unsafe-eval'`. It holds
 * only if every script Flow puts on the page is a same-origin file and the
 * runtime evaluates nothing, and neither can be shown without a browser
 * enforcing the policy: a blocked script is not an error the server sees, and
 * the page still renders, so a broken setup looks exactly like a working one
 * until somebody clicks.
 *
 * So this clicks. The counter only moves if the route table and the CSP runtime
 * both loaded from the app's own origin, the runtime ran without `eval`, and the
 * socket the policy's `'self'` allows carried the action.
 *
 * Skips where no browser is installed, like the suites beside it.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Application, Router, SecureHeadersMiddleware } from "@zerotal/core";
import { FlowProvider } from "../provider/FlowProvider.ts";
import { FlowBrowser } from "./FlowBrowser.ts";
import { CounterPage } from "./__fixtures__/CounterPage.tsx";

const T = 60_000;

const POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'";

const hasBrowser = FlowBrowser.available();
const describeBrowser = hasBrowser ? describe : describe.skip;

let app: Application;
let url: string;
const priorCspSafe = Bun.env["ZT_FLOW_CSP_SAFE"];

beforeAll(async () => {
  if (!hasBrowser) return;
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  Bun.env.APP_ENV = "test";
  Bun.env["ZT_FLOW_CSP_SAFE"] = "true";

  Application._resetInstance();
  app = Application.create({ env: "web", providers: [FlowProvider] });
  await app.boot();
  Router.flow("/csp/counter", CounterPage, [
    SecureHeadersMiddleware.with({ contentSecurityPolicy: POLICY }),
  ]);
  await app.start(0);

  const server = (app as unknown as { _static?: { port: number } })._static;
  url = `http://localhost:${server?.port}/csp/counter`;
}, T);

afterAll(async () => {
  if (priorCspSafe === undefined) delete Bun.env["ZT_FLOW_CSP_SAFE"];
  else Bun.env["ZT_FLOW_CSP_SAFE"] = priorCspSafe;
  if (!hasBrowser) return;
  await app?.close?.();
}, T);

describeBrowser("Flow under script-src 'self'", () => {
  it(
    "loads the CSP runtime and the route table from its own origin, and works",
    async () => {
      const policy = (await fetch(url)).headers.get("content-security-policy");
      expect(policy).toBe(POLICY);

      const page = await FlowBrowser.open(url, { timeout: T });
      try {
        // The control: the policy is enforced, so an inline script does not run.
        // Without it, a header that never reached the browser would pass this test.
        const inlineRan = await page.evaluate<boolean>(
          `(() => { const s = document.createElement("script"); s.textContent = "window.__inline = true"; ` +
            `document.body.appendChild(s); return window.__inline === true; })()`,
        );
        expect(inlineRan).toBe(false);

        const scripts = await page.evaluate<string[]>(
          `[...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src"))`,
        );
        expect(scripts).toHaveLength(2);
        expect(scripts[0]).toMatch(/^\/__flow\/routes\/[0-9a-f]{16}\.js$/);
        expect(scripts[1]).toMatch(/^\/__flow\/assets\/runtime\.csp\.[0-9a-f]{16}\.js$/);
        // Both ran: the table is installed and Alpine is up.
        expect(await page.evaluate<boolean>(`typeof window.__zerotalRoutes === "object"`)).toBe(
          true,
        );
        expect(await page.evaluate<boolean>(`typeof window.Alpine === "object"`)).toBe(true);

        await page.click("#increment");
        await page.waitForText("#count", "1", T);
        // An `eval` the policy refused would surface here as an EvalError.
        expect(page.pageErrors()).toEqual([]);
        expect(page.consoleErrors()).toEqual([]);
      } finally {
        await page.close();
      }
    },
    T,
  );
});
