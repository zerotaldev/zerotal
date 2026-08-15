import { describe, it, expect, beforeEach } from "bun:test";
import {
  DEFAULT_REDACTED_HEADERS,
  DEFAULT_REDACTED_KEYS,
  REDACTED,
  isSensitiveKey,
  redactHeaders,
  redactValue,
} from "./redact.ts";
import {
  clearEntries,
  entryCount,
  getEntry,
  listEntries,
  parseListQuery,
  putEntry,
  setMaxEntries,
} from "./store.ts";
import { devtoolsScriptTag } from "./middleware.ts";
import { DEVTOOLS_REQUEST_HEADERS, DEVTOOLS_RESPONSE_HEADERS } from "./types.ts";
import type { DevtoolsEntry, DevtoolsRequestType } from "./types.ts";

// ── Redaction ────────────────────────────────────────────────────────────────

describe("devtools redaction", () => {
  it("matches sensitive keys as case-insensitive substrings", () => {
    // The whole point of substring matching: one pattern covers the variants.
    expect(isSensitiveKey("password_confirmation", DEFAULT_REDACTED_KEYS)).toBe(true);
    expect(isSensitiveKey("currentPassword", DEFAULT_REDACTED_KEYS)).toBe(true);
    expect(isSensitiveKey("API_KEY", DEFAULT_REDACTED_KEYS)).toBe(true);
    expect(isSensitiveKey("username", DEFAULT_REDACTED_KEYS)).toBe(false);
  });

  it("redacts sensitive headers whatever their casing", () => {
    const headers = new Headers();
    headers.set("Authorization", "Bearer super-secret");
    headers.set("Cookie", "session=abc");
    headers.set("Accept", "application/json");

    const out = redactHeaders(headers, DEFAULT_REDACTED_HEADERS);

    expect(out["authorization"]).toBe(REDACTED);
    expect(out["cookie"]).toBe(REDACTED);
    expect(out["accept"]).toBe("application/json");
  });

  it("redacts sensitive keys at any depth", () => {
    const out = redactValue(
      { user: { name: "Ada", password: "hunter2", tokens: { api_key: "k" } } },
      DEFAULT_REDACTED_KEYS,
    ) as Record<string, Record<string, unknown>>;

    expect(out["user"]!["name"]).toBe("Ada");
    expect(out["user"]!["password"]).toBe(REDACTED);
    // `tokens` matches "token" itself, so the whole subtree goes.
    expect(out["user"]!["tokens"]).toBe(REDACTED);
  });

  it("survives a cycle instead of throwing", () => {
    const node: Record<string, unknown> = { name: "root" };
    node["self"] = node;

    const out = redactValue(node) as Record<string, unknown>;

    expect(out["name"]).toBe("root");
    expect(out["self"]).toBe("[Circular]");
    // Must remain serialisable — the entry is JSON on the wire.
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it("does not mistake a repeated sibling for a cycle", () => {
    const shared = { id: 1 };
    const out = redactValue({ a: shared, b: shared }) as Record<string, unknown>;
    expect(out["a"]).toEqual({ id: 1 });
    expect(out["b"]).toEqual({ id: 1 });
  });

  it("summarises files rather than inlining them", () => {
    const file = new File(["x".repeat(64)], "avatar.png", { type: "image/png" });
    expect(redactValue({ file }) as Record<string, string>).toEqual({
      file: "[File: avatar.png, 64 bytes, image/png]",
    });
  });

  it("bounds recursion depth", () => {
    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 40; i++) deep = { nested: deep };
    expect(() => JSON.stringify(redactValue(deep))).not.toThrow();
    expect(JSON.stringify(redactValue(deep))).toContain("[Max depth]");
  });

  it("passes primitives and dates through predictably", () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(null)).toBe(null);
    expect(redactValue(new Date("2026-08-15T00:00:00.000Z"))).toBe("2026-08-15T00:00:00.000Z");
  });
});

// ── Store ────────────────────────────────────────────────────────────────────

function entry(id: string, over: Partial<DevtoolsEntry["__meta"]> = {}): DevtoolsEntry {
  return {
    __meta: {
      id,
      method: "GET",
      url: `https://app.test/${id}`,
      status: 200,
      requestType: "navigate",
      component: "Posts/Index",
      timestamp: "2026-08-15T00:00:00.000Z",
      utime: 1786752000,
      tabUuid: null,
      batchId: null,
      serverTimingMs: 1,
      ...over,
    },
    http: {
      requestHeaders: {},
      responseHeaders: {},
      requestBody: { status: "empty" },
      responseBody: { status: "empty" },
    },
    props: {},
    route: { uri: "/posts", name: "posts.index", action: null },
    renderSource: null,
    componentPath: null,
  };
}

describe("devtools store", () => {
  beforeEach(() => {
    clearEntries();
    setMaxEntries(200);
  });

  it("returns entries newest first", () => {
    putEntry(entry("a"));
    putEntry(entry("b"));
    expect(listEntries().map((e) => e.__meta.id)).toEqual(["b", "a"]);
  });

  it("looks an entry up by id", () => {
    putEntry(entry("a"));
    expect(getEntry("a")?.__meta.id).toBe("a");
    expect(getEntry("nope")).toBeUndefined();
  });

  it("drops the oldest once the cap is reached", () => {
    setMaxEntries(2);
    putEntry(entry("a"));
    putEntry(entry("b"));
    putEntry(entry("c"));
    expect(entryCount()).toBe(2);
    expect(listEntries().map((e) => e.__meta.id)).toEqual(["c", "b"]);
  });

  it("trims immediately when the cap is lowered", () => {
    putEntry(entry("a"));
    putEntry(entry("b"));
    putEntry(entry("c"));
    setMaxEntries(1);
    expect(listEntries().map((e) => e.__meta.id)).toEqual(["c"]);
  });

  it("filters by component", () => {
    putEntry(entry("a", { component: "Posts/Index" }));
    putEntry(entry("b", { component: "Posts/Show" }));
    expect(listEntries({ component: "Posts/Show" }).map((e) => e.__meta.id)).toEqual(["b"]);
  });

  it("keeps `type` then drops `exclude`", () => {
    putEntry(entry("a", { requestType: "navigate" }));
    putEntry(entry("b", { requestType: "prefetch" }));
    putEntry(entry("c", { requestType: "poll" }));

    const types: DevtoolsRequestType[] = ["navigate", "prefetch"];
    expect(listEntries({ type: types }).map((e) => e.__meta.id)).toEqual(["b", "a"]);
    expect(listEntries({ type: types, exclude: ["prefetch"] }).map((e) => e.__meta.id)).toEqual([
      "a",
    ]);
  });

  it("pages the filtered list, not the raw one", () => {
    putEntry(entry("a", { component: "X" }));
    putEntry(entry("b", { component: "Y" }));
    putEntry(entry("c", { component: "Y" }));
    // Newest-first Y is [c, b]; offset 1 must give b, not skip past a match.
    expect(listEntries({ component: "Y", offset: 1 }).map((e) => e.__meta.id)).toEqual(["b"]);
    expect(listEntries({ component: "Y", limit: 1 }).map((e) => e.__meta.id)).toEqual(["c"]);
  });

  it("parses the read API's query string", () => {
    const q = parseListQuery(
      new URLSearchParams(
        "component=Posts/Index&type=navigate,poll&exclude=prefetch&offset=2&limit=5",
      ),
    );
    expect(q).toEqual({
      component: "Posts/Index",
      type: ["navigate", "poll"],
      exclude: ["prefetch"],
      offset: 2,
      limit: 5,
    });
  });

  it("omits filters that were not supplied, and ignores junk numbers", () => {
    expect(parseListQuery(new URLSearchParams(""))).toEqual({});
    expect(parseListQuery(new URLSearchParams("type=,,&limit=abc"))).toEqual({});
  });
});

// ── Protocol surface ─────────────────────────────────────────────────────────

describe("devtools protocol constants", () => {
  it("uses the exact header names the extension looks for", () => {
    // Hard-coded rather than derived: these are a wire contract, and a rename
    // that silently breaks discovery is exactly what this asserts against.
    expect(DEVTOOLS_REQUEST_HEADERS.tab).toBe("X-Inertia-Devtools-Tab");
    expect(DEVTOOLS_REQUEST_HEADERS.visit).toBe("X-Inertia-Devtools-Visit");
    expect(DEVTOOLS_REQUEST_HEADERS.parent).toBe("X-Inertia-Devtools-Parent");
    expect(DEVTOOLS_REQUEST_HEADERS.deferred).toBe("X-Inertia-Devtools-Deferred");
    expect(DEVTOOLS_REQUEST_HEADERS.poll).toBe("X-Inertia-Devtools-Poll");
    expect(DEVTOOLS_RESPONSE_HEADERS.id).toBe("X-Inertia-Devtools-Id");
    expect(DEVTOOLS_RESPONSE_HEADERS.parentOut).toBe("X-Inertia-Devtools-Parent-Out");
  });

  it("emits the discovery tag as a JSON string", () => {
    const tag = devtoolsScriptTag("0199-abc");
    expect(tag).toBe(
      '<script data-inertia-devtools-id type="application/json">"0199-abc"</script>',
    );
    // The extension JSON.parses the contents; a bare id would not parse.
    const body = tag.slice(tag.indexOf(">") + 1, tag.lastIndexOf("<"));
    expect(JSON.parse(body)).toBe("0199-abc");
  });
});
