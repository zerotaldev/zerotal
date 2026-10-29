/**
 * What the log says when a request ends in a thrown error.
 *
 * A 403, a 409 or an `abort(422)` is thrown on purpose and answered as such. Each was
 * logged at error level twice, once as `Unhandled error` and once as a pipeline error with
 * a stack built inside the listener, which buried the real faults in the log. A thrown 4xx
 * is now one warning without a stack, and a 5xx still logs at error level with the stack of
 * the throw itself.
 *
 * Only an error the framework raised to answer the client counts. An `HttpClientError` from an
 * upstream 401 is answered with a 401 too, but it is a fault in this request, so it is logged at
 * error level with its stack and reported like any other.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Application } from "../application/Application.ts";
import { ExceptionHandler } from "../application/ExceptionHandler.ts";
import { Router } from "../router/Router.ts";
import { ConflictError, ForbiddenError } from "../errors/HttpError.ts";
import { HttpClientResponse } from "../http/HttpClient.ts";
import { abort } from "../helpers/response.ts";
import { LogManager } from "../logger/LogManager.ts";
import { LoggingConfig } from "../logger/config.ts";
import type { LogEntry } from "../logger/types.ts";
import { LogProvider } from "./LogProvider.ts";

let app: Application;
let base: string;
let entries: LogEntry[] = [];
let untap: () => void = () => {};
/** What the app's exception handler reported: every error it did not skip. */
let reported: unknown[] = [];

class RecordingHandler extends ExceptionHandler {
  override report(error: unknown): Promise<void> {
    if (this.shouldReport(error)) reported.push(error);
    return Promise.resolve();
  }
}

beforeAll(async () => {
  Application._resetInstance();
  Router.reset();
  // No file trail: whatever APP_ENV an earlier file left behind, this suite writes nothing to disk.
  const logging = { ...LoggingConfig({ file: false }) };
  app = Application.create({
    env: "test",
    providers: [LogProvider],
    config: { logging },
  }).withExceptionHandler(RecordingHandler);
  await app.boot();
  Router.get("/forbidden", () => {
    throw new ForbiddenError();
  });
  Router.get("/conflict", () => {
    throw new ConflictError("Already shipped");
  });
  Router.get("/aborted", () => abort(422, "Quantity must be positive"));
  Router.get("/aborted-403", () => abort(403, "Not your invoice"));
  // What `Http.get(url).throw()` throws when the upstream says 401. It carries the status and
  // the default renderer answers with it, but nothing here chose to refuse the client.
  Router.get("/upstream", () =>
    new HttpClientResponse(new Response(null, { status: 401 })).throw(),
  );
  // What the validator throws for a form with a mistake in it: answered with a 303.
  Router.get("/redirected", () => {
    throw Object.assign(new Error("Validation failed"), {
      name: "ValidationRedirectError",
      redirectTo: "/form",
    });
  });
  Router.get("/broken", () => {
    throw new TypeError("stock is undefined");
  });
  await app.start(0);
  const server = (app as unknown as { _static?: { port: number } })._static;
  base = `http://localhost:${server?.port}`;
  untap = LogManager.tap((entry) => entries.push(entry));
});

afterAll(async () => {
  untap();
  await app?.close?.();
  Router.reset();
});

/** The entries one request wrote, and what it reported. The pipeline logs before it responds. */
async function logFor(path: string): Promise<{ status: number; logged: LogEntry[] }> {
  entries = [];
  reported = [];
  const res = await fetch(`${base}${path}`, { redirect: "manual" });
  await res.arrayBuffer();
  return { status: res.status, logged: entries };
}

function summary(logged: LogEntry[]) {
  return logged.map((e) => ({ level: e.level, message: e.message, stack: e.stack !== undefined }));
}

describe("a request that ends in a thrown error", () => {
  it("logs a thrown 403 as one warning, without a stack, and does not report it", async () => {
    const { status, logged } = await logFor("/forbidden");

    expect(status).toBe(403);
    expect(summary(logged)).toEqual([{ level: "warn", message: "Request warning", stack: false }]);
    expect(logged[0]!.context).toMatchObject({
      method: "GET",
      path: "/forbidden",
      status: 403,
      error: "ForbiddenError: Forbidden",
    });
    expect(reported).toEqual([]);
  });

  it("logs a thrown 409 as one warning that says why", async () => {
    const { status, logged } = await logFor("/conflict");

    expect(status).toBe(409);
    expect(summary(logged)).toEqual([{ level: "warn", message: "Request warning", stack: false }]);
    expect(logged[0]!.context).toMatchObject({
      status: 409,
      error: "ConflictError: Already shipped",
    });
  });

  it("logs abort(422) as one warning, and does not report it", async () => {
    const { status, logged } = await logFor("/aborted");

    expect(status).toBe(422);
    expect(summary(logged)).toEqual([{ level: "warn", message: "Request warning", stack: false }]);
    expect(reported).toEqual([]);
  });

  it("logs abort(403) as one warning, and does not report it", async () => {
    const { status, logged } = await logFor("/aborted-403");

    expect(status).toBe(403);
    expect(summary(logged)).toEqual([{ level: "warn", message: "Request warning", stack: false }]);
    expect(logged[0]!.context).toMatchObject({ status: 403, error: "HttpError: Not your invoice" });
    expect(reported).toEqual([]);
  });

  it("logs nothing for a thrown outcome answered below 400, as for a returned one", async () => {
    const { status, logged } = await logFor("/redirected");

    expect(status).toBe(303);
    expect(summary(logged)).toEqual([]);
  });

  // The client is answered with the upstream's 401, but this request refused no one: something
  // it depends on failed, which is what the error log and the error tracker are for.
  it("logs an upstream 401 at error level with the stack of the throw, and reports it", async () => {
    const { status, logged } = await logFor("/upstream");

    expect(status).toBe(401);
    expect(summary(logged)).toEqual([
      { level: "error", message: "Request pipeline error", stack: true },
    ]);
    // Where it was thrown, not an Error built inside the listener.
    expect(logged[0]!.stack).toStartWith("HttpClientError: HTTP 401");
    expect(logged[0]!.stack).toContain("HttpClient.ts:");
    expect(logged[0]!.stack).not.toContain("LogProvider.ts:");
    expect(reported).toHaveLength(1);
    expect(reported[0]).toHaveProperty("name", "HttpClientError");
  });

  it("logs a 500 at error level with the stack of the throw, and reports it", async () => {
    const { status, logged } = await logFor("/broken");

    expect(status).toBe(500);
    const failure = logged.find((e) => e.message === "Request pipeline error");
    expect(failure?.level).toBe("error");
    expect(failure?.error).toBe("stock is undefined");
    // The thrown error's own name and frames, not an Error built inside the listener.
    expect(failure?.stack).toStartWith("TypeError: stock is undefined");
    expect(failure?.stack).toContain("LogProvider.test.ts");
    expect(failure?.stack).not.toContain("LogProvider.ts:");
    expect(reported).toHaveLength(1);
  });
});
