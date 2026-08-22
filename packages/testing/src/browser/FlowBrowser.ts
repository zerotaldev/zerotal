import { createTestApp, type TestApp } from "../TestApp.ts";
import { backendOption, browserAvailability } from "./chrome.ts";
import type { Application } from "@zerotal/core";

/**
 * Read a CDP event's params.
 *
 * `Bun.WebView` delivers each event as an `Event` carrying the CDP params on
 * `data`, but neither `addEventListener` overload types that usefully here:
 * the generic one resolves `MessageEvent` to its *constructor* once lib.dom is
 * in scope, and the plain one wants a bare `EventListener`. A predicate keeps
 * the listener assignable and states the assumption in one place instead of
 * casting at every call site.
 */
function cdpParams<T>(event: Event): event is Event & { readonly data: T } {
  return "data" in event;
}

/** A WebSocket frame the page sent or received, as CDP reported it. */
export interface ObservedFrame {
  direction: "sent" | "received";
  payload: string;
}

/** What the transport did, from outside the page. */
export interface TransportReport {
  /** Sockets the page opened. */
  created: number;
  /** Handshakes that answered `101`. Zero means the socket never opened. */
  upgraded: number;
  /** Status of each handshake response that arrived. */
  statuses: number[];
  /** True when Chrome reported a frame-level failure. */
  errored: boolean;
  frames: ObservedFrame[];
}

/** Options for {@link FlowBrowser.serve}. */
export interface FlowBrowserOptions {
  /** Milliseconds any `waitFor*` will wait before giving up. */
  timeout?: number;
  /**
   * Register routes, before the server starts.
   *
   * Passed straight to `createTestApp`, which runs it after the state reset and
   * before `start()` so the routes are compiled into the server. A suite that
   * needs a fixture page — one deliberately built to reproduce a bug — registers
   * it here instead of adding it to the application under test.
   */
  setup?: () => void;
}

const DEFAULT_TIMEOUT = 5_000;
/** Gap between polls of an in-page condition. Not a sleep the assertions depend on. */
const POLL_MS = 25;

/**
 * A real page, driven against a real server.
 *
 * Obtained from {@link FlowBrowser.visit}. Every method that acts on the page
 * records the transport frame count first, so {@link waitForPatch} can wait for
 * a frame that arrived *after* the action rather than one already in flight.
 */
export class BrowserPage {
  private readonly _view: Bun.WebView;
  private readonly _report: TransportReport;
  private readonly _timeout: number;
  private _framesAtAction = 0;
  private _closed = false;

  /** @internal Constructed by {@link FlowBrowser.visit}. */
  constructor(view: Bun.WebView, report: TransportReport, timeout: number) {
    this._view = view;
    this._report = report;
    this._timeout = timeout;
  }

  // ── Reading the page ────────────────────────────────────────────────────────

  /**
   * Evaluate an expression in the page.
   *
   * `Bun.WebView` allows only one evaluation in flight per view, so every read
   * here is serial by construction — never wrap these in `Promise.all`.
   */
  async evaluate<T = unknown>(expression: string): Promise<T> {
    this._assertOpen();
    return this._view.evaluate<T>(expression);
  }

  /**
   * Resize the viewport, for the failures that only exist at a particular width.
   *
   * Horizontal overflow is the obvious one: a page can be flawless at 1280 and
   * scroll sideways at 375 because one element inside a `not-prose` block has no
   * width constraint. Nothing server-side can see it, and neither can a browser
   * test that never leaves the default window size.
   */
  async resize(width: number, height: number): Promise<this> {
    this._assertOpen();
    await this._view.resize(width, height);
    return this;
  }

  /**
   * How far the document can scroll sideways beyond the viewport, in pixels.
   *
   * `0` is the only healthy answer. `documentElement.scrollWidth` rather than
   * `body`'s, because an overflowing child can push the scrollable area wider
   * than the body box without the body itself ever being wide.
   */
  async horizontalOverflow(): Promise<number> {
    return this.evaluate<number>(
      "Math.max(0, document.documentElement.scrollWidth - window.innerWidth)",
    );
  }

  /** `textContent` of the first match, trimmed. `null` when nothing matches. */
  async text(selector: string): Promise<string | null> {
    return this.evaluate<string | null>(
      `(() => { const el = document.querySelector(${quote(selector)});
                return el ? el.textContent.trim() : null; })()`,
    );
  }

  /** `innerHTML` of the first match. `null` when nothing matches. */
  async html(selector: string): Promise<string | null> {
    return this.evaluate<string | null>(
      `(() => { const el = document.querySelector(${quote(selector)});
                return el ? el.innerHTML : null; })()`,
    );
  }

  /** How many elements match. The assertion the keyless-child bug needed. */
  async count(selector: string): Promise<number> {
    return this.evaluate<number>(`document.querySelectorAll(${quote(selector)}).length`);
  }

  /** An attribute of the first match, or `null`. */
  async attribute(selector: string, name: string): Promise<string | null> {
    return this.evaluate<string | null>(
      `(() => { const el = document.querySelector(${quote(selector)});
                return el ? el.getAttribute(${quote(name)}) : null; })()`,
    );
  }

  /**
   * The connection state the bridge stamped on `<body>`.
   *
   * This is the single most valuable thing the harness can read: it is the
   * difference between "the app is broken" and "the app is fine" in every
   * failure this harness exists to catch. `"online"`, `"offline"`, or `null`
   * before the bridge has run.
   */
  async connection(): Promise<string | null> {
    return this.evaluate<string | null>("document.body.dataset.flowConnection ?? null");
  }

  /** The page's current URL — for asserting a redirect actually happened. */
  async url(): Promise<string> {
    return this.evaluate<string>("location.pathname + location.search");
  }

  // ── Acting on the page ──────────────────────────────────────────────────────

  /** Click the first element matching `selector`, as a real trusted click. */
  async click(selector: string): Promise<this> {
    this._assertOpen();
    this._markAction();
    await this._view.click(selector);
    return this;
  }

  /**
   * Click the match to focus it, then type into it.
   *
   * `WebView.type()` types into whatever holds focus, so the click is what
   * chooses the field — the same two steps a person performs.
   */
  async type(selector: string, text: string): Promise<this> {
    this._assertOpen();
    this._markAction();
    await this._view.click(selector);
    await this._view.type(text);
    return this;
  }

  /** Press a key, with the page's current focus. */
  async press(key: string): Promise<this> {
    this._assertOpen();
    this._markAction();
    await this._view.press(key);
    return this;
  }

  // ── Waiting ─────────────────────────────────────────────────────────────────

  /**
   * Wait until the page has received a WebSocket frame caused by the last action.
   *
   * This is the primitive, and it is deliberately not a sleep: the frame count is
   * captured when the action is dispatched, and this waits for it to rise. A
   * harness whose assertions race the transport produces flaky tests, and a flaky
   * browser suite gets deleted.
   *
   * Throws on timeout rather than returning false, so a test that meant to observe
   * a patch fails where the patch did not arrive instead of three assertions later.
   */
  async waitForPatch(timeout = this._timeout): Promise<this> {
    const before = this._framesAtAction;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (this._receivedCount() > before) return this;
      await Bun.sleep(POLL_MS);
    }
    throw new Error(
      `[FlowBrowser] No patch arrived within ${timeout}ms. ` +
        `Connection is "${await this.connection()}"; ` +
        `${this._report.upgraded} socket(s) upgraded, ` +
        `${this._receivedCount()} frame(s) received in total.`,
    );
  }

  /** Wait until an expression in the page is truthy. */
  async waitFor(expression: string, timeout = this._timeout): Promise<this> {
    const deadline = Date.now() + timeout;
    let last: unknown;
    while (Date.now() < deadline) {
      last = await this.evaluate(expression);
      if (last) return this;
      await Bun.sleep(POLL_MS);
    }
    throw new Error(
      `[FlowBrowser] Timed out after ${timeout}ms waiting for: ${expression}\n` +
        `  last value: ${JSON.stringify(last)}; connection is "${await this.connection()}".`,
    );
  }

  /** Wait until the bridge reports `online`. */
  async waitForConnection(timeout = this._timeout): Promise<this> {
    return this.waitFor(`document.body.dataset.flowConnection === "online"`, timeout);
  }

  /** Wait until `selector` matches at least `n` elements. */
  async waitForCount(selector: string, n: number, timeout = this._timeout): Promise<this> {
    return this.waitFor(
      `document.querySelectorAll(${quote(selector)}).length >= ${String(n)}`,
      timeout,
    );
  }

  // ── The transport, from outside the page ────────────────────────────────────

  /**
   * What Chrome saw on the wire.
   *
   * The page cannot lie about this: a client that silently degraded and called
   * itself fine still shows zero upgraded sockets here.
   */
  transport(): TransportReport {
    return {
      ...this._report,
      statuses: [...this._report.statuses],
      frames: [...this._report.frames],
    };
  }

  /**
   * Whether a WebSocket handshake answered `101`.
   *
   * Asserted as "a 101 was observed", never as "the status was not 403": a
   * refused upgrade does not arrive as a handshake response at all — Chrome
   * reports a frame error instead — so a test asserting on the status of that
   * event would pass vacuously.
   */
  socketUpgraded(): boolean {
    return this._report.upgraded > 0;
  }

  /** Close the page. Its server is not affected. */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    this._view.close();
  }

  private _receivedCount(): number {
    return this._report.frames.filter((f) => f.direction === "received").length;
  }

  private _markAction(): void {
    this._framesAtAction = this._receivedCount();
  }

  private _assertOpen(): void {
    if (this._closed) throw new Error("[FlowBrowser] This page is closed.");
  }
}

/**
 * Drives a real browser against a real server, so the WebSocket bridge has a
 * regression net.
 *
 * Every silent failure Flow has shipped shares one shape — the HTML is fine and
 * the transport is dead — and `FlowTest` cannot exercise the bridge at all: SSR
 * renders, snapshot assertions pass, the suite is green, and the app does
 * nothing. This is the harness that can see that.
 *
 * @example
 * ```ts
 * const browser = await FlowBrowser.serve(bootstrap);
 * const page = await browser.visit("/settings");
 * await page.waitForConnection();
 * await page.click('[flow\\:click="save"]');
 * await page.waitForPatch();
 * expect(await page.text("#status")).toBe("Saved");
 * ```
 */
export class FlowBrowser {
  private readonly _app: TestApp;
  private readonly _timeout: number;
  private readonly _pages: BrowserPage[] = [];

  private constructor(app: TestApp, timeout: number) {
    this._app = app;
    this._timeout = timeout;
  }

  /** Whether a browser can be reached, and how. Cached per process. */
  static availability = browserAvailability;

  /**
   * Boot the app on an OS-assigned port and return a harness.
   *
   * Reuses `createTestApp()`, so the app under test is configured exactly the way
   * the rest of the suite configures it rather than through a second bootstrap
   * that can drift.
   */
  static async serve(
    bootstrap: () => Application | Promise<Application>,
    options: FlowBrowserOptions = {},
  ): Promise<FlowBrowser> {
    const availability = await browserAvailability();
    if (!availability.available) throw new Error(`[FlowBrowser] ${availability.reason}`);

    // Boot inside the bootstrap callback, so `setup` can use route macros.
    //
    // `createTestApp` runs `setup` between `bootstrap()` and `start()`, and a
    // provider registers its macros in `onRegister()` — which runs during
    // `boot()`, inside `start()`. So a `setup` that calls `Router.flow(...)`
    // would find it undefined. `boot()` is idempotent and `start()` skips it
    // when already booted, so pulling it forward changes only the ordering.
    const app = await createTestApp(async () => {
      const application = await bootstrap();
      application.adoptAsCurrent();
      await application.boot();
      return application;
    }, options.setup);
    return new FlowBrowser(app, options.timeout ?? DEFAULT_TIMEOUT);
  }

  /** The server's base URL, e.g. `http://localhost:53211`. */
  get url(): string {
    return this._app.baseUrl;
  }

  /** The port the server bound. */
  get port(): number {
    return this._app.port;
  }

  /**
   * Open `path` in a fresh page and wait for it to load.
   *
   * One page per test, torn down by {@link stop} — shared browser state across
   * tests is the other way a browser suite becomes untrustworthy.
   */
  async visit(path: string): Promise<BrowserPage> {
    const view = new Bun.WebView({ backend: backendOption() });
    const report: TransportReport = {
      created: 0,
      upgraded: 0,
      statuses: [],
      errored: false,
      frames: [],
    };

    // Network tracking has to be enabled before the page opens its socket, and
    // CDP needs one navigation before it has a session — so land on a blank page
    // first, subscribe, and only then navigate to the app.
    await view.navigate("about:blank");
    await view.cdp("Network.enable");

    view.addEventListener("Network.webSocketCreated", () => {
      report.created++;
    });
    view.addEventListener("Network.webSocketHandshakeResponseReceived", (event: Event) => {
      if (!cdpParams<{ response: { status: number } }>(event)) return;
      const status = event.data.response.status;
      report.statuses.push(status);
      if (status === 101) report.upgraded++;
    });
    view.addEventListener("Network.webSocketFrameReceived", (event: Event) => {
      if (!cdpParams<{ response: { payloadData: string } }>(event)) return;
      report.frames.push({ direction: "received", payload: event.data.response.payloadData });
    });
    view.addEventListener("Network.webSocketFrameSent", (event: Event) => {
      if (!cdpParams<{ response: { payloadData: string } }>(event)) return;
      report.frames.push({ direction: "sent", payload: event.data.response.payloadData });
    });
    view.addEventListener("Network.webSocketFrameError", () => {
      report.errored = true;
    });

    await view.navigate(new URL(path, this._app.baseUrl).href);

    const page = new BrowserPage(view, report, this._timeout);
    this._pages.push(page);
    return page;
  }

  /** Close every page this harness opened, then stop the server. */
  async stop(): Promise<void> {
    for (const page of this._pages) page.close();
    this._pages.length = 0;
    await this._app.close();
  }
}

/** JSON-quote a value for embedding in an evaluated expression. */
function quote(value: string): string {
  return JSON.stringify(value);
}
