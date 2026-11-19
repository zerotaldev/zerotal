/**
 * What a running app answers where Bun 1.3 and Bun 1.4 behave differently.
 *
 * Bun 1.4 answers `HEAD` from a route's `GET` handler by itself; Bun 1.3 sends it on to
 * `fetch`. And `server.stop()` without `true` waits for every request still in flight, which
 * for an event stream is forever. Both are invisible from a handler-level test, so these run
 * a real server and read the bytes off the socket. Each one has to pass on both versions.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import { Application } from "./Application.ts";
import { Router } from "../router/Router.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";

const TMP = `${import.meta.dir}/.tmp-server-contract-${Date.now()}`;

class MarkedController {
  async handle(http: HttpContext): Promise<void> {
    http.response = new Response("marked page", {
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Marker": "yes" },
    });
  }
}

/** An endless event stream, counting the streams that were opened and the ones cancelled. */
const streams = { opened: 0, cancelled: 0 };
function eventStream(): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streams.opened++;
      controller.enqueue(new TextEncoder().encode("data: hello\n\n"));
    },
    cancel() {
      streams.cancelled++;
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

/** Send one request over a raw socket and return everything the server wrote, as text. */
async function wire(port: number, method: string, path: string): Promise<string> {
  return await new Promise<string>((resolve) => {
    let received = "";
    const finish = (): void => resolve(received);
    const timer = setTimeout(finish, 3_000);
    void Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        open(socket) {
          socket.write(
            `${method} ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
          );
        },
        data(_socket, chunk) {
          received += new TextDecoder().decode(chunk);
        },
        close() {
          clearTimeout(timer);
          finish();
        },
        error() {
          clearTimeout(timer);
          finish();
        },
      },
    });
  });
}

/** Split a raw HTTP/1.1 response into its status, headers (lower-cased) and body. */
function parse(raw: string): { status: number; headers: Map<string, string>; body: string } {
  const split = raw.indexOf("\r\n\r\n");
  const head = split === -1 ? raw : raw.slice(0, split);
  const [statusLine = "", ...lines] = head.split("\r\n");
  const headers = new Map<string, string>();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon > 0) headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
  }
  return {
    status: Number(statusLine.split(" ")[1]),
    headers,
    body: split === -1 ? "" : raw.slice(split + 4),
  };
}

let app: Application;
let port: number;

beforeAll(async () => {
  await Bun.write(`${TMP}/guide/intro.md`, "# Intro\n\nHello from markdown.\n");
  Application._resetInstance();
  Router.reset();
  app = Application.create({ env: "test" });
  await app.boot();
  Router.get("/page", MarkedController as never, "handle");
  Router.post("/submit", MarkedController as never, "handle");
  Router.raw(
    "GET",
    "/raw",
    () => new Response("raw body", { headers: { "Content-Type": "text/plain", "X-Raw": "1" } }),
  );
  Router.raw(
    "GET",
    "/declared",
    () => new Response("12345", { headers: { "Content-Length": "5" } }),
  );
  Router.raw("GET", "/events", () => eventStream());
  Router.markdown("/guide", `${TMP}/guide`);
  await app.start(0);
  port = (app as unknown as { _static: { port: number } })._static.port;
});

afterAll(async () => {
  await app.stop({ exit: false });
  Router.reset();
  Application._resetInstance();
  await rm(TMP, { recursive: true, force: true });
});

describe("HEAD on a running app", () => {
  it.each(["/page", "/raw", "/guide/intro"])(
    "answers %s with the GET status and length, and no body on the wire",
    async (path) => {
      const get = parse(await wire(port, "GET", path));
      const head = parse(await wire(port, "HEAD", path));

      expect(get.status).toBe(200);
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe(String(Buffer.byteLength(get.body)));
      expect(head.headers.get("content-type")).toBe(get.headers.get("content-type"));
      expect(head.body).toBe("");
    },
  );

  it("keeps the headers the GET handler set", async () => {
    const page = parse(await wire(port, "HEAD", "/page"));
    const raw = parse(await wire(port, "HEAD", "/raw"));

    expect(page.headers.get("x-marker")).toBe("yes");
    expect(raw.headers.get("x-raw")).toBe("1");
  });

  it("answers a markdown page that does not exist with 404, as GET does", async () => {
    const head = parse(await wire(port, "HEAD", "/guide/missing"));

    expect(head.status).toBe(404);
    expect(head.body).toBe("");
  });

  it("takes a Content-Length the handler declared at its word", async () => {
    const head = parse(await wire(port, "HEAD", "/declared"));

    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("5");
    expect(head.body).toBe("");
  });

  it("answers an event stream at once instead of reading it to the end, and cancels it", async () => {
    const before = { ...streams };
    const started = performance.now();

    const head = parse(await wire(port, "HEAD", "/events"));

    expect(performance.now() - started).toBeLessThan(2_000);
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("text/event-stream");
    expect(head.body).toBe("");
    expect(streams.opened).toBe(before.opened + 1);
    expect(streams.cancelled).toBe(before.cancelled + 1);
  });

  it("answers a path with no GET the way GET is answered there", async () => {
    const get = parse(await wire(port, "GET", "/submit"));
    const head = parse(await wire(port, "HEAD", "/submit"));

    expect(head.status).toBe(get.status);
    expect(head.body).toBe("");
  });

  it("answers a path with no route at all with 404", async () => {
    const head = parse(await wire(port, "HEAD", "/nowhere"));

    expect(head.status).toBe(404);
    expect(head.body).toBe("");
  });
});

describe("stopping a running app with a request still in flight", () => {
  it("returns promptly and stops taking connections while an event stream is open", async () => {
    Application._resetInstance();
    Router.reset();
    const streaming = Application.create({ env: "test" });
    await streaming.boot();
    Router.raw("GET", "/events", () => eventStream());
    await streaming.start(0);
    const streamingPort = (streaming as unknown as { _static: { port: number } })._static.port;

    const open = await fetch(`http://127.0.0.1:${streamingPort}/events`);
    const reader = open.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("hello");

    const started = performance.now();
    await streaming.stop({ exit: false });
    expect(performance.now() - started).toBeLessThan(1_000);

    const refused = await fetch(`http://127.0.0.1:${streamingPort}/events`, {
      signal: AbortSignal.timeout(1_000),
    }).then(
      () => false,
      () => true,
    );
    expect(refused).toBe(true);

    await reader.cancel().catch(() => {});
    (streaming as unknown as { _static: { stop(force: boolean): void } })._static.stop(true);
  });
});
