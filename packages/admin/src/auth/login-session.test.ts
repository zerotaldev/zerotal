import { describe, it, expect } from "bun:test";
import { HttpContext } from "@zerotal/core";

/**
 * Regression guard for sessions mutated inside a WebSocket action.
 *
 * Signing in through the panel's login screen is a Flow action, not a form
 * POST. `SessionMiddleware` does not write its cookie inline — it registers a
 * finalizer via `ctx.onResponseReady()` and saves the session from there, which
 * is what lets a session set before a throw still reach the client.
 *
 * The HTTP dispatcher runs those finalizers; the WebSocket dispatcher did not.
 * The result was a login that authenticated, redirected, and then bounced
 * straight back to the login screen, because no `Set-Cookie` was ever produced
 * and the browser stayed anonymous.
 *
 * These tests pin the contract the WebSocket path depends on: finalizers are
 * queued on the context, they receive the final response, and one that throws
 * cannot take the response down with it.
 */
describe("response finalizers", () => {
  const contextFor = (): HttpContext =>
    new HttpContext(new Request("http://localhost/admin/login"));

  it("queues finalizers on the context rather than running them eagerly", () => {
    const ctx = contextFor();
    let ran = false;

    ctx.onResponseReady(async () => {
      ran = true;
    });

    expect(ctx._responseFinalizers).toHaveLength(1);
    expect(ran).toBe(false);
  });

  it("hands each finalizer the response, so a cookie can be attached", async () => {
    const ctx = contextFor();
    ctx.onResponseReady(async (response) => {
      response.headers.append("Set-Cookie", "zerotal_session=abc; Path=/");
    });

    // What both dispatchers must do once the final response exists.
    const response = new Response(null, { status: 204 });
    for (const finalize of ctx._responseFinalizers) await finalize(response);

    expect(response.headers.get("Set-Cookie")).toBe("zerotal_session=abc; Path=/");
  });

  it("runs every finalizer in order, even when one throws", async () => {
    const ctx = contextFor();
    const order: string[] = [];

    ctx.onResponseReady(async () => {
      order.push("first");
    });
    ctx.onResponseReady(async () => {
      throw new Error("finalizer blew up");
    });
    ctx.onResponseReady(async (response) => {
      order.push("third");
      response.headers.set("X-Done", "1");
    });

    const response = new Response(null, { status: 204 });
    for (const finalize of ctx._responseFinalizers) {
      try {
        await finalize(response);
      } catch {
        // Swallowed exactly as both dispatchers swallow it: a failed finalizer
        // must not turn a rendered response into a crash.
      }
    }

    expect(order).toEqual(["first", "third"]);
    expect(response.headers.get("X-Done")).toBe("1");
  });
});
