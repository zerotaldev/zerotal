import { describe, it, expect } from "bun:test";
import { resolveProps } from "./resolveProps.ts";
import { optional, always, defer, merge, deepMerge, scroll } from "./PropTypes.ts";

const h = (init: Record<string, string> = {}): Headers => new Headers(init);
const partial = (component: string, extra: Record<string, string> = {}): Headers =>
  h({ "X-Inertia-Partial-Component": component, ...extra });

describe("resolveProps — partial reloads", () => {
  it("includes all non-optional props on a full visit", async () => {
    const r = await resolveProps({ a: 1, b: () => 2, c: optional(() => 3) }, h(), "Page");
    expect(r.props).toEqual({ a: 1, b: 2 });
  });

  it("returns only requested props on a partial reload", async () => {
    const r = await resolveProps(
      { a: 1, b: 2 },
      partial("Page", { "X-Inertia-Partial-Data": "a" }),
      "Page",
    );
    expect(r.props).toEqual({ a: 1 });
  });

  it("except takes precedence and excludes listed props", async () => {
    const r = await resolveProps(
      { a: 1, b: 2, c: 3 },
      partial("Page", { "X-Inertia-Partial-Except": "b" }),
      "Page",
    );
    expect(r.props).toEqual({ a: 1, c: 3 });
  });

  it("does not filter when the partial component does not match", async () => {
    const r = await resolveProps(
      { a: 1, b: 2 },
      partial("Other", { "X-Inertia-Partial-Data": "a" }),
      "Page",
    );
    expect(r.props).toEqual({ a: 1, b: 2 });
  });

  it("includes optional props only when explicitly requested", async () => {
    const raw = { a: 1, secret: optional(() => "s") };
    expect((await resolveProps(raw, h(), "Page")).props).toEqual({ a: 1 });
    const r = await resolveProps(
      raw,
      partial("Page", { "X-Inertia-Partial-Data": "secret" }),
      "Page",
    );
    expect(r.props).toEqual({ secret: "s" });
  });

  it("always() props survive only/except filtering", async () => {
    const r = await resolveProps(
      { a: 1, errors: always({}) },
      partial("Page", { "X-Inertia-Partial-Data": "a" }),
      "Page",
    );
    expect(r.props).toHaveProperty("errors");
    expect(r.props).toHaveProperty("a");
  });

  it("evaluates async factories", async () => {
    const r = await resolveProps({ x: async () => 9 }, h(), "Page");
    expect(r.props).toEqual({ x: 9 });
  });

  it("does not evaluate excluded lazy props", async () => {
    let called = false;
    await resolveProps(
      { a: 1, b: () => ((called = true), 2) },
      partial("Page", { "X-Inertia-Partial-Data": "a" }),
      "Page",
    );
    expect(called).toBe(false);
  });
});

describe("resolveProps — deferred props", () => {
  it("advertises deferred props by group and omits values on first load", async () => {
    const r = await resolveProps(
      { a: 1, perms: defer(() => ["read"]), teams: defer(() => ["t"], "attributes") },
      h(),
      "Page",
    );
    expect(r.props).toEqual({ a: 1 });
    expect(r.deferredProps).toEqual({ default: ["perms"], attributes: ["teams"] });
  });

  it("resolves a deferred prop when requested via partial only", async () => {
    const r = await resolveProps(
      { perms: defer(() => ["read"]) },
      partial("Page", { "X-Inertia-Partial-Data": "perms" }),
      "Page",
    );
    expect(r.props).toEqual({ perms: ["read"] });
    expect(r.deferredProps).toBeUndefined();
  });

  it("rescues a throwing deferred prop", async () => {
    const r = await resolveProps(
      {
        perms: defer(
          () => {
            throw new Error("boom");
          },
          "default",
          { rescue: true },
        ),
      },
      partial("Page", { "X-Inertia-Partial-Data": "perms" }),
      "Page",
    );
    expect(r.props).not.toHaveProperty("perms");
    expect(r.rescuedProps).toEqual(["perms"]);
  });

  it("re-throws a non-rescued deferred prop error", async () => {
    await expect(
      resolveProps(
        {
          perms: defer(() => {
            throw new Error("boom");
          }),
        },
        partial("Page", { "X-Inertia-Partial-Data": "perms" }),
        "Page",
      ),
    ).rejects.toThrow("boom");
  });
});

describe("resolveProps — merging", () => {
  it("advertises a root merge prop", async () => {
    const r = await resolveProps({ items: merge([1, 2, 3]) }, h(), "Page");
    expect(r.props).toEqual({ items: [1, 2, 3] });
    expect(r.mergeProps).toEqual(["items"]);
  });

  it("advertises nested append paths and matchOn", async () => {
    const r = await resolveProps(
      { users: merge({ data: [] }).append("data").matchOn("data.id") },
      h(),
      "Page",
    );
    expect(r.mergeProps).toEqual(["users.data"]);
    expect(r.matchPropsOn).toEqual(["users.data.id"]);
  });

  it("advertises deep merge and root prepend", async () => {
    const r = await resolveProps(
      { chat: deepMerge({ messages: [] }).matchOn("messages.id"), feed: merge([]).prepend() },
      h(),
      "Page",
    );
    expect(r.deepMergeProps).toEqual(["chat"]);
    expect(r.matchPropsOn).toEqual(["chat.messages.id"]);
    expect(r.prependProps).toEqual(["feed"]);
  });

  it("suppresses merge advertisement for reset props", async () => {
    const r = await resolveProps(
      { items: merge([1]) },
      partial("Page", { "X-Inertia-Partial-Data": "items", "X-Inertia-Reset": "items" }),
      "Page",
    );
    expect(r.props).toEqual({ items: [1] });
    expect(r.mergeProps).toBeUndefined();
  });
});

describe("resolveProps — once props", () => {
  it("advertises once props and resolves them on first request", async () => {
    const r = await resolveProps(
      { plans: optional(() => ["a"]).once() },
      partial("Page", { "X-Inertia-Partial-Data": "plans" }),
      "Page",
    );
    expect(r.props).toEqual({ plans: ["a"] });
    expect(r.onceProps).toEqual({ plans: { prop: "plans", expiresAt: null } });
  });

  it("skips resolving a once prop already loaded on the client", async () => {
    let calls = 0;
    const r = await resolveProps(
      {
        plans: always(() => {
          calls++;
          return ["a"];
        }).once(),
      },
      h({ "X-Inertia-Except-Once-Props": "plans" }),
      "Page",
    );
    expect(calls).toBe(0);
    expect(r.props).not.toHaveProperty("plans");
    expect(r.onceProps).toEqual({ plans: { prop: "plans", expiresAt: null } });
  });
});

describe("resolveProps — infinite scroll", () => {
  const paginator = { data: [{ id: 1 }], page: 2, perPage: 10, lastPage: 5, total: 50 };

  it("emits scrollProps and merges the data path", async () => {
    const r = await resolveProps({ posts: scroll(() => paginator) }, h(), "Page");
    expect(r.props["posts"]).toEqual(paginator);
    expect(r.mergeProps).toEqual(["posts.data"]);
    expect(r.scrollProps).toEqual({
      posts: { pageName: "page", previousPage: 1, nextPage: 3, currentPage: 2 },
    });
  });

  it("reports nextPage null on the last page", async () => {
    const r = await resolveProps(
      { posts: scroll({ data: [], page: 5, lastPage: 5 }) },
      h(),
      "Page",
    );
    expect(r.scrollProps!["posts"]!.nextPage).toBeNull();
    expect(r.scrollProps!["posts"]!.previousPage).toBe(4);
  });

  it("prepends the data path on a prepend merge intent", async () => {
    const r = await resolveProps(
      { posts: scroll({ data: [], page: 1, lastPage: 3 }) },
      h({ "X-Inertia-Infinite-Scroll-Merge-Intent": "prepend" }),
      "Page",
    );
    expect(r.prependProps).toEqual(["posts.data"]);
    expect(r.mergeProps).toBeUndefined();
  });

  it("honors a custom pageName", async () => {
    const r = await resolveProps(
      { items: scroll({ data: [], page: 1, lastPage: 2 }, { pageName: "p" }) },
      h(),
      "Page",
    );
    expect(r.scrollProps!["items"]!.pageName).toBe("p");
  });
});
