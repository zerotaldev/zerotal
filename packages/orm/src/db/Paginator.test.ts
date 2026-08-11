import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { QueryBuilder } from "./QueryBuilder.ts";

interface Row {
  id: number;
  name: string;
}

let db: SQLInstance;
const qb = (table = "items") => new QueryBuilder(table, db);

beforeAll(async () => {
  db = new SQL(":memory:");
  await db`CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`;
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await db`DELETE FROM items`;
});

async function seed(n: number) {
  for (let i = 1; i <= n; i++) await qb().insert({ name: `Item ${i}` });
}

describe("paginate() — metadata + fluent helpers", () => {
  it("exposes from/to and a meta block", async () => {
    await seed(25);
    const p = await qb().orderBy("id").paginate<Row>(10, 2);
    expect(p.from).toBe(11);
    expect(p.to).toBe(20);
    expect(p.meta.total).toBe(25);
    expect(p.meta.lastPage).toBe(3);
    expect(p.meta.currentPage).toBe(2);
    expect(p.meta.perPage).toBe(10);
  });

  it("reports from/to as null for an empty result", async () => {
    const p = await qb().orderBy("id").paginate<Row>(10, 1);
    expect(p.from).toBeNull();
    expect(p.to).toBeNull();
    expect(p.meta.total).toBe(0);
  });

  it("hasMorePages / onFirstPage / onLastPage reflect position", async () => {
    await seed(25);
    const first = await qb().orderBy("id").paginate<Row>(10, 1);
    expect(first.onFirstPage).toBe(true);
    expect(first.onLastPage).toBe(false);
    expect(first.hasMorePages).toBe(true);

    const last = await qb().orderBy("id").paginate<Row>(10, 3);
    expect(last.onLastPage).toBe(true);
    expect(last.hasMorePages).toBe(false);
  });

  it("url(), previousPageUrl() and nextPageUrl() generate links", async () => {
    await seed(25);
    const p = await qb().orderBy("id").paginate<Row>(10, 2);
    expect(p.url(3)).toBe("?page=3");
    expect(p.previousPageUrl("/items")).toBe("/items?page=1");
    expect(p.nextPageUrl("/items")).toBe("/items?page=3");
  });

  it("previousPageUrl is null on the first page", async () => {
    await seed(5);
    const p = await qb().orderBy("id").paginate<Row>(10, 1);
    expect(p.previousPageUrl()).toBeNull();
  });
});

describe("simplePaginate() — no COUNT, next/prev only", () => {
  it("returns hasMorePages=true when another page follows", async () => {
    await seed(25);
    const p = await qb().orderBy("id").simplePaginate<Row>(10, 1);
    expect(p.data).toHaveLength(10);
    expect(p.hasMorePages).toBe(true);
    expect(p.page).toBe(1);
    expect(p.from).toBe(1);
    expect(p.to).toBe(10);
  });

  it("returns hasMorePages=false on the final page and trims the probe row", async () => {
    await seed(25);
    const p = await qb().orderBy("id").simplePaginate<Row>(10, 3);
    expect(p.data).toHaveLength(5);
    expect(p.hasMorePages).toBe(false);
    expect(p.nextPageUrl()).toBeNull();
    expect(p.previousPageUrl("/items")).toBe("/items?page=2");
  });

  it("does not include a total or lastPage", async () => {
    await seed(5);
    const p = await qb().orderBy("id").simplePaginate<Row>(10, 1);
    expect((p as unknown as Record<string, unknown>)["total"]).toBeUndefined();
    expect((p as unknown as Record<string, unknown>)["lastPage"]).toBeUndefined();
  });
});

describe("cursorPaginate() — prevCursor + hasMore", () => {
  it("first page: prevCursor null, hasMore true, nextCursor at last row", async () => {
    await seed(10);
    const p = await qb().cursorPaginate<Row>({ limit: 4 });
    expect(p.data).toHaveLength(4);
    expect(p.prevCursor).toBeNull();
    expect(p.hasMore).toBe(true);
    expect(p.nextCursor).toBe(p.data[3]!.id);
  });

  it("subsequent page: prevCursor echoes the incoming cursor", async () => {
    await seed(10);
    const p1 = await qb().cursorPaginate<Row>({ limit: 4 });
    const p2 = await qb().cursorPaginate<Row>({ limit: 4, cursor: p1.nextCursor! });
    expect(p2.prevCursor).toBe(p1.nextCursor);
    expect(p2.hasMore).toBe(true);
    expect(p2.data[0]!.id).toBeGreaterThan(p1.nextCursor!);
  });

  it("final page: hasMore false and nextCursor null", async () => {
    await seed(6);
    const p1 = await qb().cursorPaginate<Row>({ limit: 4 });
    const p2 = await qb().cursorPaginate<Row>({ limit: 4, cursor: p1.nextCursor! });
    expect(p2.data).toHaveLength(2);
    expect(p2.hasMore).toBe(false);
    expect(p2.nextCursor).toBeNull();
    expect(p2.prevCursor).toBe(p1.nextCursor);
  });
});
