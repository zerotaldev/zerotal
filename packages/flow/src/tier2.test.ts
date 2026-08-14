import { describe, it, expect, beforeAll } from "bun:test";
import { Component } from "./Component.ts";
import {
  expose,
  locked,
  computed,
  getExposedProps,
  getUrlProps,
  getExposedMethods,
} from "./decorators.ts";
import { Form } from "./Form.ts";
import type { RuleBuilder } from "@zerotal/validator";
import { paginate, Pagination } from "./pagination.ts";
import { dehydrate, hydrate } from "./dehydrate.ts";
import { FlowTest } from "./testing.ts";
import { jsx } from "./jsx-runtime.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

// ── Computed caching ──────────────────────────────────────────────────────────

class CachePage extends Component {
  calls = 0;
  @expose n = 2;
  @computed get doubled(): number {
    this.calls++;
    return this.n * 2;
  }
  override async render(): Promise<HtmlNode> {
    const a = this.doubled,
      b = this.doubled,
      c = this.doubled; // read 3× in one pass
    return { html: `<p>${a}/${b}/${c}</p>` };
  }
}

describe("computed caching", () => {
  it("memoizes a @computed getter within a single render pass", async () => {
    const t = await FlowTest.mount(CachePage);
    expect(t.html()).toContain("4/4/4");
    expect(t.page().calls).toBe(1); // 3 reads → 1 computation
  });

  it("recomputes outside the render pass (no stale cache)", async () => {
    const t = await FlowTest.mount(CachePage);
    const before = t.page().calls; // 1
    void t.page().doubled; // read outside render
    expect(t.page().calls).toBe(before + 1);
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────

describe("paginate()", () => {
  const items = Array.from({ length: 23 }, (_, i) => i + 1);

  it("slices the requested page and reports metadata", () => {
    const p = paginate(items, 2, 10);
    expect(p.data).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(p.total).toBe(23);
    expect(p.perPage).toBe(10);
    expect(p.page).toBe(2);
    expect(p.lastPage).toBe(3);
    expect(p.from).toBe(11);
    expect(p.to).toBe(20);
    expect(p.onFirstPage).toBe(false);
    expect(p.hasMorePages).toBe(true);
  });

  it("clamps an out-of-range page and handles the empty case", () => {
    expect(paginate(items, 99, 10).page).toBe(3);
    expect(paginate(items, 0, 10).page).toBe(1);
    const empty = paginate([], 1, 10);
    expect(empty.lastPage).toBe(1);
    expect(empty.from).toBe(0);
    expect(empty.to).toBe(0);
    expect(empty.hasMorePages).toBe(false);
  });

  it("builds a windowed page list with ellipses", () => {
    const p = paginate(
      Array.from({ length: 200 }, (_, i) => i),
      10,
      10,
    ); // 20 pages, current 10
    expect(p.elements(1)).toEqual([1, "...", 9, 10, 11, "...", 20]);
  });
});

// ── Form objects ───────────────────────────────────────────────────────────────

class LoginForm extends Form {
  email = "";
  password = "";
  override rules(v: RuleBuilder) {
    return { email: v.string().email(), password: v.string().min(8) };
  }
}

class LoginPage extends Component {
  @expose form = new LoginForm();
  override async render(): Promise<HtmlNode> {
    return { html: "<form></form>" };
  }
}

// ── Pagination mixin ────────────────────────────────────────────────────────

class PaginatedPage extends Pagination(Component) {
  @locked rows: number[] = Array.from({ length: 25 }, (_, i) => i + 1);
  override async render(): Promise<HtmlNode> {
    return { html: "<div></div>" };
  }
}

describe("Pagination mixin", () => {
  it("registers page as @expose + @url and nav methods as @expose (on the mixin prototype)", () => {
    const p = new PaginatedPage();
    expect(getExposedProps(p).has("page")).toBe(true);
    expect(getUrlProps(p).has("page")).toBe(true);
    expect(getExposedProps(p).has("rows")).toBe(true); // subclass member still found
    const methods = getExposedMethods(PaginatedPage);
    expect(methods.has("nextPage")).toBe(true);
    expect(methods.has("resetPage")).toBe(true);
  });

  it("navigates pages and paginates the current slice", () => {
    const p = new PaginatedPage();
    expect(p.page).toBe(1);
    p.nextPage();
    expect(p.page).toBe(2);
    p.previousPage();
    expect(p.page).toBe(1);
    p.previousPage();
    expect(p.page).toBe(1); // clamped
    p.gotoPage(3);
    expect(p.page).toBe(3);
    p.resetPage();
    expect(p.page).toBe(1);

    p.gotoPage(2);
    const slice = paginate(p.rows, p.page, 10);
    expect(slice.page).toBe(2);
    expect(slice.data).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it("gotoPage jumps to a specific page", () => {
    const p = new PaginatedPage();
    p.gotoPage(4);
    expect(p.page).toBe(4);
    expect(p.pageFor()).toBe(4);
  });

  it("tracks named paginators independently of the default", () => {
    const p = new PaginatedPage();
    p.nextPage(); // default → 2
    p.nextPage("invoices"); // invoices → 2
    p.nextPage("invoices"); // invoices → 3

    expect(p.page).toBe(2); // default untouched by named nav
    expect(p.pageFor("invoices")).toBe(3);
    expect(p.paginators["invoices"]).toBe(3);

    // the named paginator carries its own page.
    p.gotoPage(2, "invoices");
    expect(paginate(p.rows, p.pageFor("invoices"), 10).page).toBe(2);

    p.resetPage("invoices");
    expect(p.pageFor("invoices")).toBe(1);
    expect(p.page).toBe(2); // still independent
  });

  it("fires update hooks around a page change (default + generic)", () => {
    const events: string[] = [];
    class HookedPage extends Pagination(Component) {
      override async render(): Promise<HtmlNode> {
        return { html: "<div></div>" };
      }
      updatingPage(page: number, name: string): void {
        events.push(`updating:${name}:${page}`);
      }
      updatedPage(page: number, name: string): void {
        events.push(`updated:${name}:${page}`);
      }
      updatedPaginators(page: number, name: string): void {
        events.push(`generic:${name}:${page}`);
      }
    }
    const h = new HookedPage();
    h.nextPage();
    expect(events).toEqual(["updating:page:2", "updated:page:2", "generic:page:2"]);

    // No-op change (same page) fires nothing.
    events.length = 0;
    h.gotoPage(2);
    expect(events).toEqual([]);
  });
});

describe("Form objects", () => {
  it("data() returns fields only (not rules/methods)", () => {
    const f = new LoginForm();
    f.email = "a@b.com";
    expect(f.data()).toEqual({ email: "a@b.com", password: "" });
  });

  it("fill() assigns known fields and reset() restores defaults", () => {
    const f = new LoginForm();
    f.fill({ email: "a@b.com", password: "secret12", bogus: "x" });
    expect(f.email).toBe("a@b.com");
    expect((f as Record<string, unknown>)["bogus"]).toBeUndefined();
    f.reset();
    expect(f.data()).toEqual({ email: "", password: "" });
  });

  it("validate() throws on invalid data and passes on valid", () => {
    const f = new LoginForm();
    f.email = "nope";
    f.password = "123";
    expect(() => f.validate()).toThrow();
    f.email = "a@b.com";
    f.password = "longenough";
    expect(f.validate()).toEqual({ email: "a@b.com", password: "longenough" });
  });

  it("round-trips through the snapshot as a real Form instance", async () => {
    const page = new LoginPage();
    page._flowId = "lf";
    page.form.email = "a@b.com";
    page.form.password = "secret12";
    const snap = dehydrate(page, { id: "lf", name: "LoginPage", path: "/t" });
    const restored = await hydrate(snap, LoginPage);
    expect(restored.form.__isFlowForm).toBe(true);
    expect(restored.form instanceof Form).toBe(true);
    expect(restored.form.data()).toEqual({ email: "a@b.com", password: "secret12" });
  });

  it("$set fills the form in place (instance + methods preserved), not replaced", () => {
    const page = new LoginPage();
    const ref = page.form;
    page.$set("form", { email: "x@y.com", password: "pw123456" });
    expect(page.form).toBe(ref); // same instance
    expect(page.form.email).toBe("x@y.com");
    expect(typeof page.form.validate).toBe("function");
  });

  it('binds a nested form field in the RUNTIME renderer (value={this.form.email} → flow:model="form.email")', async () => {
    class FormBindPage extends Component {
      @expose form = new LoginForm();
      override async render(): Promise<HtmlNode> {
        // jsx() call (no JSX syntax) so this stays a .ts test; equivalent to <input value={this.form.email} />.
        return jsx("input", { value: this.form.email }) as HtmlNode;
      }
    }
    const t = await FlowTest.mount(FormBindPage);
    expect(t.html()).toContain('flow:model="form.email"');
  });

  it("Component.validate(form) routes form errors onto the component error bag", async () => {
    const page = new LoginPage();
    page.form.email = "bad";
    page.form.password = "1";
    await expect(page.validate(page.form)).rejects.toThrow();
    expect(page.errors.has("email")).toBe(true);

    page.form.email = "a@b.com";
    page.form.password = "longenough";
    await page.validate(page.form);
    expect(page.errors.any()).toBe(false);
  });
});
