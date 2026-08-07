import { describe, it, expect, beforeEach } from "bun:test";
import { Panel } from "./Panel.ts";
import { Cluster } from "./Cluster.ts";
import { Resource } from "./Resource.ts";
import { text } from "./table/Column.ts";
import { textInput } from "./form/index.ts";
import { viewAction, editAction, createAction } from "./actions/index.ts";
import type { ActionContext } from "./actions/index.ts";

class ShopCluster extends Cluster {
  static override slug = "shop";
  static override title = "Shop";
}

class ProductResource extends Resource {
  static override model = { name: "Product" };
  static override cluster = ShopCluster;

  static override columns() {
    return [text("id"), text("name")];
  }

  static override form() {
    return [textInput("name").required()];
  }

  static override can(): boolean {
    return true;
  }
}

class PostResource extends Resource {
  static override model = { name: "Post" };

  static override columns() {
    return [text("id"), text("title")];
  }

  static override form() {
    return [textInput("title").required()];
  }

  static override can(): boolean {
    return true;
  }
}

class CommentResource extends Resource {
  static override model = { name: "Comment" };
  static override parent = { resource: () => PostResource, foreignKey: "post_id" };

  static override columns() {
    return [text("id"), text("body")];
  }

  static override form() {
    return [textInput("body").required()];
  }

  static override can(): boolean {
    return true;
  }
}

class SettingsResource extends Resource {
  static override model = { name: "Setting" };
  static override singular = true;
  static override slug = "settings";

  static override columns() {
    return [text("id")];
  }

  static override form() {
    return [textInput("siteName").required()];
  }

  static override can(): boolean {
    return true;
  }
}

/** A minimal action context for exercising the link presets. */
function ctxFor(resource: typeof Resource, record?: Record<string, unknown>): ActionContext {
  return {
    resource,
    page: { flash: () => undefined, redirect: () => ({ withSuccess: () => undefined }) },
    base: "/admin",
    slug: resource.getSlug(),
    record,
  } as unknown as ActionContext;
}

describe("clusters", () => {
  beforeEach(() => Panel.reset());

  it("puts a clustered resource under the cluster's URL segment", () => {
    expect(ProductResource.routePath()).toBe("shop/products");
    expect(ProductResource.indexUrl("/admin")).toBe("/admin/shop/products");
    expect(ProductResource.recordUrl("/admin", 7)).toBe("/admin/shop/products/7");
    expect(ProductResource.editUrl("/admin", 7)).toBe("/admin/shop/products/7/edit");
    expect(ProductResource.createUrl("/admin")).toBe("/admin/shop/products/create");
  });

  it("collapses its members into one navigation entry", () => {
    Panel.configure({ path: "/admin" });
    Panel.register(ProductResource, PostResource);

    const items = Panel.navigation().flatMap((g) => g.items);
    const shop = items.find((i) => i.slug === "shop");
    const posts = items.find((i) => i.slug === "posts");

    expect(shop).toBeDefined();
    expect(shop!.label).toBe("Shop");
    expect(shop!.children?.map((c) => c.href)).toEqual(["/admin/shop/products"]);
    // An unclustered resource stays where it was.
    expect(posts?.href).toBe("/admin/posts");
    // Members don't also appear loose at the top level.
    expect(items.some((i) => i.slug === "products")).toBe(false);
  });

  it("leaves an unclustered resource's URLs untouched", () => {
    expect(PostResource.routePath()).toBe("posts");
    expect(PostResource.indexUrl("/admin")).toBe("/admin/posts");
  });
});

describe("nested resources", () => {
  beforeEach(() => Panel.reset());

  it("routes through the parent record", () => {
    expect(CommentResource.routePath()).toBe("posts/:posts_parent/comments");
    expect(CommentResource.indexUrl("/admin", 3)).toBe("/admin/posts/3/comments");
    expect(CommentResource.recordUrl("/admin", 9, 3)).toBe("/admin/posts/3/comments/9");
    expect(CommentResource.editUrl("/admin", 9, 3)).toBe("/admin/posts/3/comments/9/edit");
    expect(CommentResource.createUrl("/admin", 3)).toBe("/admin/posts/3/comments/create");
  });

  it("keeps the placeholder when no parent id is supplied", () => {
    expect(CommentResource.indexUrl("/admin")).toBe("/admin/posts/:posts_parent/comments");
  });

  it("stays out of the sidebar, having no parent-free URL", () => {
    Panel.configure({ path: "/admin" });
    Panel.register(PostResource, CommentResource);

    const slugs = Panel.navigation().flatMap((g) => g.items.map((i) => i.slug));
    expect(slugs).toContain("posts");
    expect(slugs).not.toContain("comments");
  });

  it("carries the parent through the link actions", () => {
    const ctx = { ...ctxFor(CommentResource, { id: 9 }), parentId: "3" };
    expect(viewAction().href(ctx)).toBe("/admin/posts/3/comments/9");
    expect(editAction().href(ctx)).toBe("/admin/posts/3/comments/9/edit");
    expect(createAction().href(ctx)).toBe("/admin/posts/3/comments/create");
  });
});

describe("singular resources", () => {
  beforeEach(() => Panel.reset());

  it("edits at its index URL, with no record id", () => {
    expect(SettingsResource.indexUrl("/admin")).toBe("/admin/settings");
    expect(SettingsResource.editUrl("/admin", 1)).toBe("/admin/settings");
  });

  it("offers no create action", () => {
    const ctx = ctxFor(SettingsResource);
    expect(createAction().isVisibleFor(undefined, ctx)).toBe(false);
    // A collection resource still does.
    expect(createAction().isVisibleFor(undefined, ctxFor(PostResource))).toBe(true);
  });

  it("still appears in the sidebar", () => {
    Panel.configure({ path: "/admin" });
    Panel.register(SettingsResource);

    const items = Panel.navigation().flatMap((g) => g.items);
    expect(items.map((i) => i.href)).toEqual(["/admin/settings"]);
  });
});
