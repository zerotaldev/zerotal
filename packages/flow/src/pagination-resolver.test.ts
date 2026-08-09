import { beforeAll, describe, expect, test } from "bun:test";
import { HttpContext, RequestContext, currentPage } from "@zerotal/core";
import { Component } from "./Component.ts";
import { Pagination } from "./pagination.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

class PostsPage extends Component.using(Pagination) {
  override async render() {
    return { html: "" } as never;
  }
}

const inRequest = <T>(url: string, fn: (ctx: HttpContext) => Promise<T>): Promise<T> => {
  const ctx = HttpContext.fake(url);
  return RequestContext.run(ctx, () => fn(ctx));
};

describe("Pagination mixin → database pagination", () => {
  test("onBoot points currentPage() at the component's page", async () => {
    await inRequest("http://localhost/posts", async (ctx) => {
      const page = new PostsPage();
      await page.onBoot(ctx);

      expect(currentPage()).toBe(1); // the mixin's default

      page.gotoPage(3);
      expect(currentPage()).toBe(3); // Post.paginate(10) would now return page 3
    });
  });

  test("the component's page wins over a stale ?page= in the URL", async () => {
    await inRequest("http://localhost/posts?page=9", async (ctx) => {
      const page = new PostsPage();
      await page.onBoot(ctx);
      page.gotoPage(2);

      expect(currentPage()).toBe(2);
    });
  });

  test("named paginators resolve independently", async () => {
    await inRequest("http://localhost/dashboard", async (ctx) => {
      const page = new PostsPage();
      await page.onBoot(ctx);

      page.gotoPage(4, "invoices");

      expect(currentPage("invoices")).toBe(4);
      expect(currentPage()).toBe(1); // the default paginator is untouched
    });
  });
});
