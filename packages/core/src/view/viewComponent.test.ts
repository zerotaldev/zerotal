import { describe, it, expect } from "bun:test";
import { HttpContext } from "../pipeline/HttpContext.ts";

describe("ctx.view(component, props)", () => {
  it("renders a component, passing ctx and merging props", async () => {
    const ctx = HttpContext.fake("http://localhost/welcome");
    const Welcome = (c: HttpContext, { title }: { title: string }) =>
      `<h1>${title}</h1><p>${c.url.pathname}</p>`;

    ctx.view(Welcome, { title: "Hi" });

    expect(await ctx.response!.text()).toBe("<!DOCTYPE html>\n<h1>Hi</h1><p>/welcome</p>");
    expect(ctx.response!.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  });

  it("reads route params off ctx.params (props win on collision)", async () => {
    const ctx = HttpContext.fake("http://localhost/users/42");
    ctx.params = { id: "42", tab: "posts" };
    const Page = (c: HttpContext, props: { tab: string }) =>
      `<i>${c.params["id"]}</i><b>${props.tab}</b>`;

    // explicit prop overrides the route param of the same name
    ctx.view(Page, { tab: "settings" });

    expect(await ctx.response!.text()).toBe("<!DOCTYPE html>\n<i>42</i><b>settings</b>");
  });

  it("exposes resolved model bindings via ctx.model()", async () => {
    const ctx = HttpContext.fake("http://localhost/posts/1");
    ctx._models.set("post", { title: "Hello" });
    const Show = (c: HttpContext) => `<h1>${c.model<{ title: string }>("post").title}</h1>`;

    ctx.view(Show);

    expect(await ctx.response!.text()).toBe("<!DOCTYPE html>\n<h1>Hello</h1>");
  });

  it("awaits an async component and honours a custom status", async () => {
    const ctx = HttpContext.fake("http://localhost/async");
    const Async = async (_c: HttpContext, { title }: { title: string }) =>
      Promise.resolve(`<main>${title}</main>`);

    await ctx.view(Async, { title: "Later" }, 201);

    expect(ctx.response!.status).toBe(201);
    expect(await ctx.response!.text()).toBe("<!DOCTYPE html>\n<main>Later</main>");
  });

  it("still accepts pre-rendered markup with an optional status", async () => {
    const ctx = HttpContext.fake("http://localhost/plain");
    ctx.view("<h1>Plain</h1>", 202);
    expect(ctx.response!.status).toBe(202);
    expect(await ctx.response!.text()).toBe("<!DOCTYPE html>\n<h1>Plain</h1>");
  });
});
