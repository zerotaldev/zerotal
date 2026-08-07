import { describe, it, expect } from "bun:test";
import { ExceptionHandler } from "./ExceptionHandler.ts";
import {
  MethodNotAllowedError,
  ConflictError,
  GoneError,
  UnprocessableEntityError,
  TooManyRequestsError,
  ServiceUnavailableError,
  BadRequestError,
  NotFoundError,
  HttpError,
} from "../errors/index.ts";
import { HttpContext } from "../pipeline/HttpContext.ts";
import { ScopedResolver } from "../container/ScopedResolver.ts";

function jsonCtx(): HttpContext {
  return new HttpContext(
    new Request("http://localhost/", { headers: { Accept: "application/json" } }),
    new ScopedResolver(),
  );
}
function htmlCtx(): HttpContext {
  return new HttpContext(
    new Request("http://localhost/", { headers: { Accept: "text/html,*/*;q=0.8" } }),
    new ScopedResolver(),
  );
}

describe("new HTTP error types — statuses", () => {
  const cases: [HttpError, number][] = [
    [new BadRequestError(), 400],
    [new ConflictError(), 409],
    [new GoneError(), 410],
    [new UnprocessableEntityError(), 422],
    [new MethodNotAllowedError(), 405],
    [new TooManyRequestsError(), 429],
    [new ServiceUnavailableError(), 503],
  ];
  for (const [err, status] of cases) {
    it(`${err.constructor.name} -> ${status}`, async () => {
      const res = await ExceptionHandler.defaultRender(err, jsonCtx());
      expect(res.status).toBe(status);
    });
  }
});

describe("error response headers", () => {
  it("TooManyRequestsError advertises Retry-After (JSON)", async () => {
    const res = await ExceptionHandler.defaultRender(new TooManyRequestsError(30), jsonCtx());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
  });
  it("ServiceUnavailableError sets Retry-After and reason message", async () => {
    const res = await ExceptionHandler.defaultRender(
      new ServiceUnavailableError("maintenance", 120),
      jsonCtx(),
    );
    const body = (await res.json()) as { message: string };
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("120");
    expect(body.message).toContain("maintenance");
  });
  it("MethodNotAllowedError advertises the Allow header", async () => {
    const res = await ExceptionHandler.defaultRender(
      new MethodNotAllowedError(["GET", "POST"]),
      jsonCtx(),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, POST");
  });
  it("merges headers onto the HTML error page too", async () => {
    const res = await ExceptionHandler.defaultRender(new TooManyRequestsError(15), htmlCtx());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("15");
  });
});

class CustomError extends Error {
  name = "CustomError";
}
class SilencingHandler extends ExceptionHandler {
  protected override dontReport = [CustomError];
}

describe("dontReport / report()", () => {
  it("suppresses logging for classes listed in dontReport", async () => {
    const handler = new SilencingHandler();
    const logs: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => {
      logs.push(a);
    };
    try {
      await handler.report(new CustomError("quiet"));
      await handler.report(new Error("loud"));
    } finally {
      console.error = orig;
    }
    expect(logs).toHaveLength(1);
  });
  it("always suppresses NotFoundError by default", async () => {
    const handler = new SilencingHandler();
    const logs: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => {
      logs.push(a);
    };
    try {
      await handler.report(new NotFoundError());
    } finally {
      console.error = orig;
    }
    expect(logs).toHaveLength(0);
  });
});
