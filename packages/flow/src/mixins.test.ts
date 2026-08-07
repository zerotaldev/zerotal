import { describe, it, expect } from "bun:test";
import { Component } from "./Component.ts";
import { ComponentWith, type Constructor } from "./mixins.ts";
import { Pagination } from "./pagination.ts";
import { expose, getExposedProps, getExposedMethods, getLockedProps } from "./decorators.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

// ── A second, custom feature mixin authored the documented way ────────────────
// (abstract base bound + `abstract class extends Base`, so it needn't implement render).
function Sortable<T extends Constructor<Component>>(Base: T) {
  abstract class WithSorting extends Base {
    @expose sortBy = "id";
    @expose sortDir: "asc" | "desc" = "asc";

    @expose toggleSort(column: string): void {
      if (this.sortBy === column) {
        this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
      } else {
        this.sortBy = column;
        this.sortDir = "asc";
      }
    }
  }
  return WithSorting;
}

describe("ComponentWith", () => {
  it("composes a single shipped mixin (Pagination) — same result as Pagination(Component)", () => {
    class PostsPage extends ComponentWith(Pagination) {
      @expose rows: number[] = Array.from({ length: 25 }, (_, i) => i + 1);
      override async render(): Promise<HtmlNode> {
        return { html: "<div></div>" };
      }
    }

    const p = new PostsPage();
    expect(p).toBeInstanceOf(Component); // folds onto Component
    expect(getExposedProps(p).has("page")).toBe(true); // mixin prop, found via prototype chain
    expect(getExposedMethods(PostsPage).has("nextPage")).toBe(true);

    expect(p.page).toBe(1);
    p.nextPage();
    expect(p.page).toBe(2);
    expect(p.pageFor()).toBe(2); // mixin method works
  });

  it("stacks multiple mixins left-to-right — every mixin's members flow through", () => {
    class TablePage extends ComponentWith(Pagination, Sortable) {
      @expose query = "";
      override async render(): Promise<HtmlNode> {
        return { html: "<div></div>" };
      }
    }

    const t = new TablePage();
    const exposed = getExposedProps(t);

    // From Pagination, from Sortable, and from the page itself — all in the snapshot.
    expect(exposed.has("page")).toBe(true); // Pagination
    expect(exposed.has("sortBy")).toBe(true); // Sortable
    expect(exposed.has("query")).toBe(true); // own member

    const methods = getExposedMethods(TablePage);
    expect(methods.has("nextPage")).toBe(true); // Pagination
    expect(methods.has("toggleSort")).toBe(true); // Sortable

    // Both mixins' behaviour is live and independent.
    t.nextPage();
    expect(t.page).toBe(2);

    t.toggleSort("name");
    expect(t.sortBy).toBe("name");
    expect(t.sortDir).toBe("asc");
    t.toggleSort("name"); // same column flips direction
    expect(t.sortDir).toBe("desc");
  });

  it("preserves Component's own surface on a composed page", () => {
    class P extends ComponentWith(Sortable) {
      @expose name = "";
      override async render(): Promise<HtmlNode> {
        return { html: "<div></div>" };
      }
    }
    const p = new P();
    // Component instance methods are available (typed + at runtime).
    expect(typeof p.flash).toBe("function");
    expect(typeof p.dispatch).toBe("function");
    // Own + mixin props both registered.
    expect(getExposedProps(p).has("name")).toBe(true);
    expect(getExposedProps(p).has("sortBy")).toBe(true);
    expect(getLockedProps(p).size).toBe(0);
  });
});
