import { describe, it, expect, beforeEach } from "bun:test";
import { Panel } from "./Panel.ts";
import { Resource } from "./Resource.ts";
import { text } from "./table/Column.ts";
import { textInput, customField } from "./form/index.ts";
import { textEntry } from "./infolist/index.ts";
import { resolveRenderHooks } from "./renderHooks.ts";
import {
  importAction,
  importCsv,
  IMPORT_ROW_LIMIT,
  MAPPING_FIELD_PREFIX,
} from "./actions/index.ts";
import type { ActionContext } from "./actions/index.ts";
import { queryBuilder, describeRuleTree } from "./table/Filter.ts";
import { textConstraint, numberConstraint } from "./table/Constraint.ts";
import { statsWidget, stat } from "./widgets/Widget.ts";
import { databaseNotifications } from "./databaseNotifications.ts";

describe("custom renderers", () => {
  it("lets a column render its own cell", () => {
    const col = text("health").render((v) => `bar:${String(v)}`);
    expect(col._render).toBeDefined();
    expect(col._render!(42, {})).toBe("bar:42");
  });

  it("carries a custom entry renderer through to the resolved display", () => {
    const d = textEntry("route")
      .render((v) => `map:${String(v)}`)
      .display({ route: "A-B" });

    expect(d.custom).toBeDefined();
    // The raw value and whole row travel with it, so the renderer gets what it needs.
    expect(d.raw).toBe("A-B");
    expect(d.row).toEqual({ route: "A-B" });
    expect(d.custom!(d.raw, d.row)).toBe("map:A-B");
  });

  it("gives a custom field its own type and renderer", () => {
    const f = customField("coordinates").render((v) => `picker:${String(v)}`);
    expect(f._type).toBe("custom");
    expect(f._render!("1,2", {})).toBe("picker:1,2");
    // It is still a field: label, rules and binding all still apply.
    expect(f.required().getLabel()).toBe("Coordinates");
    expect(f._required).toBe(true);
  });
});

describe("render hooks", () => {
  beforeEach(() => Panel.reset());

  it("collects hooks in registration order", () => {
    Panel.renderHook("table.start", () => "first");
    Panel.renderHook("table.start", () => "second");

    expect(resolveRenderHooks(Panel.renderHooks("table.start"))).toEqual(["first", "second"]);
  });

  it("drops a hook that declines to render", () => {
    Panel.renderHook("table.start", () => null);
    Panel.renderHook("table.start", () => "shown");

    expect(resolveRenderHooks(Panel.renderHooks("table.start"))).toEqual(["shown"]);
  });

  it("passes the context so a hook can target one resource", () => {
    Panel.renderHook("table.start", (ctx) => (ctx.resource === "orders" ? "notice" : null));

    expect(resolveRenderHooks(Panel.renderHooks("table.start"), { resource: "orders" })).toEqual([
      "notice",
    ]);
    expect(resolveRenderHooks(Panel.renderHooks("table.start"), { resource: "users" })).toEqual([]);
  });

  it("survives a hook that throws", () => {
    Panel.renderHook("body.start", () => {
      throw new Error("hook exploded");
    });
    Panel.renderHook("body.start", () => "still here");

    // Decoration must never take down the page it decorates.
    expect(resolveRenderHooks(Panel.renderHooks("body.start"))).toEqual(["still here"]);
  });

  it("keeps hooks separate per panel", () => {
    Panel.renderHook("body.start", () => "back office");
    const console = Panel.make("console", { path: "/app" });
    console.renderHook("body.start", () => "console");

    expect(resolveRenderHooks(Panel.default().renderHooks("body.start"))).toEqual(["back office"]);
    expect(resolveRenderHooks(console.renderHooks("body.start"))).toEqual(["console"]);
  });
});

describe("custom data sources", () => {
  const rows = [
    { id: 1, name: "Cape Town", region: "WC" },
    { id: 2, name: "Durban", region: "KZN" },
    { id: 3, name: "Pretoria", region: "GP" },
  ];

  class CityResource extends Resource {
    static override model = { name: "City" };
    static override columns() {
      return [text("id"), text("name").searchable(), text("region")];
    }
    static override data() {
      return rows;
    }
  }

  it("lists rows with no ORM model behind it", async () => {
    const page = await CityResource.records();
    expect(page.total).toBe(3);
    expect(page.rows.map((r) => r["name"])).toEqual(["Cape Town", "Durban", "Pretoria"]);
  });

  it("searches the in-memory rows", async () => {
    const page = await CityResource.records({ search: "durb" });
    expect(page.rows.map((r) => r["name"])).toEqual(["Durban"]);
  });

  it("sorts and paginates them", async () => {
    const page = await CityResource.records({ sortBy: "name", sortDir: "desc", perPage: 2 });
    expect(page.rows.map((r) => r["name"])).toEqual(["Pretoria", "Durban"]);
    expect(page.lastPage).toBe(2);
  });

  it("counts and finds through the same source", async () => {
    expect(await CityResource.count()).toBe(3);
    expect((await CityResource.find(2))?.["name"]).toBe("Durban");
    expect(await CityResource.find(99)).toBeNull();
  });
});

describe("resource widgets", () => {
  class OrderResource extends Resource {
    static override model = { name: "Order" };
    static override columns() {
      return [text("id")];
    }
    static override widgets() {
      return [statsWidget(() => [stat("Pending", 3)]).poll("15s")];
    }
  }

  it("defaults to none", () => {
    class Plain extends Resource {
      static override model = { name: "Plain" };
      static override columns() {
        return [text("id")];
      }
    }
    expect(Plain.widgets()).toEqual([]);
  });

  it("carries the widgets a resource declares, polling and all", async () => {
    const widgets = OrderResource.widgets();
    expect(widgets).toHaveLength(1);
    expect(widgets[0]!._poll).toBe("15s");
  });
});

describe("table presentation", () => {
  class Plain extends Resource {
    static override model = { name: "Plain" };
    static override columns() {
      return [text("id")];
    }
  }

  it("defaults to a comfortable, unstriped table", () => {
    expect(Plain.tableLayout).toBe("table");
    expect(Plain.striped).toBe(false);
    expect(Plain.stickyHeader).toBe(false);
    expect(Plain.density).toBe("comfortable");
    expect(Plain.filterLayout).toBe("inline");
  });

  it("takes the settings a resource declares", () => {
    class Gallery extends Resource {
      static override model = { name: "Photo" };
      static override tableLayout = "grid" as const;
      static override striped = true;
      static override density = "compact" as const;
      static override filterLayout = "drawer" as const;
      static override columns() {
        return [text("id")];
      }
    }
    expect(Gallery.tableLayout).toBe("grid");
    expect(Gallery.striped).toBe(true);
    expect(Gallery.density).toBe("compact");
    expect(Gallery.filterLayout).toBe("drawer");
  });
});

describe("filter indicators", () => {
  const filter = queryBuilder("q").constraints([
    textConstraint("title"),
    numberConstraint("total").label("Order total"),
  ]);

  it("names a single rule outright", () => {
    const summary = describeRuleTree(
      { type: "rule", constraint: "title", operator: "contains", value: "acme" },
      filter,
    );
    expect(summary).toBe("Title contains acme");
  });

  it("counts a tree rather than listing it", () => {
    const summary = describeRuleTree(
      {
        type: "group",
        operator: "and",
        rules: [
          { type: "rule", constraint: "title", operator: "contains", value: "a" },
          { type: "rule", constraint: "total", operator: "gt", value: "10" },
          { type: "rule", constraint: "total", operator: "lt", value: "90" },
        ],
      },
      filter,
    );
    expect(summary).toBe("3 rules");
  });

  it("says so when there is nothing in it", () => {
    expect(describeRuleTree(null)).toBe("none");
    expect(describeRuleTree({ type: "group", operator: "and", rules: [] }, filter)).toBe("none");
  });
});

describe("import mapping", () => {
  let store: Record<string, unknown>[] = [];

  class ContactResource extends Resource {
    static override model = { name: "Contact" };
    static override columns() {
      return [text("id"), text("name")];
    }
    static override form() {
      return [textInput("name").required(), textInput("email").email()];
    }
    static override can(): boolean {
      return true;
    }
    static override async create(data: Record<string, unknown>): Promise<Record<string, unknown>> {
      const record = { id: store.length + 1, ...data };
      store.push(record);
      return record;
    }
  }

  beforeEach(() => {
    store = [];
  });

  it("shows only the file picker until a file is chosen", () => {
    const fields = importAction().fieldsFor({}, ContactResource as never);
    expect(fields.map((f) => f._key)).toEqual(["file"]);
  });

  it("adds a mapping select per column once a file is there", () => {
    const csv = "Full Name,Contact Email\nAda,ada@example.com";
    const fields = importAction().fieldsFor({ file: csv }, ContactResource as never);

    expect(fields[0]!._key).toBe("file");
    // One select per CSV column, labelled with the header it came from.
    expect(fields.slice(1).map((f) => f._key)).toEqual([
      `${MAPPING_FIELD_PREFIX}0`,
      `${MAPPING_FIELD_PREFIX}1`,
    ]);
    expect(fields[1]!.getLabel()).toBe("Full Name");
    // Every resource field is offered, plus the option to skip the column.
    expect(fields[1]!._options?.map((o) => o.value)).toEqual(["", "name", "email"]);
  });

  it("honours an explicit mapping over the inferred one", async () => {
    // Headers that match nothing: only an explicit mapping can land this.
    const csv = "alpha,beta\nAda,ada@example.com";
    const result = await importCsv(ContactResource as never, csv, { 0: "name", 1: "email" });

    expect(result.created).toBe(1);
    expect(store[0]).toMatchObject({ name: "Ada", email: "ada@example.com" });
  });

  it("skips a column mapped to nothing", async () => {
    const csv = "name,junk\nAda,ignore-me";
    const result = await importCsv(ContactResource as never, csv, { 0: "name" });

    expect(result.created).toBe(1);
    expect(store[0]).not.toHaveProperty("junk");
  });

  it("lifts the row cap when a caller says it has no request to hold open", async () => {
    const rows = Array.from({ length: IMPORT_ROW_LIMIT + 5 }, (_, i) => `Name ${i},n${i}@e.com`);
    const csv = ["name,email", ...rows].join("\n");

    const capped = await importCsv(ContactResource as never, csv);
    expect(capped.created).toBe(0);

    store = [];
    const uncapped = await importCsv(ContactResource as never, csv, undefined, {
      limit: Number.POSITIVE_INFINITY,
    });
    expect(uncapped.created).toBe(IMPORT_ROW_LIMIT + 5);
  });

  it("asks for a file when the modal was submitted empty", async () => {
    const flashes: string[] = [];
    const ctx = {
      resource: ContactResource,
      slug: "contacts",
      base: "/admin",
      data: { file: "  " },
      page: { flash: (m: string) => flashes.push(m), redirect: () => ({ withSuccess: () => {} }) },
    } as unknown as ActionContext;

    await importAction().execute(ctx);
    expect(flashes[0]).toBe("Choose a CSV file to import.");
  });
});

describe("database notifications", () => {
  it("yields an empty bell rather than throwing when nothing is wired", async () => {
    // No notifications package, no signed-in user: a bell that fails soft.
    const provider = databaseNotifications({ notifiable: () => null });

    expect(await provider.resolve()).toEqual([]);
    expect(await provider.unreadCount!()).toBe(0);
    await provider.markRead!("1");
    await provider.markAllRead!();
  });
});
