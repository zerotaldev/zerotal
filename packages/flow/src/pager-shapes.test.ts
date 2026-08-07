import { describe, expect, test } from "bun:test";
import { paginate } from "./pagination.ts";
import type { PagerLike } from "./components.ts";

/** Both paginators satisfy PagerLike — this is the contract <Pager> renders from. */
describe("paginator shape", () => {
  test("the in-memory paginator carries the pager contract", () => {
    const p: PagerLike = paginate([...Array(50).keys()], 3, 10);

    expect(p.page).toBe(3);
    expect(p.lastPage).toBe(5);
    expect(p.onFirstPage).toBe(false);
    expect(p.hasMorePages).toBe(true);
    expect(p.elements()).toEqual([1, 2, 3, 4, 5]);
  });

  test("elements() elides distant pages", () => {
    const p = paginate([...Array(200).keys()], 5, 10);

    expect(p.elements()).toEqual([1, "...", 4, 5, 6, "...", 20]);
  });

  test("first and last page flags", () => {
    expect(paginate([1, 2, 3], 1, 10).onFirstPage).toBe(true);
    expect(paginate([...Array(30).keys()], 3, 10).hasMorePages).toBe(false);
  });
});
