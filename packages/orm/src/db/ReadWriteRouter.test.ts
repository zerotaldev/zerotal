import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createReadWriteRouter, _isReadQuery } from "./ReadWriteRouter.ts";
import { DB, _setDbConnection, _setReadReplicas } from "./DB.ts";

// ── Mock connection factory ───────────────────────────────────────────────────

interface MockConn {
  calls: string[];
  label: string;
  begin: (cb: (tx: MockConn) => Promise<unknown>) => Promise<unknown>;
  end: () => Promise<void>;
  ended: boolean;
}

function makeMock(label: string): MockConn & ((...args: unknown[]) => Promise<unknown[]>) {
  const calls: string[] = [];

  const fn = Object.assign(
    function mockSql(tpl: TemplateStringsArray, ..._vals: unknown[]): Promise<unknown[]> {
      const sql = Array.isArray(tpl) ? (tpl[0] as string) : "";
      calls.push(sql.trim());
      return Promise.resolve([]);
    } as unknown as MockConn & ((...a: unknown[]) => Promise<unknown[]>),
    {
      calls,
      label,
      ended: false,
      begin: async (cb: (tx: MockConn) => Promise<unknown>) => {
        calls.push("BEGIN");
        return cb(fn as unknown as MockConn);
      },
      end: async () => {
        (fn as unknown as { ended: boolean }).ended = true;
      },
    },
  );

  return fn;
}

/** Call the router as a tagged template with a fixed SQL string. */
function callWith(router: SQLInstance, sql: string): Promise<unknown[]> {
  const tpl = Object.assign([sql, ""], { raw: [sql, ""] }) as TemplateStringsArray;
  return (router as unknown as (t: TemplateStringsArray) => Promise<unknown[]>)(tpl);
}

// ── _isReadQuery ──────────────────────────────────────────────────────────────

describe("_isReadQuery()", () => {
  it.each([
    "SELECT * FROM users",
    "select id from posts",
    "WITH cte AS (SELECT 1) SELECT * FROM cte",
    "EXPLAIN SELECT * FROM users",
    "PRAGMA table_info(users)",
    "SHOW TABLES",
    "DESCRIBE users",
  ])("classifies %s as read", (sql) => {
    expect(_isReadQuery(sql)).toBe(true);
  });

  it.each([
    "INSERT INTO users (name) VALUES (?)",
    "UPDATE users SET name = ?",
    "DELETE FROM users WHERE id = ?",
    "CREATE TABLE foo (id INT)",
    "DROP TABLE foo",
    "ALTER TABLE users ADD COLUMN bio TEXT",
  ])("classifies %s as write", (sql) => {
    expect(_isReadQuery(sql)).toBe(false);
  });

  it("strips block comments before classification", () => {
    expect(_isReadQuery("/* fetch all users */ SELECT * FROM users")).toBe(true);
    expect(_isReadQuery("/* write */ INSERT INTO users VALUES (?)")).toBe(false);
  });

  it("strips line comments before classification", () => {
    expect(_isReadQuery("-- get users\nSELECT * FROM users")).toBe(true);
    expect(_isReadQuery("-- insert\nINSERT INTO users VALUES (?)")).toBe(false);
  });

  it("handles multiple comments before the keyword", () => {
    expect(_isReadQuery("/* a *//* b */\n-- c\nSELECT 1")).toBe(true);
  });
});

// ── createReadWriteRouter ─────────────────────────────────────────────────────

describe("createReadWriteRouter — passthrough with no replicas", () => {
  it("returns the primary as-is when the replica list is empty", () => {
    const primary = makeMock("primary");
    const router = createReadWriteRouter(primary as unknown as SQLInstance, []);
    expect(router).toBe(primary as unknown as SQLInstance);
  });
});

describe("createReadWriteRouter — query routing", () => {
  let primary: ReturnType<typeof makeMock>;
  let replica: ReturnType<typeof makeMock>;
  let router: SQLInstance;

  beforeEach(() => {
    primary = makeMock("primary");
    replica = makeMock("replica");
    router = createReadWriteRouter(primary as unknown as SQLInstance, [
      replica as unknown as SQLInstance,
    ]);
  });

  it("routes SELECT to the replica", async () => {
    await callWith(router, "SELECT * FROM users");
    expect(replica.calls).toHaveLength(1);
    expect(primary.calls).toHaveLength(0);
  });

  it("routes INSERT to the primary", async () => {
    await callWith(router, "INSERT INTO users (name) VALUES (?)");
    expect(primary.calls).toHaveLength(1);
    expect(replica.calls).toHaveLength(0);
  });

  it("routes UPDATE to the primary", async () => {
    await callWith(router, "UPDATE users SET name = ?");
    expect(primary.calls).toHaveLength(1);
    expect(replica.calls).toHaveLength(0);
  });

  it("routes DELETE to the primary", async () => {
    await callWith(router, "DELETE FROM users WHERE id = ?");
    expect(primary.calls).toHaveLength(1);
    expect(replica.calls).toHaveLength(0);
  });

  it("routes DDL (CREATE/DROP/ALTER) to the primary", async () => {
    await callWith(router, "CREATE TABLE foo (id INT)");
    await callWith(router, "DROP TABLE foo");
    await callWith(router, "ALTER TABLE users ADD COLUMN bio TEXT");
    expect(primary.calls).toHaveLength(3);
    expect(replica.calls).toHaveLength(0);
  });

  it("routes WITH (CTE) to the replica", async () => {
    await callWith(router, "WITH cte AS (SELECT 1) SELECT * FROM cte");
    expect(replica.calls).toHaveLength(1);
    expect(primary.calls).toHaveLength(0);
  });

  it("routes EXPLAIN to the replica", async () => {
    await callWith(router, "EXPLAIN SELECT * FROM users");
    expect(replica.calls).toHaveLength(1);
    expect(primary.calls).toHaveLength(0);
  });
});

// ── Round-robin across multiple replicas ──────────────────────────────────────

describe("createReadWriteRouter — round-robin load balancing", () => {
  it("distributes reads across replicas in order", async () => {
    const primary = makeMock("primary");
    const replica1 = makeMock("r1");
    const replica2 = makeMock("r2");
    const replica3 = makeMock("r3");

    const router = createReadWriteRouter(
      primary as unknown as SQLInstance,
      [replica1, replica2, replica3] as unknown as SQLInstance[],
    );

    for (let i = 0; i < 6; i++) {
      await callWith(router, "SELECT 1");
    }

    expect(replica1.calls).toHaveLength(2);
    expect(replica2.calls).toHaveLength(2);
    expect(replica3.calls).toHaveLength(2);
    expect(primary.calls).toHaveLength(0);
  });
});

// ── Transactions ──────────────────────────────────────────────────────────────

describe("createReadWriteRouter — transactions", () => {
  it("routes begin() to the primary", async () => {
    const primary = makeMock("primary");
    const replica = makeMock("replica");
    const router = createReadWriteRouter(primary as unknown as SQLInstance, [
      replica as unknown as SQLInstance,
    ]);

    await (
      router as unknown as { begin: (cb: (...a: unknown[]) => Promise<void>) => Promise<void> }
    ).begin(async () => {});

    expect(primary.calls).toContain("BEGIN");
    expect(replica.calls).toHaveLength(0);
  });
});

// ── Primary escape hatch ──────────────────────────────────────────────────────

describe("createReadWriteRouter — __primary__ escape hatch", () => {
  it("exposes the primary via __primary__ property", () => {
    const primary = makeMock("primary");
    const replica = makeMock("replica");
    const router = createReadWriteRouter(primary as unknown as SQLInstance, [
      replica as unknown as SQLInstance,
    ]);

    const extracted = (router as unknown as Record<string, unknown>)["__primary__"];
    expect(extracted).toBe(primary);
  });

  it("routes a SELECT through the extracted primary (not the replica)", async () => {
    const primary = makeMock("primary");
    const replica = makeMock("replica");
    const router = createReadWriteRouter(primary as unknown as SQLInstance, [
      replica as unknown as SQLInstance,
    ]);

    const extractedPrimary = (router as unknown as Record<string, unknown>)[
      "__primary__"
    ] as ReturnType<typeof makeMock>;
    await callWith(extractedPrimary as unknown as SQLInstance, "SELECT * FROM users");

    expect(extractedPrimary.calls).toHaveLength(1);
    expect(replica.calls).toHaveLength(0);
  });
});

// ── Shutdown ──────────────────────────────────────────────────────────────────

describe("createReadWriteRouter — end()", () => {
  it("closes all unique connections on end()", async () => {
    const primary = makeMock("primary");
    const replica = makeMock("replica");
    const router = createReadWriteRouter(primary as unknown as SQLInstance, [
      replica as unknown as SQLInstance,
    ]);

    await (router as unknown as { end: () => Promise<void> }).end();

    expect(primary.ended).toBe(true);
    expect(replica.ended).toBe(true);
  });

  it("does not double-close when primary is also a replica", async () => {
    const primary = makeMock("primary");
    // Intentionally pass primary as a replica too
    const router = createReadWriteRouter(primary as unknown as SQLInstance, [
      primary as unknown as SQLInstance,
    ]);

    let endCount = 0;
    (primary as unknown as { end: () => Promise<void> }).end = async () => {
      endCount++;
    };

    await (router as unknown as { end: () => Promise<void> }).end();
    expect(endCount).toBe(1); // closed exactly once
  });
});

// ── DB.onPrimary() ────────────────────────────────────────────────────────────

describe("DB.onPrimary()", () => {
  let primary: ReturnType<typeof makeMock>;
  let replica: ReturnType<typeof makeMock>;

  beforeEach(() => {
    primary = makeMock("primary");
    replica = makeMock("replica");
    _setReadReplicas(primary as unknown as SQLInstance, [replica as unknown as SQLInstance]);
  });

  afterEach(() => {
    // Restore a plain connection so other test files are unaffected
    _setDbConnection(primary as unknown as SQLInstance);
  });

  it("routes table() queries to the primary, not the replica", async () => {
    // Simulate what QueryBuilder does internally: call conn(tpl, ...vals)
    // We verify by checking which mock received the call.
    await DB.onPrimary().table("users").get();

    // The QueryBuilder for 'users' was created with the primary connection,
    // so primary.calls should have the SELECT, not replica.calls.
    expect(primary.calls.length).toBeGreaterThan(0);
    expect(replica.calls).toHaveLength(0);
  });

  it("without replicas, onPrimary() uses the same connection as table()", async () => {
    _setDbConnection(primary as unknown as SQLInstance);

    await DB.onPrimary().table("posts").get();
    expect(primary.calls.length).toBeGreaterThan(0);
  });
});
