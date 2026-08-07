import { describe, it, expect, beforeEach } from "bun:test";
import { Panel } from "./Panel.ts";
import { Cluster } from "./Cluster.ts";
import { Resource } from "./Resource.ts";
import { text } from "./table/Column.ts";
import { textInput } from "./form/index.ts";
import {
  imageEntry,
  colorEntry,
  codeEntry,
  keyValueEntry,
  repeatableEntry,
  textEntry,
} from "./infolist/index.ts";
import {
  action,
  actionGroup,
  flattenActions,
  replicateAction,
  deleteAction,
  viewAction,
  ActionGroup,
} from "./actions/index.ts";
import type { ActionContext, ActionPage } from "./actions/index.ts";
import { statsWidget, chartWidget, stat, widgetPollInterval } from "./widgets/Widget.ts";
import { resourceTrail } from "./ui/Breadcrumbs.tsx";

describe("infolist entry kinds", () => {
  it("renders an image with its own shape and size", () => {
    const d = imageEntry("avatar").circular().height(64).display({ avatar: "/a.png" });
    expect(d.kind).toBe("image");
    expect(d.text).toBe("/a.png");
    expect(d.circular).toBe(true);
    expect(d.imageHeight).toBe(64);
  });

  it("carries a colour value through for its swatch", () => {
    const d = colorEntry("brand").display({ brand: "#4f46e5" });
    expect(d.kind).toBe("color");
    expect(d.text).toBe("#4f46e5");
  });

  it("labels a code entry with its language", () => {
    const d = codeEntry("payload").language("json").display({ payload: '{"a":1}' });
    expect(d.kind).toBe("code");
    expect(d.language).toBe("json");
    expect(d.text).toBe('{"a":1}');
  });

  it("turns an object into key/value pairs", () => {
    const d = keyValueEntry("meta").display({ meta: { title: "Hi", robots: "index" } });
    expect(d.kind).toBe("keyValue");
    expect(d.pairs).toEqual([
      { key: "title", value: "Hi" },
      { key: "robots", value: "index" },
    ]);
  });

  it("accepts key/value pairs already in array form", () => {
    const d = keyValueEntry("meta").display({
      meta: [{ key: "a", value: 1 }],
    });
    expect(d.pairs).toEqual([{ key: "a", value: "1" }]);
  });

  it("shows the placeholder when there is nothing to list", () => {
    const d = keyValueEntry("meta").placeholder("(none)").display({ meta: null });
    expect(d.isPlaceholder).toBe(true);
    expect(d.text).toBe("(none)");
  });

  it("renders a nested schema once per repeated item", () => {
    const d = repeatableEntry("lines")
      .schema([textEntry("sku"), textEntry("qty")])
      .display({
        lines: [
          { sku: "A-1", qty: 2 },
          { sku: "B-2", qty: 5 },
        ],
      });

    expect(d.kind).toBe("repeatable");
    expect(d.items).toHaveLength(2);
    expect(d.items[0]!.map((e) => e.text)).toEqual(["A-1", "2"]);
    expect(d.items[1]!.map((e) => e.text)).toEqual(["B-2", "5"]);
  });

  it("shows the placeholder for an empty repeatable", () => {
    const d = repeatableEntry("lines")
      .schema([textEntry("sku")])
      .display({ lines: [] });
    expect(d.isPlaceholder).toBe(true);
    expect(d.items).toEqual([]);
  });
});

describe("action groups", () => {
  const ctx = {
    resource: Resource as unknown as typeof Resource,
    page: {} as ActionPage,
    base: "/admin",
    slug: "x",
  } as ActionContext;

  it("flattens to its members so dispatch can still find them by key", () => {
    const group = actionGroup([action("archive"), action("restore")]);
    const items = [viewAction(), group, deleteAction()];

    expect(flattenActions(items).map((a) => a._key)).toEqual([
      "view",
      "archive",
      "restore",
      "delete",
    ]);
  });

  it("hides members the user may not see", () => {
    const group = actionGroup([action("archive").visible(() => false), action("restore")]);
    expect(group.visibleActions(undefined, ctx).map((a) => a._key)).toEqual(["restore"]);
  });

  it("takes a label and icon of its own", () => {
    const group = actionGroup([action("a")])
      .label("Manage")
      .icon("folder");
    expect(group.getLabel()).toBe("Manage");
    expect(group._icon).toBe("folder");
    expect(group).toBeInstanceOf(ActionGroup);
  });
});

describe("replicateAction", () => {
  let created: Record<string, unknown>[] = [];
  let redirected = "";

  class WidgetResource extends Resource {
    static override model = { name: "Widget" };
    static override columns() {
      return [text("id"), text("name")];
    }
    static override form() {
      return [textInput("name").required()];
    }
    static override can(): boolean {
      return true;
    }
    static override async create(data: Record<string, unknown>): Promise<Record<string, unknown>> {
      const record = { id: 99, ...data };
      created.push(record);
      return record;
    }
  }

  const ctxFor = (record: Record<string, unknown>): ActionContext =>
    ({
      resource: WidgetResource,
      base: "/admin",
      slug: "widgets",
      record,
      page: {
        flash: () => undefined,
        redirect: (url: string) => {
          redirected = url;
          return { withSuccess: () => undefined };
        },
      },
    }) as unknown as ActionContext;

  beforeEach(() => {
    created = [];
    redirected = "";
  });

  it("copies the record without its identity or timestamps", async () => {
    await replicateAction().execute(
      ctxFor({ id: 1, name: "Gadget", created_at: "x", updated_at: "y", deleted_at: null }),
    );

    expect(created).toHaveLength(1);
    expect(created[0]).toEqual({ id: 99, name: "Gadget" });
  });

  it("drops the extra attributes it was told to", async () => {
    await replicateAction()
      .excludeAttributes(["slug"])
      .execute(ctxFor({ id: 1, name: "Gadget", slug: "gadget" }));

    expect(created[0]).not.toHaveProperty("slug");
  });

  it("lets a hook adjust the copy before it is saved", async () => {
    await replicateAction()
      .beforeReplicaSaved((data) => ({ ...data, name: `${String(data["name"])} (copy)` }))
      .execute(ctxFor({ id: 1, name: "Gadget" }));

    expect(created[0]!["name"]).toBe("Gadget (copy)");
  });

  it("opens the copy for editing", async () => {
    await replicateAction().execute(ctxFor({ id: 1, name: "Gadget" }));
    expect(redirected).toBe("/admin/widgets/99/edit");
  });
});

describe("widget polling", () => {
  it("reports no interval when nothing polls", () => {
    expect(widgetPollInterval([statsWidget(() => [stat("A", 1)])])).toBeUndefined();
  });

  it("takes the shortest interval, so the keenest widget sets the pace", () => {
    const widgets = [
      statsWidget(() => []).poll("1m"),
      chartWidget("c", () => ({ type: "bar", labels: [], datasets: [] })).poll("10s"),
      statsWidget(() => []).poll("2m"),
    ];
    expect(widgetPollInterval(widgets)).toBe("10s");
  });

  it("compares across units rather than by digits", () => {
    const widgets = [statsWidget(() => []).poll("90s"), statsWidget(() => []).poll("1m")];
    expect(widgetPollInterval(widgets)).toBe("1m");
  });
});

describe("empty states", () => {
  class OrderResource extends Resource {
    static override model = { name: "Order" };
    static override columns() {
      return [text("id")];
    }
  }

  class QuietResource extends Resource {
    static override model = { name: "Note" };
    static override columns() {
      return [text("id")];
    }
    static override emptyState() {
      return { heading: "Nothing filed", description: "Notes land here.", icon: "document" };
    }
  }

  it("defaults to naming the resource", () => {
    expect(OrderResource.emptyState().heading).toBe("No orders yet");
    expect(OrderResource.emptyState().icon).toBe("inbox");
  });

  it("uses whatever the resource declared instead", () => {
    expect(QuietResource.emptyState()).toEqual({
      heading: "Nothing filed",
      description: "Notes land here.",
      icon: "document",
    });
  });
});

describe("breadcrumbs", () => {
  class ShopCluster extends Cluster {
    static override slug = "shop";
    static override title = "Shop";
  }

  class PostResource extends Resource {
    static override model = { name: "Post" };
    static override columns() {
      return [text("id")];
    }
  }

  class ProductResource extends Resource {
    static override model = { name: "Product" };
    static override cluster = ShopCluster;
    static override columns() {
      return [text("id")];
    }
  }

  class CommentResource extends Resource {
    static override model = { name: "Comment" };
    static override parent = { resource: () => PostResource, foreignKey: "post_id" };
    static override columns() {
      return [text("id")];
    }
  }

  beforeEach(() => Panel.reset());

  const panel = (): ReturnType<typeof Panel.default> => {
    Panel.configure({ path: "/admin" });
    return Panel.default();
  };

  it("is just Dashboard and the resource on a plain index", () => {
    expect(resourceTrail({ panel: panel(), resource: PostResource })).toEqual([
      { label: "Dashboard", href: "/admin" },
      { label: "Posts" },
    ]);
  });

  it("names the cluster between the dashboard and the resource", () => {
    const trail = resourceTrail({ panel: panel(), resource: ProductResource });
    expect(trail.map((c) => c.label)).toEqual(["Dashboard", "Shop", "Products"]);
  });

  it("walks through the parent record for a nested resource", () => {
    const trail = resourceTrail({
      panel: panel(),
      resource: CommentResource,
      parentId: "7",
      parentTitle: "Hello world",
    });
    expect(trail).toEqual([
      { label: "Dashboard", href: "/admin" },
      { label: "Posts", href: "/admin/posts" },
      { label: "Hello world", href: "/admin/posts/7" },
      { label: "Comments" },
    ]);
  });

  it("links the resource once there is a record beyond it", () => {
    const trail = resourceTrail({
      panel: panel(),
      resource: PostResource,
      recordId: "3",
      recordTitle: "A post",
    });
    expect(trail).toEqual([
      { label: "Dashboard", href: "/admin" },
      { label: "Posts", href: "/admin/posts" },
      { label: "A post" },
    ]);
  });

  it("links the record too when a leaf follows it", () => {
    const trail = resourceTrail({
      panel: panel(),
      resource: PostResource,
      recordId: "3",
      recordTitle: "A post",
      leaf: "Edit",
    });
    expect(trail.at(-2)).toEqual({ label: "A post", href: "/admin/posts/3" });
    expect(trail.at(-1)).toEqual({ label: "Edit" });
  });

  it("falls back to the id when the parent has no resolvable title", () => {
    const trail = resourceTrail({ panel: panel(), resource: CommentResource, parentId: "7" });
    expect(trail[2]).toEqual({ label: "#7", href: "/admin/posts/7" });
  });
});
