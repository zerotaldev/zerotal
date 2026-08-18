/**
 * Feature 5 in a real browser: the author saves an edit.
 *
 * The smoke suite covers this and passes, and the page was still broken. That
 * suite mounts the component in-process, so `@locked issue` is the model object
 * it was assigned — it never crosses the wire. In a browser it does: the
 * snapshot carries the prop out and brings it back, and without a `static
 * models` declaration it comes back as a plain object. `Gate` resolves a policy
 * from the model's class, a bare `Object` has none, and the gate fails closed —
 * so `Gate.authorize("update", this.issue)` threw 403 at the author of the
 * issue, every time.
 *
 * The assertion is the saved title, read back after a reload. Anything less
 * would pass against an optimistic patch that never reached the database.
 */
import { test, beforeAll, afterAll, expect } from "bun:test";
import { FlowBrowser } from "@zerotal/flow/browser";
import { BASE, startServer, stopServer, signIn, createIssue } from "./support/browser.ts";

const maybe = FlowBrowser.available() ? test : test.skip;

beforeAll(() => startServer(import.meta.dir + "/.."), 60_000);
afterAll(() => stopServer());

maybe(
  "the author edits an issue and the change survives a reload",
  async () => {
    const page = await FlowBrowser.open(BASE + "/login");
    try {
      await signIn(page);
      const href = await createIssue(page, "Edit fixture " + Date.now());

      await page.goto(BASE + href + "/edit");
      await page.waitUntil("!!document.querySelector('#title')", "the edit form", 15000);

      const title = "Edited " + Date.now();
      await page.fill("#title", title);
      // Scoped to the form: the layout's "Sign out" is also a submit button and
      // comes first in the document, so the bare selector signed the test out.
      await page.click('form:has(#title) button[type="submit"]');

      // Back on the detail page with the new title. A 403 from the gate would
      // stop here — which is exactly what it used to do.
      await page.waitUntil(
        "!!document.body && document.body.textContent.indexOf(" + JSON.stringify(title) + ") !== -1",
        "the new title to render after saving",
        20000,
      );

      // Reloaded, so the assertion is about the database and not about a patch
      // the client drew from its own optimistic state.
      await page.goto(BASE + href);
      await page.waitUntil(
        "!!document.body && document.body.textContent.indexOf(" + JSON.stringify(title) + ") !== -1",
        "the new title to survive a reload",
        20000,
      );

      expect(page.pageErrors()).toEqual([]);
    } finally {
      await page.close();
    }
  },
  120_000,
);
