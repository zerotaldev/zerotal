import { describe, expect, test } from "bun:test";
import { Resource } from "./Resource.ts";
import { text } from "./table/Column.ts";
import { textFilter, selectFilter } from "./table/Filter.ts";
import { applyLayout, moveKey, reconcile } from "./dashboardLayout.ts";
import { formatSize, mediaPath, isImage } from "./media.ts";
import { groupPermissions, roleHas } from "./roles.ts";
import type { MediaItem } from "./media.ts";
import type { Permission } from "./roles.ts";

describe("tree resources", () => {
  class Category extends Resource {
    static override treeParentColumn = "parent_id";
    static override columns() {
      return [text("name")];
    }
  }

  const rows = [
    { id: "3", parent_id: "1", name: "Laptops" },
    { id: "1", parent_id: null, name: "Electronics" },
    { id: "2", parent_id: null, name: "Books" },
    { id: "4", parent_id: "3", name: "Ultrabooks" },
  ];

  test("puts each row under its parent and reports the depth", () => {
    expect(Category.arrangeTree(rows).map((a) => [a.row["name"], a.depth])).toEqual([
      ["Electronics", 0],
      ["Laptops", 1],
      ["Ultrabooks", 2],
      ["Books", 0],
    ]);
  });

  test("keeps a row whose parent is off this page rather than dropping it", () => {
    const orphan = [{ id: "9", parent_id: "404", name: "Stray" }];
    expect(Category.arrangeTree(orphan)).toEqual([{ row: orphan[0]!, depth: 0 }]);
  });

  test("a cycle in the data does not become an infinite loop", () => {
    const cyclic = [
      { id: "1", parent_id: "2", name: "A" },
      { id: "2", parent_id: "1", name: "B" },
    ];
    // Neither can be reached from the top, so both are surfaced at the root.
    expect(
      Category.arrangeTree(cyclic)
        .map((a) => a.row["name"])
        .sort(),
    ).toEqual(["A", "B"]);
  });

  test("a resource with no tree column leaves the rows alone", () => {
    class Flat extends Resource {}
    expect(Flat.arrangeTree(rows).every((a) => a.depth === 0)).toBe(true);
  });
});

describe("translatable resources", () => {
  class Post extends Resource {
    static override translatable = ["title"];
    static override locales = ["en", "fr"];
  }

  test("reads the asked-for locale", () => {
    expect(Post.translated({ en: "Hello", fr: "Bonjour" }, "fr")).toBe("Bonjour");
  });

  test("falls back to the first locale when one is missing", () => {
    expect(Post.translated({ en: "Hello" }, "fr")).toBe("Hello");
  });

  test("an untranslated value is returned as it is, not blanked", () => {
    expect(Post.translated("Plain string", "fr")).toBe("Plain string");
  });

  test("null stays null rather than becoming an empty map lookup", () => {
    expect(Post.translated(null, "en")).toBe(null);
  });
});

describe("header filters", () => {
  test("a text filter matches anywhere in the column", () => {
    const calls: unknown[][] = [];
    const query = {
      where(...args: unknown[]) {
        calls.push(args);
        return this;
      },
    };
    textFilter("name").apply(query as never, "ada");
    expect(calls).toEqual([["name", "like", "%ada%"]]);
  });

  test("a select filter still matches exactly", () => {
    const calls: unknown[][] = [];
    const query = {
      where(...args: unknown[]) {
        calls.push(args);
        return this;
      },
    };
    selectFilter("status").apply(query as never, "open");
    expect(calls).toEqual([["status", "open"]]);
  });

  test("a column is not filterable until asked", () => {
    expect(text("name")._filterable).toBe(false);
    expect(text("name").filterable()._filterable).toBe(true);
  });
});

describe("dashboard layout", () => {
  const widgets = ["a", "b", "c"];
  const keyOf = (w: string): string => w;

  test("with no layout, declaration order stands", () => {
    expect(applyLayout(widgets, keyOf, null).visible).toEqual(["a", "b", "c"]);
  });

  test("orders by the saved layout and separates the hidden", () => {
    const result = applyLayout(widgets, keyOf, { order: ["c", "a", "b"], hidden: ["a"] });
    expect(result.visible).toEqual(["c", "b"]);
    expect(result.hidden.map((h) => h.key)).toEqual(["a"]);
  });

  test("a widget added since the layout was saved appears, at the end", () => {
    const result = applyLayout(["a", "b", "new"], keyOf, { order: ["b", "a"], hidden: [] });
    expect(result.visible).toEqual(["b", "a", "new"]);
  });

  test("a widget since removed does not resurrect from a stale key", () => {
    expect(reconcile({ order: ["gone", "a"], hidden: ["gone"] }, ["a", "b"])).toEqual({
      order: ["a", "b"],
      hidden: [],
    });
  });

  test("moving respects the ends of the list", () => {
    expect(moveKey(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveKey(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveKey(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });

  test("moving a key that is not there changes nothing", () => {
    expect(moveKey(["a", "b"], "z", 1)).toEqual(["a", "b"]);
  });
});

describe("media", () => {
  const item = (mime: string): MediaItem => ({ id: "1", path: "p", name: "n", mime, size: 0 });

  test("recognises the image types worth previewing", () => {
    expect(isImage(item("image/png"))).toBe(true);
    expect(isImage(item("image/svg+xml"))).toBe(true);
    expect(isImage(item("application/pdf"))).toBe(false);
  });

  test("sizes read at a glance", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  test("a path cannot escape its folder", () => {
    const path = mediaPath("../../etc/passwd", "../secrets");
    expect(path).not.toContain("..");
    expect(path.startsWith("secrets/")).toBe(true);
  });

  test("a folder that sanitises away still lands somewhere sane", () => {
    expect(mediaPath("x.png", "..").startsWith("media/")).toBe(true);
  });

  test("two uploads of the same name do not collide", () => {
    expect(mediaPath("logo.png")).not.toBe(mediaPath("logo.png"));
  });

  test("keeps the original name recognisable", () => {
    expect(mediaPath("annual-report.pdf")).toContain("annual-report.pdf");
  });
});

describe("roles", () => {
  const permissions: Permission[] = [
    { key: "posts.view", label: "View", group: "Posts" },
    { key: "posts.create", label: "Create", group: "Posts" },
    { key: "users.view", label: "View", group: "Users" },
  ];

  test("groups in first-seen order", () => {
    expect(groupPermissions(permissions).map((g) => g.group)).toEqual(["Posts", "Users"]);
    expect(groupPermissions(permissions)[0]!.items).toHaveLength(2);
  });

  test("a superuser holds a permission it was never granted", () => {
    const role = { id: "1", name: "Admin", superuser: true };
    expect(roleHas(role, [], "anything.at.all")).toBe(true);
  });

  test("an ordinary role holds only what it was granted", () => {
    const role = { id: "2", name: "Editor" };
    expect(roleHas(role, ["posts.view"], "posts.view")).toBe(true);
    expect(roleHas(role, ["posts.view"], "posts.delete")).toBe(false);
  });
});
