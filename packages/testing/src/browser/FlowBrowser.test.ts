import { describe, expect, it } from "bun:test";
import { BrowserPage, type TransportReport } from "./FlowBrowser.ts";

/**
 * `waitForPatch` against a scripted view and transport, with no browser.
 *
 * The race it guards against: the page marks itself `online` when the socket opens, and the
 * server sends `{"type":"ready"}` just after. A click in between saw `ready` arrive behind it,
 * took it for the click's patch, and the test read the page before the change landed. That
 * failed in CI about one run in several; here the order is fixed, so it fails every time.
 */
function setup(): {
  page: BrowserPage;
  report: TransportReport;
  calls: string[];
} {
  const report: TransportReport = {
    created: 1,
    upgraded: 1,
    statuses: [101],
    errored: false,
    frames: [],
  };
  const calls: string[] = [];
  const view = {
    click: async (selector: string) => void calls.push(`click ${selector}`),
    evaluate: async (expression: string) => {
      calls.push(`evaluate ${expression}`);
      return expression.includes("flowConnection") ? "online" : undefined;
    },
  } as unknown as Bun.WebView;
  return { page: new BrowserPage(view, report, 400), report, calls };
}

const received = (payload: unknown) => ({
  direction: "received" as const,
  payload: JSON.stringify(payload),
});

describe("BrowserPage.waitForPatch", () => {
  it("does not take the connection's ready frame for an action's answer", async () => {
    const { page, report } = setup();
    await page.click("#go");
    report.frames.push(received({ type: "ready", dev: false }));

    await expect(page.waitForPatch(150)).rejects.toThrow("No patch arrived within 150ms");
  });

  it("returns once a frame that answers the action arrives, even behind ready", async () => {
    const { page, report } = setup();
    await page.click("#go");
    report.frames.push(received({ type: "ready", dev: false }));
    setTimeout(() => report.frames.push(received({ type: "patch", component: "c1" })), 50);

    await page.waitForPatch();
    expect(report.frames).toHaveLength(2);
  });

  it("gives the page a turn to apply the frame before returning", async () => {
    const { page, report, calls } = setup();
    await page.click("#go");
    report.frames.push(received({ type: "patch", component: "c1" }));

    await page.waitForPatch();
    expect(calls).toEqual(["click #go", "evaluate void 0"]);
  });

  it("ignores frames from before the action", async () => {
    const { page, report } = setup();
    report.frames.push(received({ type: "patch", component: "c1" }));
    await page.click("#go");

    await expect(page.waitForPatch(150)).rejects.toThrow("No patch arrived");
  });

  it("counts any answer, not only a patch: an action may only redirect or flash", async () => {
    const { page, report } = setup();
    await page.click("#go");
    report.frames.push(received({ type: "redirect", to: "/done" }));

    await page.waitForPatch();
  });
});
