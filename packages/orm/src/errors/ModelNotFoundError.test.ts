import { describe, it, expect } from "bun:test";
import { ExceptionHandler } from "@zerotal/core";
import { ModelNotFoundError } from "./ModelNotFoundError.ts";

// Core recognises this error by its name, since it cannot import the ORM. Renaming the class
// would quietly put every missing route-bound record back in the logs as an unhandled error.
class Handler extends ExceptionHandler {
  reports(error: unknown): boolean {
    return this.shouldReport(error);
  }
}

describe("ModelNotFoundError", () => {
  it("is a 404", () => {
    const error = new ModelNotFoundError("Project", 999);
    expect(error.status).toBe(404);
    expect(error.message).toBe("No Project record found for ID: 999");
  });

  it("is an expected outcome, not reported as an unhandled error", () => {
    expect(new Handler().reports(new ModelNotFoundError("Project", 999))).toBe(false);
    expect(new Handler().reports(new ModelNotFoundError("Project"))).toBe(false);
  });
});
