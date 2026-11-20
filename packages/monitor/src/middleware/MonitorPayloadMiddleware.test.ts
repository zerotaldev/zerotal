/**
 * The payload middleware reads the response body before handing the response on, so a body
 * that never ends must not be read: the request would wait for it forever.
 */
import { describe, it, expect } from "bun:test";
import { HttpContext } from "@zerotal/core";
import { MonitorPayloadMiddleware } from "./MonitorPayloadMiddleware.ts";
import { collectRequestState } from "../recorder/ctxBuffers.ts";

/** An endless stream: one chunk, then reads that never settle. Counts cancellations. */
function endless(contentType: string): { response: Response; cancelled: () => number } {
  let cancelled = 0;
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new TextEncoder().encode("data: hello\n\n"));
        return;
      }
      return new Promise<void>(() => {});
    },
    cancel() {
      cancelled++;
    },
  });
  return {
    response: new Response(body, { headers: { "Content-Type": contentType } }),
    cancelled: () => cancelled,
  };
}

/** Run one request through the middleware; `"hung"` if it has not finished within 2 s. */
async function pass(method: string, response: Response): Promise<HttpContext | "hung"> {
  const http = HttpContext.fake("http://localhost/events", { method });
  const handled = new MonitorPayloadMiddleware()
    .handle(http, async () => {
      http.response = response;
    })
    .then(() => http);
  const timeout = new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 2_000));
  return await Promise.race([handled, timeout]);
}

describe("MonitorPayloadMiddleware", () => {
  it("records a body that is all there", async () => {
    const http = await pass("GET", Response.json({ ok: true, password: "x" }));

    expect(http).not.toBe("hung");
    const { payload } = collectRequestState(http as HttpContext);
    expect(payload?.resBody).toBe('{"ok":true,"password":"x"}');
  });

  it.each(["GET", "HEAD"])(
    "hands an event stream on at once for %s, unread, and leaves it open",
    async (method) => {
      const stream = endless("text/event-stream");
      const http = await pass(method, stream.response);

      expect(http).not.toBe("hung");
      expect(collectRequestState(http as HttpContext).payload?.resBody).toBe("");
      expect(stream.cancelled()).toBe(0);
      const reader = (http as HttpContext).response!.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("hello");
      await reader.cancel();
    },
  );

  it("hands on any other stream that has not ended, without its body", async () => {
    const stream = endless("application/x-ndjson");
    const http = await pass("GET", stream.response);

    expect(http).not.toBe("hung");
    expect(collectRequestState(http as HttpContext).payload?.resBody).toBe("");
    expect(stream.cancelled()).toBe(0);
    const reader = (http as HttpContext).response!.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("hello");
    await reader.cancel();
  });
});
