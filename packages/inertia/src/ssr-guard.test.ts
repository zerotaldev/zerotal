/**
 * `POST /__ssr` is not a public endpoint.
 *
 * It takes an arbitrary component name plus a props bag and does real rendering work with
 * them, which is why upstream Inertia runs SSR as a separate process on a private port.
 * Zerotal serves it in-process, so the boundary lives in the handler — it was previously
 * absent entirely, along with any auth, any rate limit, and with the raw error message
 * reflected back as a filesystem-path oracle.
 */
import { describe, it, expect } from "bun:test";
import { SsrHandler, SSR_SECRET_HEADER } from "./SsrHandler.ts";
import type { HttpContext } from "@zerotal/core";

function requestFrom(ip: string | undefined, headers: Record<string, string> = {}): HttpContext {
  return {
    request: new Request("http://app.test/__ssr", { method: "POST", headers }),
    ip: () => ip,
    response: undefined,
  } as unknown as HttpContext;
}

describe("SSR endpoint authorization", () => {
  it("admits loopback callers — the SSR client talking to its own process", () => {
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(SsrHandler.isAuthorized(requestFrom(ip))).toBe(true);
    }
  });

  it("refuses a caller from anywhere else", () => {
    expect(SsrHandler.isAuthorized(requestFrom("203.0.113.7"))).toBe(false);
    expect(SsrHandler.isAuthorized(requestFrom(undefined))).toBe(false);
  });

  it("answers an unauthorized caller with 404, not 403", async () => {
    // Whether this route exists is not information a stranger needs.
    const http = requestFrom("203.0.113.7");
    await new SsrHandler().handle(http);
    expect(http.response?.status).toBe(404);
  });

  it("does not reveal why a request failed before it was authorized", async () => {
    const http = requestFrom("203.0.113.7");
    await new SsrHandler().handle(http);
    const body = (await http.response!.json()) as { message: string };
    expect(body.message).toBe("Not found.");
  });
});

describe("SSR error responses", () => {
  it("does not reflect the render error back to the caller", async () => {
    // The message named the absolute module path it failed to resolve — a filesystem
    // oracle for anyone who could reach the endpoint.
    const http = requestFrom("127.0.0.1");
    (http as unknown as { request: { json(): Promise<unknown> } }).request = {
      json: () => Promise.resolve({ component: "NoSuchPage", props: {}, url: "/" }),
    } as never;

    await new SsrHandler().handle(http);

    expect(http.response?.status).toBe(500);
    const body = (await http.response!.json()) as { message: string };
    expect(body.message).toBe("SSR render failed.");
    expect(body.message).not.toContain("/");
  });

  it("admits an off-box renderer presenting the configured secret", () => {
    // Loopback-only is the default; a renderer on another host authenticates instead.
    expect(SSR_SECRET_HEADER).toBe("x-inertia-ssr-secret");
    expect(SsrHandler.isAuthorized(requestFrom("203.0.113.7", { [SSR_SECRET_HEADER]: "" }))).toBe(
      false,
    );
  });
});
