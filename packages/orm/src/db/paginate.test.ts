import { describe, it, expect } from "bun:test";
import { withPaginationHelpers } from "./types.ts";

function makePage(page: number, lastPage = 5) {
  return withPaginationHelpers({ data: [], total: lastPage * 15, page, perPage: 15, lastPage });
}

describe("withPaginationHelpers — nextPageUrl", () => {
  it("returns the next page URL", () => {
    expect(makePage(2).nextPageUrl("/posts")).toBe("/posts?page=3");
  });

  it("returns null on the last page", () => {
    expect(makePage(5).nextPageUrl("/posts")).toBeNull();
  });

  it("preserves extra query params", () => {
    const url = makePage(2).nextPageUrl("/posts", { search: "bun", sort: "asc" });
    expect(url).toContain("page=3");
    expect(url).toContain("search=bun");
    expect(url).toContain("sort=asc");
  });

  it("defaults baseUrl to empty string", () => {
    expect(makePage(1).nextPageUrl()).toBe("?page=2");
  });
});

describe("withPaginationHelpers — previousPageUrl", () => {
  it("returns the previous page URL", () => {
    expect(makePage(3).previousPageUrl("/posts")).toBe("/posts?page=2");
  });

  it("returns null on page 1", () => {
    expect(makePage(1).previousPageUrl("/posts")).toBeNull();
  });

  it("preserves extra query params", () => {
    const url = makePage(3).previousPageUrl("/posts", { search: "bun" });
    expect(url).toContain("page=2");
    expect(url).toContain("search=bun");
  });
});

describe("withPaginationHelpers — links", () => {
  it("returns one entry per page", () => {
    const links = makePage(2, 4).links("/posts");
    expect(links).toHaveLength(4);
  });

  it("marks the current page active", () => {
    const links = makePage(2, 4).links("/posts");
    expect(links[1]!.active).toBe(true); // page 2 (index 1)
    expect(links[0]!.active).toBe(false); // page 1
  });

  it("generates correct URLs", () => {
    const links = makePage(1, 3).links("/posts");
    expect(links[0]!.url).toBe("/posts?page=1");
    expect(links[2]!.url).toBe("/posts?page=3");
  });

  it("merges extra query params into every link", () => {
    const links = makePage(1, 2).links("/posts", { search: "bun" });
    expect(links[0]!.url).toContain("search=bun");
    expect(links[1]!.url).toContain("search=bun");
  });
});
