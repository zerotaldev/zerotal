/**
 * `@zerotal/testing/browser` — drive a real page against a real server.
 *
 * Separate from the main entry point on purpose: this one reaches for a headless
 * browser, and the overwhelming majority of tests neither need one nor should pay
 * to find out whether it is there.
 *
 * `FlowTest` mounts a component and drives its server-side lifecycle. It cannot
 * open the WebSocket bridge, which is where every silent failure Flow has shipped
 * has lived: SSR renders, snapshot assertions pass, the suite is green, and the
 * app does nothing in a browser. `FlowBrowser` is the harness that sees that.
 *
 * @example
 * ```ts
 * import { FlowBrowser } from "@zerotal/testing/browser";
 *
 * const availability = await FlowBrowser.availability();
 *
 * describe.skipIf(!availability.available)("settings", () => {
 *   let browser: FlowBrowser;
 *   beforeAll(async () => { browser = await FlowBrowser.serve(bootstrap); });
 *   afterAll(async () => { await browser.stop(); });
 *
 *   it("saves", async () => {
 *     const page = await browser.visit("/settings");
 *     await page.waitForConnection();
 *     await page.click('[flow\\:click="save"]');
 *     await page.waitForPatch();
 *     expect(await page.text("#status")).toBe("Saved");
 *   });
 * });
 * ```
 *
 * @packageDocumentation
 */

export { FlowBrowser, BrowserPage } from "./browser/FlowBrowser.ts";
export type { FlowBrowserOptions, ObservedFrame, TransportReport } from "./browser/FlowBrowser.ts";
export { browserAvailability, browserRequired, CDP_URL_ENV } from "./browser/chrome.ts";
export type { BrowserAvailability } from "./browser/chrome.ts";
