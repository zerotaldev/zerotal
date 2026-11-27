import { describe, it, expect } from "bun:test";
import { _isExpectedOutcome as coreExpected } from "../../core/src/application/ExceptionHandler.ts";
import { _isExpectedOutcome } from "./errorText.ts";

/**
 * Flow keeps its own copy of core's expected-outcome names, because core's lives in a
 * server-only module no shared entry point exports. The two must agree.
 */
describe("Flow's expected outcomes", () => {
  it("match core's for each name core lists", () => {
    for (const name of [
      "ValidationRedirectError",
      "ValidationJsonError",
      "ValidationError",
      "PrecognitionResponse",
      "NotFoundError",
      "ModelNotFoundError",
      "TypeError",
      "Error",
    ]) {
      const error = Object.assign(new Error("x"), { name });
      expect(_isExpectedOutcome(error)).toBe(coreExpected(error));
    }
  });
});
