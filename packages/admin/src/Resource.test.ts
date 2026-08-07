import { describe, it, expect } from "bun:test";
import { Resource } from "./Resource.ts";
import { text } from "./table/Column.ts";

/** A fake ORM query builder that records the columns it's asked to filter/sort by. */
function recordingModel(rows: Record<string, unknown>[]) {
  const calls = {
    whereLike: [] as string[],
    orderBy: [] as Array<[string, string]>,
    limits: [] as number[],
    offsets: [] as number[],
  };
  const q: any = {
    where: () => q,
    with: () => q,
    whereLike: (c: string) => {
      calls.whereLike.push(c);
      return q;
    },
    orWhereLike: (c: string) => {
      calls.whereLike.push(c);
      return q;
    },
    whereNull: () => q,
    whereNotNull: () => q,
    orderBy: (c: string, d: string) => {
      calls.orderBy.push([c, d]);
      return q;
    },
    limit: (n: number) => {
      calls.limits.push(n);
      return q;
    },
    offset: (n: number) => {
      calls.offsets.push(n);
      return q;
    },
    count: async () => rows.length,
    get: async () => rows,
  };
  return { model: { query: () => q }, calls };
}

// ── searchable columns honour .column() ──────────────────────────────────────

describe("Resource.searchableColumns", () => {
  it("returns DB columns, honouring .column() overrides", () => {
    class R extends Resource {
      static override model = {} as any;
      static override columns() {
        return [
          text("authorName").column("author_name").searchable(),
          text("title").searchable(),
          text("id"),
        ];
      }
    }
    expect(R.searchableColumns()).toEqual(["author_name", "title"]);
  });
});

// ── camelCase search regression: query uses the DB column, not the cell key ───

describe("Resource.records — search column mapping", () => {
  it("calls whereLike with the mapped DB column, not the camelCase key", async () => {
    const { model, calls } = recordingModel([{ id: 1 }]);
    class R extends Resource {
      static override model = model as any;
      static override columns() {
        return [text("authorName").column("author_name").searchable()];
      }
    }
    await R.records({ search: "ada" });
    expect(calls.whereLike).toContain("author_name");
    expect(calls.whereLike).not.toContain("authorName");
  });

  it("forwards the requested sort column to orderBy", async () => {
    const { model, calls } = recordingModel([{ id: 1 }]);
    class R extends Resource {
      static override model = model as any;
      static override columns() {
        return [text("authorName").column("author_name").sortable()];
      }
    }
    await R.records({ sortBy: "author_name", sortDir: "desc" });
    expect(calls.orderBy).toEqual([["author_name", "desc"]]);
  });
});

// ── in-memory fallback (mocks / tests without a query builder) ────────────────

describe("Resource.records — in-memory fallback", () => {
  const all = [
    { id: 3, name: "Cara" },
    { id: 1, name: "Ada" },
    { id: 2, name: "Bea" },
  ];

  function R() {
    return class extends Resource {
      static override model = { all: async () => all } as any;
      static override columns() {
        return [text("name").searchable().sortable()];
      }
    };
  }

  it("sorts and paginates", async () => {
    const page = await R().records({ sortBy: "name", sortDir: "asc", perPage: 2, page: 1 });
    expect(page.total).toBe(3);
    expect(page.lastPage).toBe(2);
    expect(page.rows.map((r) => r.name)).toEqual(["Ada", "Bea"]);
  });

  it("searches case-insensitively across searchable columns", async () => {
    const page = await R().records({ search: "ada" });
    expect(page.rows.map((r) => r.name)).toEqual(["Ada"]);
  });

  it("returns the second page", async () => {
    const page = await R().records({ sortBy: "name", sortDir: "asc", perPage: 2, page: 2 });
    expect(page.rows.map((r) => r.name)).toEqual(["Cara"]);
  });
});
