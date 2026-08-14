/** @jsxImportSource @zerotal/flow */
/**
 * The island guarantee, and B16 — both pinned in a real browser.
 *
 * An island that re-renders must not re-run its parent's `render()`. That is the
 * whole feature, and it is the easiest thing to lose to a convenience refactor,
 * because losing it changes no output: the page looks identical whether the
 * parent re-rendered or not. So these count `render()` invocations rather than
 * inspecting HTML.
 *
 * The counters are module-scoped and read directly, not through the DOM — the
 * suite and the server share a process, so this is the server's own tally.
 */
import { beforeAll, afterAll, beforeEach, describe, test, expect } from "bun:test";
import { FlowBrowser, browserAvailability, browserRequired } from "@zerotal/testing/browser";
import { Component, expose } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Router } from "zerotal";

const renders = { parent: 0, child: 0, sibling: 0 };

class Card extends Component {
  @expose label = "";
  @expose count = 0;

  @expose bump(): void {
    this.count++;
  }

  override async render(): Promise<HtmlNode> {
    renders.child++;
    return (
      <div class="card">
        <span class="label">{this.label}</span>
        <span class="count">{this.count}</span>
        <button class="bump" onClick={this.bump}>
          bump
        </button>
      </div>
    );
  }
}

class Sibling extends Component {
  @expose n = 0;

  override async render(): Promise<HtmlNode> {
    renders.sibling++;
    return <p class="sibling">{this.n}</p>;
  }
}

class IslandsPage extends Component {
  static title = "islands";
  @expose parentTicks = 0;

  @expose tick(): void {
    this.parentTicks++;
  }

  override async render(): Promise<HtmlNode> {
    renders.parent++;
    const card = await this.child(Card, { key: "a", props: { label: "A" } });
    const sibling = await this.child(Sibling, { key: "b" });
    return (
      <div>
        <p id="ticks">{this.parentTicks}</p>
        <button id="tick" onClick={this.tick}>
          tick
        </button>
        {card}
        {sibling}
      </div>
    );
  }
}

/**
 * B16, in its reported shape: a client expression writes an `@expose` prop from a
 * data attribute, and `render()` reads that prop in a *conditional*. The reported
 * failure was that the row never expanded, with nothing logged anywhere.
 */
class SelectionPage extends Component {
  static title = "selection";
  @expose selected = 0;

  override async render(): Promise<HtmlNode> {
    const rows = [1, 2, 3];
    return (
      <ul>
        {rows.map((id) => (
          <li>
            <button
              class="open"
              data-value={String(id)}
              onClick={() => (this.selected = Number($el.dataset.value))}
            >
              open {id}
            </button>
            {this.selected === id ? <div class="detail">detail for {id}</div> : null}
          </li>
        ))}
      </ul>
    );
  }
}

const availability = await browserAvailability();
let browser: FlowBrowser;

test("a browser is reachable, so this suite is not silently skipped", () => {
  if (!browserRequired()) return;
  expect(availability.available).toBe(true);
});

describe.skipIf(!availability.available)("islands and B16", () => {
  beforeAll(async () => {
    Bun.env.APP_KEY ??= "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
    Bun.env.DATABASE_URL = ":memory:";
    browser = await FlowBrowser.serve(() => import("../bootstrap/app.ts").then((m) => m.default), {
      setup: () => {
        Router.flow("/__islands/page", IslandsPage);
        Router.flow("/__islands/selection", SelectionPage);
      },
    });
  });

  afterAll(async () => {
    await browser?.stop();
  });

  beforeEach(() => {
    renders.parent = 0;
    renders.child = 0;
    renders.sibling = 0;
  });

  test("an island re-renders without running its parent's render()", async () => {
    const page = await browser.visit("/__islands/page");
    await page.waitForConnection();

    // The initial GET renders everything once. Reset and act.
    renders.parent = 0;
    renders.child = 0;
    renders.sibling = 0;

    await page.click(".bump");
    await page.waitForPatch();
    await page.waitFor(`document.querySelector(".count").textContent === "1"`);

    // The entire feature, stated as a number.
    expect(renders.child).toBe(1);
    expect(renders.parent).toBe(0);
    expect(renders.sibling).toBe(0);
    page.close();
  });

  test("a parent re-render does not re-run an already-mounted child's render()", async () => {
    const page = await browser.visit("/__islands/page");
    await page.waitForConnection();

    renders.parent = 0;
    renders.child = 0;
    renders.sibling = 0;

    await page.click("#tick");
    await page.waitForPatch();
    await page.waitFor(`document.querySelector("#ticks").textContent === "1"`);

    // The parent runs; the children are emitted as stubs and never rendered.
    expect(renders.parent).toBe(1);
    expect(renders.child).toBe(0);
    expect(renders.sibling).toBe(0);
    page.close();
  });

  test("the child's live DOM survives its parent re-rendering", async () => {
    const page = await browser.visit("/__islands/page");
    await page.waitForConnection();

    await page.click(".bump");
    await page.waitForPatch();
    await page.waitFor(`document.querySelector(".count").textContent === "1"`);

    await page.click("#tick");
    await page.waitForPatch();
    await page.waitFor(`document.querySelector("#ticks").textContent === "1"`);

    // The stub carries no markup, so if the morph did not preserve the island this
    // is where the card would go blank.
    expect(await page.text(".count")).toBe("1");
    expect(await page.text(".label")).toBe("A");
    page.close();
  });

  test("B16: a client write to an @expose prop re-renders the conditional it drives", async () => {
    const page = await browser.visit("/__islands/selection");
    await page.waitForConnection();

    expect(await page.count(".detail")).toBe(0);

    // No server action is dispatched here — the handler is a client expression.
    await page.click(".open");
    await page.waitForPatch();

    await page.waitForCount(".detail", 1);
    expect(await page.text(".detail")).toBe("detail for 1");
    page.close();
  });
});
