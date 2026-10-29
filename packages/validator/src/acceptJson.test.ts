import { describe, it, expect } from "bun:test";
import { ExceptionHandler, HttpContext, NotFoundError, RequestContext } from "@zerotal/core";
import { validate } from "./validate.ts";
import { FormRequest } from "./FormRequest.ts";
import type { RuleBuilder } from "./RuleBuilder.ts";
import { ValidationJsonError, ValidationRedirectError } from "./ValidationError.ts";

/**
 * An `Accept` that prefers `application/json` wins over `X-Inertia`.
 *
 * Both validators answered any request carrying `X-Inertia: true` with a redirect, whatever it
 * asked for, so a test client that kept the Inertia header on a JSON call got a 303 where it
 * expected a 422. Inertia's own client sends `Accept: text/html, application/xhtml+xml`, so a real
 * visit never asks for JSON and still redirects back.
 */

const INERTIA_VISIT = "text/html, application/xhtml+xml";

const post = (accept: string) =>
  HttpContext.fake("http://localhost/items", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Inertia": "true", Accept: accept },
    body: "{}",
  });

class StoreItemRequest extends FormRequest {
  rules(r: RuleBuilder) {
    return { name: r.string() };
  }
}

const failure = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected validation to fail");
};

describe("X-Inertia with Accept: application/json", () => {
  it("validate() answers with a JSON error", async () => {
    const ctx = post("application/json");
    const error = await failure(() => validate(ctx, (r) => ({ name: r.string() })));
    expect(error).toBeInstanceOf(ValidationJsonError);

    const res = await ExceptionHandler.defaultRender(error, ctx);
    expect(res.status).toBe(422);
  });

  it("FormRequest answers with a JSON error", async () => {
    const ctx = post("application/json");
    const error = await failure(() => RequestContext.run(ctx, () => StoreItemRequest.validate()));
    expect(error).toBeInstanceOf(ValidationJsonError);
  });

  it("a real Inertia visit redirects back", async () => {
    const ctx = post(INERTIA_VISIT);
    const error = await failure(() => validate(ctx, (r) => ({ name: r.string() })));
    expect(error).toBeInstanceOf(ValidationRedirectError);
    expect((await ExceptionHandler.defaultRender(error, ctx)).status).toBe(303);
  });

  it("FormRequest redirects a real Inertia visit back too", async () => {
    expect(
      await failure(() =>
        RequestContext.run(post(INERTIA_VISIT), () => StoreItemRequest.validate()),
      ),
    ).toBeInstanceOf(ValidationRedirectError);
  });
});

/**
 * JSON only when Accept prefers it to HTML, by q-value and then by order: the exception
 * handler's rule, so a client that gets a redirect for a validation error gets the HTML page for
 * a 404, and one that gets a 422 gets a JSON 404.
 */
describe("Accept naming both JSON and HTML", () => {
  const plain = (accept: string) =>
    HttpContext.fake("http://localhost/items", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: accept },
      body: "{}",
    });

  const outcome = async (accept: string) => {
    const viaValidate = await failure(() => validate(plain(accept), (r) => ({ name: r.string() })));
    const viaFormRequest = await failure(() =>
      RequestContext.run(plain(accept), () => StoreItemRequest.validate()),
    );
    const notFound = await ExceptionHandler.defaultRender(new NotFoundError(), plain(accept));
    return [
      viaValidate instanceof ValidationJsonError ? "json" : "redirect",
      viaFormRequest instanceof ValidationJsonError ? "json" : "redirect",
      (notFound.headers.get("Content-Type") ?? "").split(";")[0],
    ];
  };

  it("application/json alone gets JSON", async () => {
    expect(await outcome("application/json")).toEqual(["json", "json", "application/json"]);
  });

  it("text/html listed first, at the same q, gets the redirect and the HTML page", async () => {
    expect(await outcome("text/html, application/json")).toEqual([
      "redirect",
      "redirect",
      "text/html",
    ]);
  });

  it("application/json listed first gets JSON", async () => {
    expect(await outcome("application/json, text/html")).toEqual([
      "json",
      "json",
      "application/json",
    ]);
  });

  it("a browser's Accept gets the redirect and the HTML page", async () => {
    expect(
      await outcome("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
    ).toEqual(["redirect", "redirect", "text/html"]);
  });
});
