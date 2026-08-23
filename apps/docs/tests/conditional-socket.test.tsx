/** @jsxImportSource @zerotal/flow */
/**
 * A page with nothing interactive on it must not open a WebSocket.
 *
 * Every Flow page used to connect, unconditionally, at boot. For a page whose
 * components are all `static interactive = false` — a marketing page, a docs
 * article, a rendered report — that is a socket per visitor held open for the
 * life of the visit, on both ends, to carry nothing. Both paths that write to it
 * take a `FlowComponent`, so with none registered there is not even a frame that
 * *could* be sent.
 *
 * This is the half of render modes no server-side test can see. `FlowTest` and
 * SSR never open a transport, so "does this page connect" is invisible to them —
 * and the client would have gone on connecting for as long as nobody looked.
 *
 * The witness is Chrome's own count of sockets created, not anything the page
 * reports about itself. A client that decided not to connect and then connected
 * anyway would still show up here.
 */
import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { FlowBrowser, browserAvailability } from "@zerotal/testing/browser";
import { Component, expose } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Router } from "zerotal";

/** Static: no snapshot, no registration, nothing that can dispatch. */
class StaticBanner extends Component {
  static override interactive = false;
  override async render(): Promise<HtmlNode> {
    return <p id="banner">nothing to say</p>;
  }
}

/**
 * A page that is itself static, as well as its children.
 *
 * The page matters more than the child. A routed page is a component too, so a
 * page whose *children* are static but which is interactive itself still
 * registers, and still connects — which is what the first version of this test
 * discovered by failing.
 */
class StaticPage extends Component {
  static override interactive = false;
  override async render(): Promise<HtmlNode> {
    return (
      <div>
        <h1>Static</h1>
        {await this.child(StaticBanner)}
      </div>
    );
  }
}

/** One interactive component is enough to need the socket. */
class LivePage extends Component {
  @expose count = 0;
  @expose bump(): void {
    this.count++;
  }
  override async render(): Promise<HtmlNode> {
    return (
      <div>
        <span id="count">{String(this.count)}</span>
        <button id="go" onClick={this.bump}>
          bump
        </button>
      </div>
    );
  }
}

const availability = await browserAvailability();
let browser: FlowBrowser | undefined;

describe.skipIf(!availability.available)("the socket is conditional", () => {
  beforeAll(async () => {
    Bun.env.APP_KEY ??= "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
    Bun.env.DATABASE_URL = ":memory:";
    browser = await FlowBrowser.serve(() => import("../bootstrap/app.ts").then((m) => m.default), {
      setup: () => {
        Router.flow("/__socket-test/static", StaticPage);
        Router.flow("/__socket-test/live", LivePage);
      },
    });
  });

  afterAll(async () => {
    await browser?.stop();
  });

  test("a page of static components opens none", async () => {
    const page = await browser!.visit("/__socket-test/static");

    // Rendered, so this is a real page and not a blank one that trivially connects
    // to nothing.
    expect(await page.text("#banner")).toBe("nothing to say");

    // Give the bridge every chance to connect late before concluding it did not.
    await Bun.sleep(600);

    expect(page.transport().created).toBe(0);
    page.close();
  });

  test("a page with an interactive component still opens one", async () => {
    const page = await browser!.visit("/__socket-test/live");
    await page.waitForConnection();

    // The guard rail on the test above: if this were also zero, that one would be
    // passing because nothing connects any more, not because the page is static.
    expect(page.transport().created).toBeGreaterThan(0);
    expect(page.socketUpgraded()).toBe(true);
    page.close();
  });

  test("and that page's actions still work", async () => {
    // Deciding not to connect is only correct if deciding to connect still leaves
    // a working page.
    const page = await browser!.visit("/__socket-test/live");
    await page.waitForConnection();

    await page.click("#go");
    await page.waitForPatch();

    expect(await page.text("#count")).toBe("1");
    page.close();
  });
});
