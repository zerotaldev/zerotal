/**
 * A server that will not start says why, in the terminal and in the browser.
 *
 * From the 1.18.0 starter walk: in Flow dev, breaking a page's JSX stopped the server (pages are
 * imported at boot). The browser got "connection refused", and the terminal, after three
 * identical attempts, said `server did not start after 3 attempts. Port 3000 may be held by
 * another process`, which blamed the wrong thing.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { DevOrchestrator, _startupFailure } from "./DevOrchestrator.ts";

const PARSE_ERROR = [
  "  [Zerotal Inspector] DevTools active",
  "110 |       <div><span>broken</div>",
  "                               ^",
  'error: Expected closing JSX tag to match opening tag "<span>"',
  "    at /app/app/flow/pages/home.tsx:110:26",
  "",
  "110 |       <div><span>broken</div>",
  "                 ^",
  "note: Opening tag here:",
  "   at /app/app/flow/pages/home.tsx:110:13",
  "",
  "Bun v1.3.14 (Linux x64)",
];

describe("_startupFailure()", () => {
  it("reads a parse error as the app's own, at its file, line and column", () => {
    const failure = _startupFailure(PARSE_ERROR);

    expect(failure.kind).toBe("source");
    expect(failure.lines[0]).toBe(
      '/app/app/flow/pages/home.tsx:110:26 Expected closing JSX tag to match opening tag "<span>"',
    );
    // With the code frame, which shows the line itself.
    expect(failure.lines).toContain("110 |       <div><span>broken</div>");
  });

  it("reads an error thrown while booting, at the app's frame rather than the framework's", () => {
    const failure = _startupFailure([
      "TypeError: undefined is not an object (evaluating 'config.mail.from')",
      "      at boot (/app/node_modules/@zerotal/core/src/provider/Provider.ts:10:3)",
      "      at register (/app/app/providers/AppServiceProvider.ts:14:9)",
    ]);

    expect(failure.kind).toBe("source");
    expect(failure.lines[0]).toBe(
      "/app/app/providers/AppServiceProvider.ts:14:9 TypeError: undefined is not an object (evaluating 'config.mail.from')",
    );
  });

  it("reads a parse error in a route group, whose path holds parentheses", () => {
    const failure = _startupFailure([
      "44 | export const broken = {;",
      "                            ^",
      'error: Expected identifier but found ";"',
      "    at /app/app/routes/(guest)/login.ts:44:24",
      "",
      "Bun v1.3.14 (Linux x64)",
    ]);

    expect(failure.kind).toBe("source");
    expect(failure.lines[0]).toBe(
      '/app/app/routes/(guest)/login.ts:44:24 Expected identifier but found ";"',
    );
    expect(failure.lines).toContain("44 | export const broken = {;");
  });

  it("reads a frame inside a route group when it names a function", () => {
    const failure = _startupFailure([
      "TypeError: nope",
      "      at load (/app/app/routes/(auth)/settings/index.ts:3:9)",
    ]);

    expect(failure.lines[0]).toBe("/app/app/routes/(auth)/settings/index.ts:3:9 TypeError: nope");
  });

  it("reads a port held by another process as that, and only that", () => {
    expect(_startupFailure(["error: Failed to start server. Is port 3000 in use?"]).kind).toBe(
      "port",
    );
    expect(_startupFailure(["Error: listen EADDRINUSE: address already in use :::3000"]).kind).toBe(
      "port",
    );
  });

  it("says it does not know when the output does not say", () => {
    expect(_startupFailure([]).kind).toBe("unknown");
  });
});

describe("the orchestrator, when the server will not start", () => {
  let orchestrator: DevOrchestrator | undefined;
  afterEach(async () => {
    await (
      orchestrator as unknown as { _stopFallback(): Promise<void> } | undefined
    )?._stopFallback();
  });

  async function freePort(): Promise<number> {
    const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
    const port = probe.port!;
    await probe.stop(true);
    return port;
  }

  async function setup(outputs: string[][]) {
    const port = await freePort();
    const notices: string[] = [];
    orchestrator = new DevOrchestrator(port, "/app", async () => ({ success: true }), {
      onServerLine: () => {},
      onNotice: (text) => void notices.push(text),
    });
    const internals = orchestrator as unknown as Record<string, unknown>;
    let attempts = 0;
    internals["_spawnServer"] = function (this: Record<string, unknown>) {
      const output = outputs[Math.min(attempts, outputs.length - 1)]!;
      attempts += 1;
      (this["_serverOutput"] as string[]).length = 0;
      for (const line of output)
        (this["_serverLine"] as (l: string, k: string) => void).call(this, line, "stderr");
      // An empty output stands for a server that starts and stays up.
      const child = {
        exited: output.length ? Promise.resolve(1) : new Promise<number>(() => {}),
        stdin: null,
      };
      this["_child"] = child;
      return child;
    };
    const start = () =>
      (internals["_spawnServerWithRetry"] as () => Promise<void>).call(orchestrator);
    return { port, notices, attempts: () => attempts, start };
  }

  it("does not retry a syntax error, and does not blame the port for it", async () => {
    const { notices, attempts, start } = await setup([PARSE_ERROR]);
    await start();

    expect(attempts()).toBe(1);
    const said = notices.join("\n");
    expect(said).toContain(
      "server did not start: /app/app/flow/pages/home.tsx:110:26 Expected closing JSX tag",
    );
    expect(said).not.toMatch(/port/i);
  });

  it("answers on the port with the error, until the server starts again", async () => {
    const { port, start } = await setup([PARSE_ERROR, []]);
    await start();

    const res = await fetch(`http://localhost:${port}/projects`);
    expect(res.status).toBe(503);
    const html = await res.text();
    expect(html).toContain("The server did not start");
    expect(html).toContain("home.tsx:110:26 Expected closing JSX tag");
    expect(html).toContain("&lt;div&gt;&lt;span&gt;broken&lt;/div&gt;");
    // The reload client, which brings the tab back when the server is.
    expect(html).toContain('<script src="/__dev/reload.js"></script>');
    expect((await fetch(`http://localhost:${port}/__dev/reload.js`)).status).toBe(200);

    // The next save starts the server: the error page hands the port back first.
    await start();
    await expect(fetch(`http://localhost:${port}/`)).rejects.toThrow();
  });

  it("still retries, and names the port, when the port is what failed", async () => {
    const { notices, attempts, start } = await setup([
      ["error: Failed to start server. Is port 3000 in use?"],
    ]);
    await start();

    expect(attempts()).toBe(3);
    expect(notices.join("\n")).toContain("is held by another process");
  });
});
