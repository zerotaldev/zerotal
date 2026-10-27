import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { HttpContext, _resetUnreadBodyWarnings } from "./HttpContext.ts";
import { Application } from "../application/Application.ts";

/**
 * `ctx.input(key)` looks at route params, then the parsed body, then the query string. When
 * nothing has read the body yet, the body step is skipped and the fallback comes back, exactly as
 * it would for a field that was never sent. A route read `ctx.input("proof_id")`, got `undefined`,
 * turned it into `NaN` and answered 404 for a row that existed. The answer was right-shaped and
 * wrong, so nothing said what had happened.
 */
let out = "";
const original = process.stdout.write.bind(process.stdout);
let savedEnv: string | undefined;

beforeEach(() => {
  Application._resetInstance(); // no ambient app, so frameworkLog() writes to stdout
  _resetUnreadBodyWarnings();
  savedEnv = Bun.env["APP_ENV"];
  Bun.env["APP_ENV"] = "local";
  out = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = original;
  if (savedEnv === undefined) delete Bun.env["APP_ENV"];
  else Bun.env["APP_ENV"] = savedEnv;
  _resetUnreadBodyWarnings();
});

const jsonPost = (url = "http://localhost/proofs") =>
  HttpContext.fake(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proof_id: 7 }),
  });

describe("ctx.input() on a request whose body has not been read", () => {
  it("still returns the fallback, and says why", () => {
    const ctx = jsonPost();

    expect(ctx.input("proof_id")).toBeUndefined();
    expect(out).toContain('ctx.input("proof_id") found nothing');
    expect(out).toContain("has not been read");
    expect(out).toContain("await ctx.body()");
  });

  it("says it once per route and key, not once per request", () => {
    jsonPost().input("proof_id");
    const first = out;
    jsonPost().input("proof_id");

    expect(out).toBe(first);
  });

  it("says nothing once the body has been read, and finds the field", async () => {
    const ctx = jsonPost();
    await ctx.body();

    expect(ctx.input<number>("proof_id")).toBe(7);
    expect(out).toBe("");
  });

  it("says nothing for a field the query string has", () => {
    expect(jsonPost("http://localhost/proofs?proof_id=3").input<string>("proof_id")).toBe("3");
    expect(out).toBe("");
  });

  it("says nothing for a GET, which has no body to read", () => {
    HttpContext.fake("http://localhost/proofs").input("proof_id");

    expect(out).toBe("");
  });

  it("says nothing for a POST that sent no form or JSON", () => {
    HttpContext.fake("http://localhost/ping", { method: "POST" }).input("proof_id");

    expect(out).toBe("");
  });

  it("says nothing in production", () => {
    Bun.env["APP_ENV"] = "production";

    expect(jsonPost().input("proof_id")).toBeUndefined();
    expect(out).toBe("");
  });

  it("covers a form post as well as JSON", () => {
    HttpContext.fake("http://localhost/proofs", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "proof_id=7",
    }).input("proof_id");

    expect(out).toContain('ctx.input("proof_id") found nothing');
  });
});
