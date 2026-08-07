import { describe, it, expect } from "bun:test";
import { ZerotalError } from "./ZerotalError.ts";
import { ValidationError } from "./ValidationError.ts";

describe("ZerotalError", () => {
  it("sets name to class name", () => {
    const err = new ZerotalError("test", "E_TEST", 500);
    expect(err.name).toBe("ZerotalError");
  });

  it("exposes code, status, and context", () => {
    const err = new ZerotalError("oops", "E_OOPS", 422, { field: "email" });
    expect(err.code).toBe("E_OOPS");
    expect(err.status).toBe(422);
    expect(err.context).toEqual({ field: "email" });
  });

  it("subclasses set their own name", () => {
    class MyError extends ZerotalError {
      constructor() {
        super("sub", "E_SUB", 400);
      }
    }
    expect(new MyError().name).toBe("MyError");
  });
});

// ── ValidationError ───────────────────────────────────────────────────────────

describe("ValidationError", () => {
  it("has status 422 and code E_VALIDATION_FAILED", () => {
    const err = new ValidationError("Validation failed", { email: ["invalid"] });
    expect(err.status).toBe(422);
    expect(err.code).toBe("E_VALIDATION_FAILED");
  });

  it("exposes the errors bag", () => {
    const errors = { name: ["required"], email: ["invalid", "taken"] };
    const err = new ValidationError("bad input", errors);
    expect(err.errors).toEqual(errors);
  });

  it("message is set correctly", () => {
    const err = new ValidationError("The given data was invalid", { title: ["required"] });
    expect(err.message).toBe("The given data was invalid");
  });

  it("is an instance of Error", () => {
    const err = new ValidationError("fail", {});
    expect(err instanceof Error).toBe(true);
  });
});
