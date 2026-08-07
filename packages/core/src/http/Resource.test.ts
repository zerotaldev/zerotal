import { describe, it, expect, afterEach } from "bun:test";
import { Resource, ResourceCollection } from "./Resource.ts";
import type { PaginatedData } from "./Resource.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

interface User {
  id: number;
  name: string;
  email: string;
  password: string;
}

class UserResource extends Resource<User> {
  toArray(): Record<string, unknown> {
    return { id: this.resource.id, name: this.resource.name, email: this.resource.email };
  }
}

const alice: User = { id: 1, name: "Alice", email: "alice@example.com", password: "secret" };
const bob: User = { id: 2, name: "Bob", email: "bob@example.com", password: "secret" };

afterEach(() => Resource.withWrapping()); // reset between tests

// ── Single resource ───────────────────────────────────────────────────────────

describe("Resource.toArray()", () => {
  it("returns only the declared fields", () => {
    const r = new UserResource(alice).toArray();
    expect(r).toEqual({ id: 1, name: "Alice", email: "alice@example.com" });
    expect("password" in r).toBe(false);
  });
});

describe("Resource.toJson()", () => {
  it("wraps in { data: ... } by default", () => {
    const json = new UserResource(alice).toJson();
    expect(json).toHaveProperty("data");
    expect((json.data as Record<string, unknown>).id).toBe(1);
  });

  it("omits wrapper when withoutWrapping() is set", () => {
    Resource.withoutWrapping();
    const json = new UserResource(alice).toJson();
    expect(json).not.toHaveProperty("data");
    expect(json.id).toBe(1);
  });
});

describe("Resource.toResponse()", () => {
  it("returns a 200 JSON Response by default", async () => {
    const res = new UserResource(alice).toResponse();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const body = (await res.json()) as Record<string, unknown>;
    expect((body.data as Record<string, unknown>).name).toBe("Alice");
  });

  it("accepts a custom status code", async () => {
    const res = new UserResource(alice).toResponse(201);
    expect(res.status).toBe(201);
  });
});

// ── Collection ────────────────────────────────────────────────────────────────

describe("Resource.collection()", () => {
  it("returns { data: [...] } with all items", () => {
    const result = UserResource.collection(UserResource, [alice, bob]);
    expect(result).toHaveProperty("data");
    const data = result.data as Record<string, unknown>[];
    expect(data).toHaveLength(2);
    expect(data[0]?.name).toBe("Alice");
    expect(data[1]?.name).toBe("Bob");
  });

  it("excludes hidden fields from every item", () => {
    const result = UserResource.collection(UserResource, [alice]);
    const item = (result.data as Record<string, unknown>[])[0]!;
    expect("password" in item).toBe(false);
  });

  it("accepts optional meta object", () => {
    const result = UserResource.collection(UserResource, [alice], { total: 1, page: 1 });
    expect((result.meta as Record<string, unknown>).total).toBe(1);
  });

  it("omits wrapper when withoutWrapping() is set", () => {
    Resource.withoutWrapping();
    const result = UserResource.collection(UserResource, [alice]);
    // flat mode returns the bare array, not a { data } envelope
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });
});

// ── Wrapping toggle ───────────────────────────────────────────────────────────

describe("Resource.withoutWrapping() / withWrapping()", () => {
  it("withoutWrapping() disables the envelope", () => {
    Resource.withoutWrapping();
    expect(Resource.wrapping()).toBe(false);
  });

  it("withWrapping() re-enables the envelope", () => {
    Resource.withoutWrapping();
    Resource.withWrapping();
    expect(Resource.wrapping()).toBe(true);
  });
});

// ── ResourceCollection ────────────────────────────────────────────────────────

/** Minimal PaginatedData fixture — matches the PaginateResult shape. */
function makePaginated(
  items: User[],
  page: number,
  perPage: number,
  total: number,
): PaginatedData<User> {
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const pageUrl = (p: number) => `?page=${p}`;
  return {
    data: items,
    total,
    page,
    perPage,
    lastPage,
    nextPageUrl: (_base = "", _q = {}) => (page < lastPage ? pageUrl(page + 1) : null),
    previousPageUrl: (_base = "", _q = {}) => (page > 1 ? pageUrl(page - 1) : null),
  };
}

describe("ResourceCollection.of()", () => {
  it("transforms each item through the Resource class", () => {
    const paginated = makePaginated([alice, bob], 1, 10, 2);
    const result = ResourceCollection.of(UserResource, paginated);
    const data = result.data as Record<string, unknown>[];
    expect(data).toHaveLength(2);
    expect(data[0]?.name).toBe("Alice");
    expect(data[1]?.name).toBe("Bob");
  });

  it("excludes hidden fields from items", () => {
    const paginated = makePaginated([alice], 1, 10, 1);
    const result = ResourceCollection.of(UserResource, paginated);
    const item = (result.data as Record<string, unknown>[])[0]!;
    expect("password" in item).toBe(false);
  });

  it("includes correct meta fields", () => {
    const paginated = makePaginated([alice, bob], 2, 1, 3);
    const result = ResourceCollection.of(UserResource, paginated);
    const meta = result.meta as Record<string, unknown>;
    expect(meta.current_page).toBe(2);
    expect(meta.last_page).toBe(3);
    expect(meta.total).toBe(3);
    expect(meta.per_page).toBe(1);
    expect(meta.from).toBe(2); // (page-1)*perPage + 1 = 2
    expect(meta.to).toBe(3); // 2-1)*perPage + data.length = 3
  });

  it("meta.from/to are null when data is empty", () => {
    const paginated = makePaginated([], 1, 10, 0);
    const result = ResourceCollection.of(UserResource, paginated);
    const meta = result.meta as Record<string, unknown>;
    expect(meta.from).toBeNull();
    expect(meta.to).toBeNull();
  });

  it("links.prev is null on first page", () => {
    const paginated = makePaginated([alice], 1, 1, 2);
    const result = ResourceCollection.of(UserResource, paginated);
    const links = result.links as Record<string, unknown>;
    expect(links.prev).toBeNull();
    expect(links.next).not.toBeNull();
  });

  it("links.next is null on last page", () => {
    const paginated = makePaginated([bob], 2, 1, 2);
    const result = ResourceCollection.of(UserResource, paginated);
    const links = result.links as Record<string, unknown>;
    expect(links.next).toBeNull();
    expect(links.prev).not.toBeNull();
  });

  it("includes first/last links when baseUrl is provided", () => {
    const paginated = makePaginated([alice], 1, 1, 2);
    const result = ResourceCollection.of(UserResource, paginated, "/posts");
    const links = result.links as Record<string, unknown>;
    expect(links.first).toBe("/posts?page=1");
    expect(links.last).toBe("/posts?page=2");
  });

  it("first/last links are null without baseUrl", () => {
    const paginated = makePaginated([alice], 1, 1, 2);
    const result = ResourceCollection.of(UserResource, paginated);
    const links = result.links as Record<string, unknown>;
    expect(links.first).toBeNull();
    expect(links.last).toBeNull();
  });

  it("merges extra query params into pagination links", () => {
    const paginated = makePaginated([alice], 1, 1, 2);
    const result = ResourceCollection.of(UserResource, paginated, "/posts", { search: "hello" });
    const links = result.links as Record<string, unknown>;
    expect(links.first).toContain("search=hello");
    expect(links.last).toContain("search=hello");
  });
});
