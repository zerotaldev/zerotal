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

/**
 * A body that declares its length and never delivers it: its one read never settles. Measuring
 * it would hold a `HEAD` open forever, and the declared length is not known to be what a `GET`
 * would send, so the `HEAD` states none.
 */
const declared = { reads: 0, cancelled: 0 };
function declaredStream(): Response {
  const body = new ReadableStream<Uint8Array>(
    {
      pull() {
        declared.reads++;
        return new Promise<void>(() => {});
      },
      cancel() {
        declared.cancelled++;
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, { headers: { "Content-Length": "5" } });
}

/**
 * A stream still producing when the `HEAD` looks at it, that declares a length it does not send:
 * each chunk comes on a timer, and the three bytes are declared as five.
 */
function slowStream(): Response {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        await Bun.sleep(5);
        if (sent++ < 3) controller.enqueue(new TextEncoder().encode("a"));
        else controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, { headers: { "Content-Type": "text/plain", "Content-Length": "5" } });
}

/**
 * An upstream that sends gzip bodies, so a `fetch()` of one decompresses and keeps the compressed
 * length: a small one, and one large enough that it is still being decompressed when the `HEAD`
 * looks at it.
 */
let upstream: ReturnType<typeof Bun.serve>;
const BIG_PLAIN = "proxied big text ".repeat(400_000);

/**
 * Send one request over a raw socket and return everything the server wrote, as text.
 *
 * Done when the server closes the connection, or, for a response that is not to a `HEAD`, once
 * the `Content-Length` it declared, or the last chunk, has arrived: Bun leaves the connection
 * open after a `GET` answered with a `fetch()` response, `Connection: close` or not.
 */
async function wire(port: number, method: string, path: string): Promise<string> {
  return await new Promise<string>((resolve) => {
    let received = "";
    const finish = (): void => resolve(received);
    const timer = setTimeout(finish, 3_000);
    const complete = (): boolean => {
      if (method === "HEAD") return false;
      const split = received.indexOf("\r\n\r\n");
      if (split === -1) return false;
      const head = received.slice(0, split);
      if (/\r\ntransfer-encoding: *chunked/i.test(head)) return received.endsWith("\r\n0\r\n\r\n");
      const length = /\r\ncontent-length: *(\d+)/i.exec(head);
      return length !== null && Buffer.byteLength(received.slice(split + 4)) >= Number(length[1]);
    };
    void Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        open(socket) {
          socket.write(
            `${method} ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
          );
        },
        data(socket, chunk) {
          received += new TextDecoder().decode(chunk);
          if (complete()) {
            clearTimeout(timer);
            socket.end();
            finish();
          }
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

/** The content of a chunked body: its chunks without their size lines. */
function unchunk(body: string): string {
  let content = "";
  let at = 0;
  for (;;) {
    const line = body.indexOf("\r\n", at);
    if (line === -1) return content;
    const size = Number.parseInt(body.slice(at, line), 16);
    if (!(size > 0)) return content;
    content += body.slice(line + 2, line + 2 + size);
    at = line + 2 + size + 2;
  }
}

/**
 * Split a raw HTTP/1.1 response into its status, headers (lower-cased) and body. A chunked body
 * is given as its content.
 */
function parse(raw: string): { status: number; headers: Map<string, string>; body: string } {
  const split = raw.indexOf("\r\n\r\n");
  const head = split === -1 ? raw : raw.slice(0, split);
  const [statusLine = "", ...lines] = head.split("\r\n");
  const headers = new Map<string, string>();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon > 0) headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
  }
  const body = split === -1 ? "" : raw.slice(split + 4);
  return {
    status: Number(statusLine.split(" ")[1]),
    headers,
    body: headers.get("transfer-encoding") === "chunked" ? unchunk(body) : body,
  };
}

let app: Application;
let port: number;

beforeAll(async () => {
  await Bun.write(`${TMP}/guide/intro.md`, "# Intro\n\nHello from markdown.\n");
  upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req) =>
      new Response(
        Bun.gzipSync(
          new TextEncoder().encode(
            new URL(req.url).pathname === "/big" ? BIG_PLAIN : "proxied ".repeat(64),
          ),
        ),
        { headers: { "Content-Type": "text/plain", "Content-Encoding": "gzip" } },
      ),
  });
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
  Router.raw("GET", "/declared", () => declaredStream());
  Router.raw(
    "GET",
    "/stale",
    () => new Response("abc", { headers: { "Content-Type": "text/plain", "Content-Length": "5" } }),
  );
  Router.raw("GET", "/proxied", () => fetch(`http://127.0.0.1:${upstream.port}/`));
  Router.raw("GET", "/proxied-big", () => fetch(`http://127.0.0.1:${upstream.port}/big`));
  Router.raw("GET", "/slow", () => slowStream());
  Router.raw("GET", "/events", () => eventStream());
  Router.markdown("/guide", `${TMP}/guide`);
  await app.start(0);
  port = (app as unknown as { _static: { port: number } })._static.port;
});

afterAll(async () => {
  await app.stop({ exit: false });
  Router.reset();
  Application._resetInstance();
  upstream.stop(true);
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

  it("answers a streamed body still arriving at once, with no length, and cancels it", async () => {
    const before = { ...declared };
    const started = performance.now();

    const head = parse(await wire(port, "HEAD", "/declared"));

    expect(performance.now() - started).toBeLessThan(2_000);
    expect(head.status).toBe(200);
    expect(head.headers.has("content-length")).toBe(false);
    expect(head.headers.get("transfer-encoding")).toBe("chunked");
    expect(head.body).toBe("");
    expect(declared.reads - before.reads).toBeLessThanOrEqual(1);
    expect(declared.cancelled).toBe(before.cancelled + 1);
  });

  it.each(["/stale", "/proxied"])(
    "answers %s with the length GET sends, not a stale declared one",
    async (path) => {
      const get = parse(await wire(port, "GET", path));
      const head = parse(await wire(port, "HEAD", path));

      expect(get.status).toBe(200);
      expect(get.headers.get("content-length")).toBe(String(Buffer.byteLength(get.body)));
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe(get.headers.get("content-length"));
      expect(head.body).toBe("");
    },
  );

  // Whether these GETs go out chunked or with a length, and whether the HEAD can measure the
  // body in time, differs between Bun 1.3 and 1.4. What holds on both: a HEAD that states a
  // length states the one the GET sends, and one that states none is chunked like an open GET.
  it.each(["/slow", "/proxied-big"])(
    "answers %s, a body still arriving, with no length or the one GET sends",
    async (path) => {
      const get = parse(await wire(port, "GET", path));
      const head = parse(await wire(port, "HEAD", path));

      expect(get.status).toBe(200);
      expect(head.status).toBe(200);
      expect(head.body).toBe("");
      if (head.headers.has("content-length")) {
        expect(head.headers.get("content-length")).toBe(String(Buffer.byteLength(get.body)));
      } else {
        expect(head.headers.get("transfer-encoding")).toBe("chunked");
      }
      if (path === "/proxied-big") expect(get.body).toBe(BIG_PLAIN);
      else expect(get.body).toBe("aaa");
    },
  );

  it("answers an event stream at once instead of reading it to the end, and cancels it", async () => {
    const before = { ...streams };
    const started = performance.now();

    const head = parse(await wire(port, "HEAD", "/events"));

    expect(performance.now() - started).toBeLessThan(2_000);
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("text/event-stream");
    expect(head.headers.has("content-length")).toBe(false);
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
