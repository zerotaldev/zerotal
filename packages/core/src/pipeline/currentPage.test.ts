import { describe, expect, it } from "bun:test";
import { HttpContext } from "./HttpContext.ts";
import { RequestContext } from "../context/RequestContext.ts";
import { currentPage, setCurrentPageResolver } from "./currentPage.ts";

const inRequest = <T>(url: string, fn: () => T): T => RequestContext.run(HttpContext.fake(url), fn);

describe("currentPage", () => {
  it("reads the query string when nothing else is registered", () => {
    expect(inRequest("http://localhost/posts?page=3", () => currentPage())).toBe(3);
  });

  it("falls back to page 1 with no query string", () => {
    expect(inRequest("http://localhost/posts", () => currentPage())).toBe(1);
  });

  it("reads a named paginator from the query string", () => {
    expect(inRequest("http://localhost/x?invoices=4", () => currentPage("invoices"))).toBe(4);
  });

  it("prefers a resolver registered for the request", () => {
    const page = inRequest("http://localhost/posts?page=3", () => {
      setCurrentPageResolver(() => 7);
      return currentPage();
    });

    expect(page).toBe(7);
  });

  it("passes the paginator name to the resolver", () => {
    const seen: string[] = [];
    inRequest("http://localhost/x", () => {
      setCurrentPageResolver((name) => {
        seen.push(name);
        return 2;
      });
      currentPage();
      currentPage("invoices");
    });

    expect(seen).toEqual(["page", "invoices"]);
  });

  it("defers to the query string when the resolver returns undefined", () => {
    const page = inRequest("http://localhost/posts?page=5", () => {
      setCurrentPageResolver(() => undefined);
      return currentPage();
    });

    expect(page).toBe(5);
  });

  it("never returns below 1", () => {
    expect(inRequest("http://localhost/posts?page=0", () => currentPage())).toBe(1);
    expect(inRequest("http://localhost/posts?page=-4", () => currentPage())).toBe(1);
  });

  it("is 1 outside a request — a worker or CLI command has no page", () => {
    expect(currentPage()).toBe(1);
  });

  // The resolver lives on the request's own context, so overlapping requests each see their
  // own. This pins that, since a module-level slot would read identically at the call site.
  it("does not leak a resolver between concurrent requests", async () => {
    const request = (url: string, resolver?: number) =>
      RequestContext.run(HttpContext.fake(url), async () => {
        if (resolver !== undefined) setCurrentPageResolver(() => resolver);
        await Bun.sleep(1); // yield, so the two requests interleave
        return currentPage();
      });

    const [withResolver, plain] = await Promise.all([
      request("http://localhost/a?page=1", 9),
      request("http://localhost/b?page=2"),
    ]);

    expect(withResolver).toBe(9); // its own resolver
    expect(plain).toBe(2); // its own query string, untouched by the other
  });
});
