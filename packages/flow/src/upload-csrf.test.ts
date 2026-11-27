/**
 * A Flow upload carries the anti-forgery token.
 *
 * `/__flow/upload` runs the app's middleware, so once an app turns CSRF protection on, as the
 * Flow starter now does, an upload without the token was refused with a 419. The bridge sends the
 * `XSRF-TOKEN` cookie's value back in the header the middleware reads.
 */
import { describe, it, expect } from "bun:test";
import { _xsrfHeader } from "./client/bridge.ts";

describe("the upload request's CSRF header", () => {
  it("echoes the XSRF-TOKEN cookie as X-XSRF-TOKEN", () => {
    expect(_xsrfHeader("theme=dark; XSRF-TOKEN=abc%3D123; other=1")).toEqual({
      "X-XSRF-TOKEN": "abc=123",
    });
    expect(_xsrfHeader("XSRF-TOKEN=first")).toEqual({ "X-XSRF-TOKEN": "first" });
  });

  it("sends nothing when the app sets no token", () => {
    expect(_xsrfHeader("")).toEqual({});
    expect(_xsrfHeader("MY-XSRF-TOKEN=nope")).toEqual({});
    expect(_xsrfHeader("XSRF-TOKEN=%E0%A4%A")).toEqual({});
  });
});
