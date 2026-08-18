/**
 * The socket id behind `toOthers()`.
 *
 * This one function decides whether a broadcast excludes the connection that
 * caused it. Every way it can be wrong is silent and looks like a UI bug rather
 * than a broadcasting one:
 *
 * - Returning `undefined` when a header was sent → `toOthers()` excludes nobody,
 *   so the user who just made an optimistic update receives their own event back
 *   and the UI double-applies it.
 * - Returning a stale id outside a request → a queue job or a scheduled task
 *   silently excludes some unrelated connection from a broadcast it should have
 *   received.
 *
 * Header lookup is case-insensitive over the wire, which is the other thing worth
 * pinning: `X-Socket-ID` and `x-socket-id` are the same header, and clients send
 * both spellings.
 */
import { describe, it, expect } from "bun:test";
import { RequestContext, HttpContext } from "@zerotal/core";
import { currentSocketId } from "./currentSocketId.ts";

/** Run `fn` inside a request carrying the given headers. */
function withRequest<T>(headers: Record<string, string>, fn: () => T): T {
  const http = HttpContext.fake("http://localhost/orders", { headers });
  return RequestContext.run(http, fn) as T;
}

describe("currentSocketId", () => {
  it("reads the socket id from the request header", () => {
    expect(withRequest({ "X-Socket-ID": "1234.5678" }, currentSocketId)).toBe("1234.5678");
  });

  it("matches the header however the client cased it", () => {
    // The client sends `X-Socket-ID`; a hand-rolled one may send it lowercase.
    expect(withRequest({ "x-socket-id": "abc.def" }, currentSocketId)).toBe("abc.def");
    expect(withRequest({ "X-SOCKET-ID": "ghi.jkl" }, currentSocketId)).toBe("ghi.jkl");
  });

  it("is undefined when the request carries no socket id", () => {
    // A plain server-side request excludes nobody, which is correct: there is no
    // originating connection to leave out.
    expect(withRequest({}, currentSocketId)).toBeUndefined();
  });

  it("is undefined outside a request entirely", () => {
    // Queue jobs and scheduled tasks broadcast with no request in scope. Anything
    // other than `undefined` here would exclude an arbitrary connection.
    expect(currentSocketId()).toBeUndefined();
  });

  it("does not leak one request's id into the next", () => {
    withRequest({ "X-Socket-ID": "first.socket" }, currentSocketId);
    expect(withRequest({}, currentSocketId)).toBeUndefined();
    expect(withRequest({ "X-Socket-ID": "second.socket" }, currentSocketId)).toBe("second.socket");
  });
});
