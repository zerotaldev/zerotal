/**
 * No page may scroll sideways on a phone.
 *
 * The component catalogue did, by 356 pixels at 375 wide. Each component's
 * preview is a `not-prose` flex row with `p-10` and no wrap, so a table, a wide
 * select or a long button group pushed the row past the viewport — and because
 * the block opts out of the prose styles, nothing above it constrained the width.
 *
 * It is invisible from every other angle. The HTML is valid, the page is perfect
 * at 1280, and no server-side assertion can see a layout. Only a browser at a
 * phone's width can, which is what this is.
 *
 * The pages here are the ones a reader arrives on: the homepage, the docs
 * overview, a normal guide, and the catalogue that broke.
 */
import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { FlowBrowser, browserAvailability } from "@zerotal/testing/browser";

/** An iPhone SE — the narrowest width worth supporting, so the strictest case. */
const PHONE = { width: 375, height: 812 } as const;

const availability = await browserAvailability();
let browser: FlowBrowser | undefined;

const PAGES = [
  { path: "/", label: "the homepage" },
  { path: "/docs", label: "the documentation overview" },
  { path: "/docs/getting-started", label: "a guide page" },
  { path: "/docs/components", label: "the component catalogue" },
  { path: "/showcase/flow", label: "the showcase overview" },
];

describe.skipIf(!availability.available)("no horizontal overflow at 375px", () => {
  beforeAll(async () => {
    Bun.env.APP_KEY ??= "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
    Bun.env.DATABASE_URL = ":memory:";
    browser = await FlowBrowser.serve(() => import("../bootstrap/app.ts").then((m) => m.default));
  });

  afterAll(async () => {
    await browser?.stop();
  });

  for (const { path, label } of PAGES) {
    test(`${label} fits the viewport`, async () => {
      const page = await browser!.visit(path);
      await page.resize(PHONE.width, PHONE.height);

      // The layout viewport, and it is the primary assertion — not a sanity check
      // on the resize.
      //
      // Measured against the broken catalogue, `scrollWidth - innerWidth` was
      // **zero**: content wider than the screen expands the layout viewport to
      // contain it, so both numbers grew together and the page looked contained
      // while sitting at 725px inside a 375px device. Overflow is only visible by
      // asking whether the viewport is still the size of the screen.
      const viewport = await page.evaluate<number>("window.innerWidth");
      expect(viewport).toBe(PHONE.width);

      // Kept as well, for the other shape of the bug: an element that overflows
      // without widening the viewport, which this would catch and the check above
      // would not.
      const overflow = await page.horizontalOverflow();
      if (overflow > 0) {
        // Name the offenders in the failure. A bare "204px" on a page of six
        // thousand nodes tells whoever reads it nothing they can act on.
        const worst = await page.overflowingElements();
        throw new Error(
          `${path} overflows by ${overflow}px at ${PHONE.width}px:
  ${worst.join("
  ")}`,
        );
      }
    });
  }
});
