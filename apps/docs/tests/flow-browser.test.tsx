/** @jsxImportSource @zerotal/flow */
/**
 * The bugs that only a browser can see.
 *
 * Every one of these passes `FlowTest` and passes SSR. They are here because the
 * failure mode Flow keeps shipping has one shape — the HTML is fine and the
 * transport is dead — and nothing server-side can tell the difference. Three of
 * the four reproduce on the commit before their fix; the fourth is the guard that
 * stops the suite going quietly green.
 *
 * Runs against the docs app, which is a real Flow application with a real
 * `FlowProvider`, plus two fixture pages registered only for this file.
 */
import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { FlowBrowser, browserAvailability, browserRequired } from "@zerotal/testing/browser";
import { Component, expose } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Router } from "zerotal";

// ── Fixtures ────────────────────────────────────────────────────────────────────

/**
 * A child rendered without a `key`, deliberately.
 *
 * Its props differ per row, which is what content-addressing needs in order to
 * tell the rows apart after the list shifts.
 */
class Row extends Component {
  @expose label = "";

  override async render(): Promise<HtmlNode> {
    return <li class="row">{this.label}</li>;
  }
}

/**
 * The keyless-child reproduction (B40).
 *
 * `remove()` drops the first item. Before the fix the ids were positional, so
 * every surviving row inherited its neighbour's id, the parent emitted them as
 * already-mounted stubs, and the last row rendered blank. The headings stayed
 * correct throughout, which is exactly why no server-side test caught it.
 */
class KeylessListPage extends Component {
  static title = "keyless list";
  @expose items = ["alpha", "bravo", "charlie"];

  @expose remove(): void {
    this.items = this.items.slice(1);
  }

  override async render(): Promise<HtmlNode> {
    // `child()` is async, so the map has to be awaited before it reaches JSX.
    const rows = await Promise.all(
      this.items.map((label) => this.child(Row, { props: { label } })),
    );

    return (
      <div>
        <h1 id="heading">Rows: {this.items.length}</h1>
        <button id="drop" onClick={this.remove}>
          drop first
        </button>
        <ul id="list">{rows}</ul>
      </div>
    );
  }
}

/** A server action that proves the round-trip reached the server, not just the DOM. */
class BumpPage extends Component {
  static title = "bump";
  @expose count = 0;
  @expose serverSeen = 0;

  @expose bump(): void {
    this.count++;
    this.serverSeen++;
  }

  override async render(): Promise<HtmlNode> {
    return (
      <div>
        <p id="count">{this.count}</p>
        <p id="server">{this.serverSeen}</p>
        <button id="go" onClick={this.bump}>
          bump
        </button>
        <button id="client" onClick={() => this.count++}>
          client only
        </button>
      </div>
    );
  }
}

// ── Harness ─────────────────────────────────────────────────────────────────────

const availability = await browserAvailability();
let browser: FlowBrowser;

/**
 * The guard, and it runs whether or not a browser is present.
 *
 * A browser suite that skips itself in CI is worse than no suite: it reports
 * green for exactly the failures it exists to catch. Locally it is a skip,
 * because a developer on Windows cannot currently spawn one (see the harness
 * docs) and should not be blocked by that.
 */
test("a browser is reachable, so this suite is not silently skipped", () => {
  if (!browserRequired()) {
    if (!availability.available) console.warn(`[FlowBrowser] skipping: ${availability.reason}`);
    return;
  }
  expect(availability.reason).toBeString();
  expect(availability.available).toBe(true);
});

describe.skipIf(!availability.available)("FlowBrowser — regressions", () => {
  beforeAll(async () => {
    Bun.env.APP_KEY ??= "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
    Bun.env.DATABASE_URL = ":memory:";
    browser = await FlowBrowser.serve(() => import("../bootstrap/app.ts").then((m) => m.default), {
      setup: () => {
        Router.flow("/__browser-test/keyless", KeylessListPage);
        Router.flow("/__browser-test/bump", BumpPage);
      },
    });
  });

  afterAll(async () => {
    await browser?.stop();
  });

  // ── The transport itself ──────────────────────────────────────────────────────

  test("the socket reaches open, and the bridge says so", async () => {
    const page = await browser.visit("/__browser-test/bump");
    await page.waitForConnection();

    // Two independent witnesses: what Chrome saw on the wire, and what the
    // client concluded. A client that degraded silently agrees with neither.
    expect(page.socketUpgraded()).toBe(true);
    expect(page.transport().statuses).toContain(101);
    expect(await page.connection()).toBe("online");
    page.close();
  });

  test("a server action produces a patch, and the server actually ran it", async () => {
    const page = await browser.visit("/__browser-test/bump");
    await page.waitForConnection();

    await page.click("#go");
    await page.waitForPatch();

    expect(await page.text("#count")).toBe("1");
    // The half SSR cannot fake: the count could rise client-side and the server
    // never hear about it, which is the transport-dead case exactly.
    expect(await page.text("#server")).toBe("1");
    page.close();
  });

  test("a client expression re-renders without running the server action", async () => {
    const page = await browser.visit("/__browser-test/bump");
    await page.waitForConnection();

    await page.click("#client");
    await page.waitFor(`document.querySelector("#count").textContent === "1"`);

    // The action did not run — this is the claim worth making, and the one the
    // DOM alone cannot support, since `count` reaching 1 looks identical either way.
    expect(await page.text("#server")).toBe("0");

    // It still round-trips, which is not what "client expression" suggests: the
    // bridge sends `$rerender` carrying `updates: { count: 1 }` and the server
    // answers with a patch. Asserted on the wire because it is the difference
    // between "no server involvement" (false) and "no *action* ran" (true).
    const sent = page.transport().frames.filter((f) => f.direction === "sent");
    expect(sent.some((f) => f.payload.includes(`"method":"$rerender"`))).toBe(true);
    expect(sent.some((f) => f.payload.includes(`"method":"bump"`))).toBe(false);
    page.close();
  });

  // ── B40: the keyless child ────────────────────────────────────────────────────

  test("a keyless child list keeps its rows when the list shifts", async () => {
    const page = await browser.visit("/__browser-test/keyless");
    await page.waitForConnection();

    expect(await page.count("#list .row")).toBe(3);

    await page.click("#drop");
    await page.waitForPatch();

    // The heading was always right — that is what made this bug expensive.
    await page.waitFor(`document.querySelector("#heading").textContent.includes("2")`);
    expect(await page.count("#list .row")).toBe(2);

    // The assertion that actually fails on the old code: the rows are present
    // *and* carry their text. Positional ids left the last one blank.
    const labels = await page.evaluate<string[]>(
      `Array.from(document.querySelectorAll("#list .row")).map((el) => el.textContent.trim())`,
    );
    expect(labels).toEqual(["bravo", "charlie"]);
    expect(labels.every((text) => text.length > 0)).toBe(true);
    page.close();
  });

  test("the rows survive a second shift, not just the first", async () => {
    const page = await browser.visit("/__browser-test/keyless");
    await page.waitForConnection();

    await page.click("#drop");
    await page.waitForPatch();
    await page.click("#drop");
    await page.waitForPatch();

    await page.waitFor(`document.querySelectorAll("#list .row").length === 1`);
    expect(await page.text("#list .row")).toBe("charlie");
    page.close();
  });
});
