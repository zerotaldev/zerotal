/**
 * `Vary: Precognition`.
 *
 * A precognitive request asks the server to validate a form without running the
 * controller's side effects, and answers 204 or 422 instead of the real response.
 * The short-circuit itself lives in `FormRequest.validate()`; this middleware's
 * whole job is making sure those answers are never confused with real ones by a
 * cache.
 *
 * Getting it wrong is a caching bug, which is the kind that reproduces only in
 * production behind a CDN: without the `Vary`, a shared cache may serve a
 * precognitive 204 to a normal form submission — the user's data silently never
 * reaches the controller — or serve a real 302 to a keystroke-level validation
 * request. Overwriting an existing `Vary` is the same class of problem one layer
 * down, since it discards whatever content negotiation the app already relied on.
 */
import { describe, it, expect } from "bun:test";
import { HttpContext } from "@zerotal/core";
import type { NextFn } from "@zerotal/core";
import { PrecognitionMiddleware } from "./PrecognitionMiddleware.ts";

function ctx(headers: Record<string, string> = {}): HttpContext {
  return HttpContext.fake("http://localhost/orders", { method: "POST", headers });
}

/** Run the middleware over a response the chain produced. */
async function run(
  headers: Record<string, string>,
  response: Response | undefined,
): Promise<Response | void> {
  const next = (async () => response) as NextFn;
  return new PrecognitionMiddleware().handle(ctx(headers), next);
}

describe("PrecognitionMiddleware", () => {
  it("adds Vary: Precognition to a precognitive response", async () => {
    const out = await run({ Precognition: "true" }, new Response(null, { status: 204 }));
    expect((out as Response).headers.get("Vary")).toBe("Precognition");
  });

  it("leaves a normal request's response untouched", async () => {
    // Adding the header unconditionally would fragment the cache for every
    // ordinary request in the application.
    const out = await run({}, new Response("ok", { status: 200 }));
    expect(out).toBeUndefined();
  });

  it('treats any value other than "true" as not precognitive', async () => {
    // The header is a literal `true`; a client sending `1` or `false` is not
    // asking for precognition and must not get a varied response.
    for (const value of ["false", "1", "TRUE", ""]) {
      const out = await run({ Precognition: value }, new Response("ok"));
      expect(out, `Precognition: ${JSON.stringify(value)}`).toBeUndefined();
    }
  });

  it("appends to an existing Vary rather than replacing it", async () => {
    // Replacing it would discard the app's own content negotiation — the
    // response would stop varying on encoding and start being served wrong.
    const out = await run(
      { Precognition: "true" },
      new Response(null, { status: 422, headers: { Vary: "Accept-Encoding" } }),
    );
    expect((out as Response).headers.get("Vary")).toBe("Accept-Encoding, Precognition");
  });

  it("does not duplicate Precognition when it is already listed", async () => {
    const out = await run(
      { Precognition: "true" },
      new Response(null, { headers: { Vary: "Precognition" } }),
    );
    expect((out as Response).headers.get("Vary")).toBe("Precognition");
  });

  it("recognises an existing entry regardless of surrounding whitespace", async () => {
    const out = await run(
      { Precognition: "true" },
      new Response(null, { headers: { Vary: "Accept,  Precognition" } }),
    );
    expect((out as Response).headers.get("Vary")).toBe("Accept,  Precognition");
  });

  it("preserves the status and body it was handed", async () => {
    // The middleware decorates; it must not resynthesise the response and lose
    // the 422 body a precognitive validation failure carries.
    const out = (await run(
      { Precognition: "true" },
      new Response(JSON.stringify({ errors: { email: ["required"] } }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    )) as Response;
    expect(out.status).toBe(422);
    expect(out.headers.get("Content-Type")).toBe("application/json");
    expect(await out.json()).toEqual({ errors: { email: ["required"] } });
  });

  it("does nothing when the chain produced no response", async () => {
    const out = await run({ Precognition: "true" }, undefined);
    expect(out).toBeUndefined();
  });
});
