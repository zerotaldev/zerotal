/**
 * Drive a real browser against a running Flow app.
 *
 * `FlowTest` calls actions directly, which is the right tool for a component's
 * logic but structurally cannot fail the way production fails: it never renders
 * an attribute, never dispatches a DOM event, and never opens the WebSocket. The
 * bugs Flow has actually shipped all lived in that gap — a `<select>` that lost
 * its binding, a click cancelled by `preventDefault`, an action the server
 * refused and reported only to the browser console.
 *
 * `FlowBrowser` closes it. A click here is a real click, dispatched by Chrome
 * into the page's own delegated listener, travelling over the real socket to the
 * real dispatcher and back as a real patch. If any link in that chain is broken,
 * the assertion fails — which is the whole point.
 *
 * ```ts
 * const page = await FlowBrowser.open(`http://localhost:${port}/counter`);
 * await page.click("#increment");
 * await page.waitForText("#count", "1");
 * expect(await page.consoleErrors()).toEqual([]);
 * await page.close();
 * ```
 *
 * Requires a Chrome or Edge install (or `CHROME_PATH`). Use {@link FlowBrowser.available}
 * to skip a suite where there is no browser rather than failing it.
 */
import { CdpSession, findChrome, launchBrowser, type LaunchedBrowser } from "./cdp.ts";

/** How long to wait for a condition driven by a server round-trip. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** @internal */
export interface OpenOptions {
  /** Milliseconds to wait for the page to load and Flow to connect. */
  timeout?: number;
  /**
   * Wait for Flow's WebSocket to report itself online before returning.
   * Default: true. Set false for a page with no Flow component on it.
   */
  waitForConnection?: boolean;
}

export class FlowBrowser {
  private readonly _consoleErrors: string[] = [];
  private readonly _pageErrors: string[] = [];

  private constructor(
    private readonly _browser: LaunchedBrowser,
    private readonly _session: CdpSession,
  ) {}

  /** Whether a browser is installed, so a suite can skip rather than fail. */
  static available(): boolean {
    return findChrome() !== null;
  }

  /** Launch a browser, load `url`, and wait for Flow to connect. */
  static async open(url: string, options: OpenOptions = {}): Promise<FlowBrowser> {
    const chrome = findChrome();
    if (!chrome) {
      throw new Error(
        "No Chrome or Edge found. Install one, or set CHROME_PATH. " +
          "Guard the suite with `FlowBrowser.available()` to skip instead.",
      );
    }
    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const browser = await launchBrowser(chrome);
    const page = new FlowBrowser(browser, browser.session);
    page._captureConsole();

    const loaded = browser.session.once("Page.loadEventFired", timeout);
    await browser.session.send("Page.navigate", { url });
    await loaded;

    if (options.waitForConnection !== false) {
      // The bridge stamps the body when its socket opens. Waiting on that rather
      // than on a sleep is what makes these tests deterministic: a slow boot
      // waits longer, and a bridge that never connects fails with a clear reason
      // instead of a mystery assertion further down.
      //
      // Guarded on `document.body` existing: the poll can land between a
      // navigation committing and the body being parsed, and `null.getAttribute`
      // throws out of `evaluate` rather than returning false — so the wait died
      // with a TypeError instead of polling once more.
      await page.waitUntil(
        `!!document.body && document.body.getAttribute("data-flow-connection") === "online"`,
        "Flow to connect its WebSocket",
        timeout,
      );
    }
    return page;
  }

  /**
   * Record console errors and uncaught exceptions.
   *
   * This is deliberate, not incidental. A Flow action the server refuses is
   * reported *only* here — nothing reaches the server log and the page does not
   * change — so a test that cannot see the console cannot see the failure. B15
   * cost an afternoon for exactly this reason.
   */
  private _captureConsole(): void {
    this._session.on("Runtime.consoleAPICalled", (params) => {
      if (params["type"] !== "error") return;
      const args = (params["args"] ?? []) as Array<{ value?: unknown; description?: string }>;
      this._consoleErrors.push(args.map((a) => String(a.value ?? a.description ?? "")).join(" "));
    });
    this._session.on("Runtime.exceptionThrown", (params) => {
      const details = params["exceptionDetails"] as
        { text?: string; exception?: { description?: string } } | undefined;
      this._pageErrors.push(details?.exception?.description ?? details?.text ?? "unknown error");
    });
  }

  /**
   * Navigate this browser to another URL and wait for Flow to reconnect.
   *
   * Reusing one browser across a suite is worth the small amount of state
   * management: launching Chrome costs about a second, and a fresh navigation
   * gives each test a fresh component anyway. Recorded console output is cleared
   * so one test's errors cannot be attributed to the next.
   */
  async goto(url: string, options: OpenOptions = {}): Promise<void> {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this._consoleErrors.length = 0;
    this._pageErrors.length = 0;

    const loaded = this._session.once("Page.loadEventFired", timeout);
    await this._session.send("Page.navigate", { url });
    await loaded;

    if (options.waitForConnection !== false) {
      await this.waitUntil(
        `!!document.body && document.body.getAttribute("data-flow-connection") === "online"`,
        "Flow to connect its WebSocket",
        timeout,
      );
    }
  }

  /** Evaluate an expression in the page and return its value. */
  async evaluate<T = unknown>(expression: string): Promise<T> {
    const res = (await this._session.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as {
      result?: { value?: T };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };
    if (res.exceptionDetails) {
      const detail =
        res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? "unknown";
      throw new Error(`Evaluation failed: ${detail}\n  expression: ${expression}`);
    }
    return res.result?.value as T;
  }

  /** Poll `expression` until it is truthy. */
  async waitUntil(
    expression: string,
    label: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let last: unknown;
    while (Date.now() < deadline) {
      last = await this.evaluate(`Boolean(${expression})`);
      if (last === true) return;
      await Bun.sleep(40);
    }
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for ${label}.\n` +
        `  expression: ${expression}\n` +
        `  console errors: ${this._consoleErrors.length ? this._consoleErrors.join(" | ") : "(none)"}`,
    );
  }

  /** Wait for an element to exist. */
  async waitForSelector(selector: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    await this.waitUntil(
      `document.querySelector(${JSON.stringify(selector)})`,
      `selector ${selector}`,
      timeoutMs,
    );
  }

  /** Wait until an element's trimmed text equals `text` — the usual post-action assertion. */
  async waitForText(selector: string, text: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    const sel = JSON.stringify(selector);
    await this.waitUntil(
      `(document.querySelector(${sel})?.textContent ?? "").trim() === ${JSON.stringify(text)}`,
      `${selector} to read ${JSON.stringify(text)} (currently ` +
        `${JSON.stringify(await this.text(selector).catch(() => null))})`,
      timeoutMs,
    );
  }

  /**
   * Click an element the way a user does.
   *
   * Dispatched through the element's own `click()`, so it runs the page's
   * delegated `click` listener and the browser's activation behaviour — which is
   * what made `flow:click` on a radio detectable at all (B4b).
   */
  async click(selector: string): Promise<void> {
    await this.waitForSelector(selector);
    await this.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  }

  /**
   * Type into a `flow:model` field.
   *
   * Sets the value and fires a real `input` event, because that is the event the
   * bridge listens for — assigning `.value` alone changes the DOM without ever
   * telling Flow, which is precisely the silent failure this harness exists to
   * catch.
   */
  async fill(selector: string, value: string): Promise<void> {
    await this.waitForSelector(selector);
    const sel = JSON.stringify(selector);
    await this.evaluate(
      `(() => {
        const el = document.querySelector(${sel});
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      })()`,
    );
  }

  /** An element's trimmed text. */
  async text(selector: string): Promise<string> {
    return (
      (await this.evaluate<string>(
        `(document.querySelector(${JSON.stringify(selector)})?.textContent ?? "").trim()`,
      )) ?? ""
    );
  }

  /** An element's attribute value, or null. */
  async attr(selector: string, name: string): Promise<string | null> {
    return await this.evaluate<string | null>(
      `document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(name)}) ?? null`,
    );
  }

  /** An input's current value. */
  async value(selector: string): Promise<string> {
    return (
      (await this.evaluate<string>(
        `document.querySelector(${JSON.stringify(selector)})?.value ?? ""`,
      )) ?? ""
    );
  }

  /** The page's full HTML, for diagnosing a failure. */
  async html(): Promise<string> {
    return await this.evaluate<string>("document.documentElement.outerHTML");
  }

  /** Console errors recorded so far — a refused action shows up here and nowhere else. */
  consoleErrors(): string[] {
    return [...this._consoleErrors];
  }

  /** Uncaught exceptions recorded so far. */
  pageErrors(): string[] {
    return [...this._pageErrors];
  }

  /** Close the page and kill the browser. */
  async close(): Promise<void> {
    await this._browser.close();
  }
}
