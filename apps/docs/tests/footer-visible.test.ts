/**
 * The footer must not sit underneath a fixed rail.
 *
 * On a docs page it did, at both ends. The sidebar is
 * `fixed top-16 left-0 w-72 h-[calc(100vh-4rem)]` and the table of contents is
 * the same at `right-0 w-64`, so neither merely occupies a column — each paints
 * over whatever is beneath it at that x-position, for the whole viewport height.
 * The footer spanned the full width, so its first column read as "TATION" and
 * "rted", and the licence line was cut in half.
 *
 * It could not be scrolled into view either. A fixed rail does not scroll away,
 * so the covered text was unreachable rather than merely awkward — the whole
 * point of the footer is the links a reader wants *after* the page they came for,
 * and on every documentation page a third of them were behind the sidebar.
 *
 * Invisible from every other angle: the HTML is valid, every link is present in
 * the markup, and a server-side assertion sees a perfectly good footer. Only a
 * browser that can compare two boxes knows one is on top of the other, which is
 * what this is.
 */
import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { FlowBrowser, browserAvailability } from "@zerotal/testing/browser";

/** Wide enough for both rails: the sidebar appears at `md`, the ToC at `xl`. */
const DESKTOP = { width: 1440, height: 900 } as const;

const availability = await browserAvailability();
let browser: FlowBrowser | undefined;

describe.skipIf(!availability.available)("the footer clears the fixed rails", () => {
  beforeAll(async () => {
    Bun.env.APP_KEY ??= "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
    Bun.env.DATABASE_URL = ":memory:";
    browser = await FlowBrowser.serve(() => import("../bootstrap/app.ts").then((m) => m.default));
  });

  afterAll(async () => {
    await browser?.stop();
  });

  test("on a docs page, no footer link is covered by the sidebar or the ToC", async () => {
    const page = await browser!.visit("/docs/routing");
    await page.resize(DESKTOP.width, DESKTOP.height);

    const covered = await page.evaluate<string[]>(`
      (() => {
        const rails = ["#docs-sidebar", "#toc"]
          .map((s) => document.querySelector(s))
          .filter((el) => el && getComputedStyle(el).position === "fixed")
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0);

        const footer = document.querySelector("footer[aria-label='Site footer']");
        if (!footer) return ["no footer rendered"];

        const bad = [];
        for (const link of footer.querySelectorAll("a, p")) {
          const r = link.getBoundingClientRect();
          if (r.width === 0) continue;
          for (const rail of rails) {
            // Horizontal overlap is the whole test: the rails span the full
            // viewport height, so any shared x-range means covered.
            if (r.left < rail.right && r.right > rail.left) {
              bad.push((link.textContent || "").trim().slice(0, 40));
              break;
            }
          }
        }
        return bad;
      })()
    `);

    expect(covered, `footer content behind a fixed rail: ${covered.join(" | ")}`).toEqual([]);
  });

  test("the footer still spans the full width on a page with no sidebar", async () => {
    // The original intent, and worth keeping: the footer belongs to the page, not
    // to the documentation tree. Offsetting it everywhere would have fixed the
    // bug and made the homepage worse.
    const page = await browser!.visit("/");
    await page.resize(DESKTOP.width, DESKTOP.height);

    const left = await page.evaluate<number>(
      `document.querySelector("footer[aria-label='Site footer']").getBoundingClientRect().left`,
    );
    expect(left).toBe(0);
  });

  test("every footer link is reachable, not merely present in the markup", async () => {
    const page = await browser!.visit("/docs/routing");
    await page.resize(DESKTOP.width, DESKTOP.height);

    // `elementFromPoint` at each link's centre: if a rail is on top, the browser
    // hands back the rail. This is the reader's experience rather than a
    // rectangle comparison, and it catches a z-index fix that moves nothing.
    const blocked = await page.evaluate<string[]>(`
      (() => {
        const footer = document.querySelector("footer[aria-label='Site footer']");
        const out = [];
        for (const a of footer.querySelectorAll("a")) {
          const r = a.getBoundingClientRect();
          if (r.width === 0) continue;
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (hit && !footer.contains(hit)) out.push((a.textContent || "").trim());
        }
        return out;
      })()
    `);

    expect(blocked, `footer links a click cannot reach: ${blocked.join(", ")}`).toEqual([]);
  });
});
