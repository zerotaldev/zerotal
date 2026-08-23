/**
 * The redirect half of the Inertia protocol, which is where its failures hide.
 *
 * A redirect the client cannot recognise as Inertia's is the worst shape a bug
 * can take: the request succeeds, the row is written, the mail goes out — and
 * the browser does nothing at all. The form sits there with the fields still
 * filled in, so it reads as a hang rather than an error, from both ends. That
 * shipped: the `X-Inertia` marker was set inside the 302→303 conversion, so a
 * handler that already returned the 303 the protocol asks for skipped the only
 * line that marked its response. `http.redirect(to, 303)` — the correct thing to
 * write — was the one spelling that broke.
 *
 * The status matters as much as the marker. A non-GET redirect has to become a
 * 303 or the browser repeats the method against the target: a POST that created
 * a booking, followed to the confirmation page, creating it again.
 */
import { describe, it, expect } from "bun:test";
import { HttpContext } from "@zerotal/core";
import type { NextFn } from "@zerotal/core";
import { InertiaMiddleware } from "./InertiaMiddleware.ts";

/** Run the middleware over a response the rest of the chain produced. */
async function run(
  request: { method?: string; inertia?: boolean; url?: string },
  response: Response | undefined,
): Promise<Response> {
  const http = HttpContext.fake(request.url ?? "http://localhost/register", {
    method: request.method ?? "POST",
    headers: request.inertia === false ? {} : { "X-Inertia": "true" },
  });
  const out = await new InertiaMiddleware().handle(http, (async () => response) as NextFn);
  return (out ?? response) as Response;
}

const redirect = (status: number, to = "/portal", headers: Record<string, string> = {}): Response =>
  new Response(null, { status, headers: { Location: to, ...headers } });

describe("an Inertia redirect is marked as one", () => {
  it("marks a 303 the handler returned itself", async () => {
    // The reported bug, exactly: `http.redirect("/portal", 303)` from a POST
    // handler. 303 is what the protocol asks a handler to send, and it was the
    // one status that fell through unmarked.
    const out = await run({ method: "POST" }, redirect(303));

    expect(out.status).toBe(303);
    expect(out.headers.get("X-Inertia")).toBe("true");
    expect(out.headers.get("Location")).toBe("/portal");
  });

  it("marks the 302 it converts, and converts it", async () => {
    const out = await run({ method: "POST" }, redirect(302));

    expect(out.status).toBe(303);
    expect(out.headers.get("X-Inertia")).toBe("true");
  });

  it("marks a redirect on a GET without changing its status", async () => {
    // Nothing to convert — a GET already follows with GET — but the client still
    // has to be able to tell this apart from a redirect meant for the browser.
    const out = await run({ method: "GET" }, redirect(302));

    expect(out.status).toBe(302);
    expect(out.headers.get("X-Inertia")).toBe("true");
  });

  it("marks 307 and 308 without converting them", async () => {
    // Preserving the method is the entire reason to choose these two. Rewriting
    // them to 303 would silently turn a deliberate re-POST into a GET.
    for (const status of [307, 308]) {
      const out = await run({ method: "POST" }, redirect(status));
      expect(out.status, `status ${status}`).toBe(status);
      expect(out.headers.get("X-Inertia"), `status ${status}`).toBe("true");
    }
  });

  it("converts every non-GET method, not only POST", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const out = await run({ method }, redirect(302));
      expect(out.status, method).toBe(303);
    }
  });

  it("leaves a redirect alone when the request is not Inertia's", async () => {
    // Marking every redirect in the application would tell the client that an
    // ordinary browser navigation was an Inertia response.
    const out = await run({ method: "POST", inertia: false }, redirect(302));

    expect(out.status).toBe(302);
    expect(out.headers.get("X-Inertia")).toBeNull();
  });
});

describe("what the redirect carries with it", () => {
  it("keeps Set-Cookie", async () => {
    // Rebuilding the response from `Location` alone dropped it once already:
    // `POST /login` answered 303 to the dashboard with the session cookie
    // discarded, and the user arrived still logged out.
    const out = await run(
      { method: "POST" },
      redirect(302, "/portal", { "Set-Cookie": "sid=abc" }),
    );

    expect(out.headers.get("Set-Cookie")).toBe("sid=abc");
  });

  it("keeps other headers the handler set", async () => {
    const out = await run(
      { method: "POST" },
      redirect(303, "/portal", { "X-Request-Id": "r-1", "Cache-Control": "no-store" }),
    );

    expect(out.headers.get("X-Request-Id")).toBe("r-1");
    expect(out.headers.get("Cache-Control")).toBe("no-store");
  });

  it("varies on X-Inertia so a cache cannot confuse the two shapes", async () => {
    const out = await run({ method: "POST" }, redirect(303));
    expect(out.headers.get("Vary")).toBe("X-Inertia");
  });

  it("does not overwrite a Vary the app already chose", async () => {
    const out = await run(
      { method: "POST" },
      redirect(303, "/portal", { Vary: "Accept-Encoding" }),
    );
    expect(out.headers.get("Vary")).toBe("Accept-Encoding");
  });

  it("falls back to / when the handler sent no Location", async () => {
    const out = await run({ method: "POST" }, new Response(null, { status: 302 }));
    expect(out.headers.get("Location")).toBe("/");
  });
});

describe("a redirect to a fragment", () => {
  it("becomes a 409 the client visits itself, so the fragment survives", async () => {
    // Following it normally would drop the `#section` on a full reload.
    const out = await run({ method: "POST" }, redirect(302, "/report#totals"));

    expect(out.status).toBe(409);
    expect(out.headers.get("X-Inertia-Redirect")).toBe("/report#totals");
    // Left in, the browser would follow it before the client could act.
    expect(out.headers.get("Location")).toBeNull();
    expect(out.headers.get("X-Inertia")).toBe("true");
  });
});

describe("asset version", () => {
  it("answers 409 with the location when the client's assets are stale", async () => {
    const { setAssetVersion } = await import("../version.ts");
    setAssetVersion("server-v2");

    const http = HttpContext.fake("http://localhost/page", {
      method: "GET",
      headers: { "X-Inertia": "true", "X-Inertia-Version": "client-v1" },
    });
    const out = (await new InertiaMiddleware().handle(
      http,
      (async () => new Response("never reached")) as NextFn,
    )) as Response;

    expect(out.status).toBe(409);
    expect(out.headers.get("X-Inertia-Location")).toBe("http://localhost/page");

    setAssetVersion("");
  });
});

describe("responses it must not touch", () => {
  it("leaves a stream alone", async () => {
    // Re-creating the Response would transfer the body and break a live SSE
    // connection.
    const body = new Response("data: hi\n\n", { headers: { "Content-Type": "text/event-stream" } });
    const out = await run({ method: "GET" }, body);

    expect(out).toBe(body);
  });

  it("passes through when the chain produced nothing", async () => {
    const out = await run({ method: "GET" }, undefined);
    expect(out).toBeUndefined();
  });
});
