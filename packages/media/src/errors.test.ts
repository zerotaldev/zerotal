import { describe, expect, it } from "bun:test";
import { DisallowedMimeTypeError, FileTooLargeError, UnsupportedFormatError } from "./errors.ts";

/** What core reads to tell an answer to the client from a fault (see `_isExpectedOutcome`). */
const ANSWERS_THE_CLIENT = Symbol.for("zerotal.httpError");

// From the 1.18.1 walk: a test that uploaded a file of the wrong type on purpose got its 422, and
// also `ERROR [HTTP] Request pipeline error … DisallowedMimeTypeError` with a stack, even at
// LOG_LEVEL=warn. A refused upload is the client's mistake: one warning line, like any 4xx.
describe("media errors as the client's mistake", () => {
  it("marks a refused type or size as an answer to the client, below 500", () => {
    for (const error of [
      new DisallowedMimeTypeError("docs", "image/gif", ["image/png"]),
      new FileTooLargeError("docs", 2_000_000, 1_000_000),
    ]) {
      expect(ANSWERS_THE_CLIENT in error).toBe(true);
      expect(error.status).toBeLessThan(500);
    }
  });

  it("leaves a server-side failure a fault", () => {
    expect(ANSWERS_THE_CLIENT in new UnsupportedFormatError("avif", ["png"])).toBe(false);
  });
});
