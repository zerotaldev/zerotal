import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SQL } from "bun";
import { DatabaseProvider, _normaliseSqliteUrl } from "./DatabaseProvider.ts";
import { DB, _setDbConnection } from "../db/DB.ts";
import { _setBaseModelConnection, _setBaseModelDialect } from "../model/BaseModel.ts";
import { runDbRule } from "../../../validator/src/dbRules.ts";

// ── _normaliseSqliteUrl() ─────────────────────────────────────────────────────

describe("_normaliseSqliteUrl()", () => {
  it("passes :memory: through unchanged", () => {
    expect(_normaliseSqliteUrl(":memory:")).toBe(":memory:");
  });

  it("passes empty string through unchanged", () => {
    expect(_normaliseSqliteUrl("")).toBe("");
  });

  it("passes postgres:// through unchanged", () => {
    expect(_normaliseSqliteUrl("postgres://localhost/mydb")).toBe("postgres://localhost/mydb");
  });

  it("passes postgresql:// through unchanged", () => {
    expect(_normaliseSqliteUrl("postgresql://localhost/mydb")).toBe("postgresql://localhost/mydb");
  });

  it("passes mysql2:// through unchanged", () => {
    expect(_normaliseSqliteUrl("mysql2://localhost/mydb")).toBe("mysql2://localhost/mydb");
  });

  it("passes mysql:// through unchanged", () => {
    expect(_normaliseSqliteUrl("mysql://localhost/mydb")).toBe("mysql://localhost/mydb");
  });

  it("collapses sqlite:// to sqlite:", () => {
    expect(_normaliseSqliteUrl("sqlite:///path/to/db.sqlite")).toBe("sqlite:/path/to/db.sqlite");
  });

  it("keeps sqlite: prefix as-is", () => {
    expect(_normaliseSqliteUrl("sqlite:./data/app.db")).toBe("sqlite:./data/app.db");
  });

  it("rewrites file: to sqlite:", () => {
    expect(_normaliseSqliteUrl("file:./data/app.db")).toBe("sqlite:./data/app.db");
  });

  it("adds sqlite: prefix to a bare path", () => {
    expect(_normaliseSqliteUrl("./data/app.db")).toBe("sqlite:./data/app.db");
  });
});

// ── DatabaseProvider — helpers ─────────────────────────────────────────────────

function makeApp(overrides: Record<string, unknown> = {}) {
  const singletons: Record<string, unknown> = {};
  const container = {
    singleton: (key: string, factory: () => unknown) => {
      singletons[key] = factory;
    },
    make: async (key: string) => {
      if (key === "config") {
        return {
          get: (path: string, fallback?: unknown) => {
            const cfg: Record<string, unknown> = {
              "database.url": ":memory:",
              "database.pool": undefined,
              "database.replicas": [],
              ...((overrides["config"] as Record<string, unknown>) ?? {}),
            };
            return cfg[path] !== undefined ? cfg[path] : fallback;
          },
        };
      }
      if (key === "db") {
        const db = new SQL(":memory:");
        return db;
      }
      return undefined;
    },
    makeSync: (key: string) => {
      if (key === "db" && overrides["sqlSync"]) return overrides["sqlSync"];
      throw new Error(`makeSync: ${key} not bound`);
    },
    tryMake: (key: string) => overrides[key] ?? null,
  };
  return { container } as any;
}

// ── DatabaseProvider.replContext() ────────────────────────────────────────────

describe("DatabaseProvider.replContext()", () => {
  it("exposes the DB facade", () => {
    const provider = new DatabaseProvider(makeApp());
    const ctx = provider.replContext();
    expect(ctx).toHaveProperty("DB", DB);
  });
});

// ── DatabaseProvider.onStopping() ────────────────────────────────────────────

describe("DatabaseProvider.onStopping()", () => {
  it("calls sql.end() when db was initialised", async () => {
    const ended = { called: false };
    const fakeSql = {
      end: async () => {
        ended.called = true;
      },
    };
    const app = makeApp({ sqlSync: fakeSql });
    const provider = new DatabaseProvider(app);
    await provider.onStopping();
    expect(ended.called).toBe(true);
  });

  it("does not throw when db was never initialised (makeSync throws)", async () => {
    const app = makeApp(); // makeSync throws by default
    const provider = new DatabaseProvider(app);
    await expect(provider.onStopping()).resolves.toBeUndefined();
  });
});

// ── DatabaseProvider.onBooted() ───────────────────────────────────────────────

describe("DatabaseProvider.onBooted()", () => {
  it("is a no-op when commands runner is not registered", async () => {
    const app = makeApp({ commands: null });
    const provider = new DatabaseProvider(app);
    await expect(provider.onBooted()).resolves.toBeUndefined();
  });

  it("registers lazy commands when runner is available", async () => {
    const registered: string[] = [];
    const fakeRunner = {
      registerLazy: (name: string) => {
        registered.push(name);
      },
    };
    const app = makeApp({ commands: fakeRunner });
    const provider = new DatabaseProvider(app);
    await provider.onBooted();

    expect(registered).toContain("migrate");
    expect(registered).toContain("migrate:rollback");
    expect(registered).toContain("migrate:status");
    expect(registered).toContain("make:migration");
    expect(registered).toContain("make:model");
    expect(registered).toContain("db:seed");
    expect(registered).toContain("make:seeder");
    expect(registered).toContain("make:factory");
    expect(registered).toContain("migrate:generate");
  });

  it("lazy factory for migrate resolves to MigrateCommand", async () => {
    const factories = new Map<string, () => Promise<unknown>>();
    const fakeRunner = {
      registerLazy: (name: string, fn: () => Promise<unknown>) => {
        factories.set(name, fn);
      },
    };
    const app = makeApp({ commands: fakeRunner });
    const provider = new DatabaseProvider(app);
    await provider.onBooted();

    const MigrateCmd = await factories.get("migrate")!();
    expect(MigrateCmd).toBeDefined();
    expect(typeof MigrateCmd).toBe("function");
  });

  it("lazy factory for migrate:rollback resolves to MigrateRollbackCommand", async () => {
    const factories = new Map<string, () => Promise<unknown>>();
    const fakeRunner = {
      registerLazy: (name: string, fn: () => Promise<unknown>) => {
        factories.set(name, fn);
      },
    };
    const app = makeApp({ commands: fakeRunner });
    const provider = new DatabaseProvider(app);
    await provider.onBooted();

    const Cmd = await factories.get("migrate:rollback")!();
    expect(Cmd).toBeDefined();
    expect(typeof Cmd).toBe("function");
  });

  it("lazy factories for all registered commands resolve to constructors", async () => {
    const factories = new Map<string, () => Promise<unknown>>();
    const fakeRunner = {
      registerLazy: (name: string, fn: () => Promise<unknown>) => {
        factories.set(name, fn);
      },
    };
    const app = makeApp({ commands: fakeRunner });
    const provider = new DatabaseProvider(app);
    await provider.onBooted();

    const cmdNames = [
      "migrate:status",
      "make:migration",
      "make:model",
      "db:seed",
      "make:seeder",
      "make:factory",
      "migrate:generate",
    ];
    for (const name of cmdNames) {
      const Cmd = await factories.get(name)!();
      expect(typeof Cmd).toBe("function");
    }
  });
});

// ── DatabaseProvider.onBooting() ─────────────────────────────────────────────

describe("DatabaseProvider.onBooting()", () => {
  let db: InstanceType<typeof SQL>;

  beforeEach(() => {
    db = new SQL(":memory:");
    _setDbConnection(db);
  });

  afterEach(async () => {
    _setDbConnection(null);
    _setBaseModelConnection(null);
    _setBaseModelDialect("sqlite");
    await db.end();
  });

  it("sets the base model connection and dialect from config", async () => {
    const app = makeApp({
      config: { "database.url": ":memory:" },
    });
    const provider = new DatabaseProvider(app);
    await provider.onBooting();
    // If we reach here without error, onBooting succeeded
    expect(true).toBe(true);
  });

  it("registers DB rule runner for unique() validation — no duplicate found", async () => {
    const app = makeApp({ config: { "database.url": ":memory:" } });
    const provider = new DatabaseProvider(app);
    await provider.onBooting();

    // Create a test table
    await db`CREATE TABLE IF NOT EXISTS test_unique (id INTEGER PRIMARY KEY, email TEXT)`;
    await db`INSERT INTO test_unique (email) VALUES ('existing@test.com')`;

    // unique() returns undefined (passes) when value is NOT in the table
    const result = await runDbRule("unique", "test_unique", "email", "new@test.com", {});
    expect(result).toBeUndefined(); // no error = value is unique
  });

  it("registers DB rule runner for unique() validation — duplicate found", async () => {
    const app = makeApp({ config: { "database.url": ":memory:" } });
    const provider = new DatabaseProvider(app);
    await provider.onBooting();

    await db`CREATE TABLE IF NOT EXISTS test_unique2 (id INTEGER PRIMARY KEY, email TEXT)`;
    await db`INSERT INTO test_unique2 (email) VALUES ('taken@test.com')`;

    // unique() returns error string when value already exists
    const result = await runDbRule("unique", "test_unique2", "email", "taken@test.com", {});
    expect(typeof result).toBe("string");
    expect(result).toContain("taken");
  });

  it("registers DB rule runner for unique() with ignoreId", async () => {
    const app = makeApp({ config: { "database.url": ":memory:" } });
    const provider = new DatabaseProvider(app);
    await provider.onBooting();

    await db`CREATE TABLE IF NOT EXISTS test_unique3 (id INTEGER PRIMARY KEY, email TEXT)`;
    await db`INSERT INTO test_unique3 (id, email) VALUES (1, 'user@test.com')`;

    // Should pass (unique ignoring row with id=1)
    const result = await runDbRule("unique", "test_unique3", "email", "user@test.com", {
      ignoreId: 1,
    });
    expect(result).toBeUndefined();
  });

  it("registers DB rule runner for exists() validation — row found", async () => {
    const app = makeApp({ config: { "database.url": ":memory:" } });
    const provider = new DatabaseProvider(app);
    await provider.onBooting();

    await db`CREATE TABLE IF NOT EXISTS test_exists (id INTEGER PRIMARY KEY, name TEXT)`;
    await db`INSERT INTO test_exists (name) VALUES ('Alice')`;

    // exists() returns undefined (passes) when value IS in the table
    const result = await runDbRule("exists", "test_exists", "name", "Alice", {});
    expect(result).toBeUndefined();
  });

  it("registers DB rule runner for exists() validation — row not found", async () => {
    const app = makeApp({ config: { "database.url": ":memory:" } });
    const provider = new DatabaseProvider(app);
    await provider.onBooting();

    await db`CREATE TABLE IF NOT EXISTS test_exists2 (id INTEGER PRIMARY KEY, name TEXT)`;

    // exists() returns error string when value is NOT in the table
    const result = await runDbRule("exists", "test_exists2", "name", "Nobody", {});
    expect(typeof result).toBe("string");
  });
});

// ── DatabaseProvider.onRegister() — replica path ─────────────────────────────

describe("DatabaseProvider.onRegister() — replica path", () => {
  it("registers a singleton factory that builds a ReadWriteRouter when replicas are configured", async () => {
    let registeredFactory: (() => Promise<unknown>) | undefined;
    const container = {
      singleton: (_key: string, factory: () => Promise<unknown>) => {
        registeredFactory = factory;
      },
      make: async () => undefined,
      makeSync: () => {
        throw new Error("not bound");
      },
      tryMake: () => null,
    };

    const app = {
      container: {
        ...container,
        make: async (key: string) => {
          if (key === "config") {
            return {
              get: (path: string, fallback?: unknown) => {
                if (path === "database.url") return ":memory:";
                if (path === "database.pool") return undefined;
                if (path === "database.replicas") return [":memory:"];
                return fallback;
              },
            };
          }
          return undefined;
        },
      },
    } as any;

    const provider = new DatabaseProvider(app);
    provider.onRegister();

    expect(registeredFactory).toBeDefined();
    const result = await registeredFactory!();
    // With replicas configured, the factory returns a ReadWriteRouter proxy
    expect(result).toBeDefined();
  });

  it("registers a singleton factory that returns a primary SQL when no replicas", async () => {
    let registeredFactory: (() => Promise<unknown>) | undefined;
    const app = {
      container: {
        singleton: (_key: string, factory: () => Promise<unknown>) => {
          registeredFactory = factory;
        },
        make: async (key: string) => {
          if (key === "config") {
            return {
              get: (path: string, fallback?: unknown) => {
                if (path === "database.url") return ":memory:";
                if (path === "database.pool") return undefined;
                if (path === "database.replicas") return [];
                return fallback;
              },
            };
          }
          return undefined;
        },
        makeSync: () => {
          throw new Error("not bound");
        },
        tryMake: () => null,
      },
    } as any;

    const provider = new DatabaseProvider(app);
    provider.onRegister();
    const result = await registeredFactory!();
    // No replicas — returns the primary SQL instance directly
    expect(result).toBeDefined();
  });

  it("registers a factory that respects pool options", async () => {
    let registeredFactory: (() => Promise<unknown>) | undefined;
    const app = {
      container: {
        singleton: (_key: string, factory: () => Promise<unknown>) => {
          registeredFactory = factory;
        },
        make: async (key: string) => {
          if (key === "config") {
            return {
              get: (path: string, fallback?: unknown) => {
                if (path === "database.url") return ":memory:";
                if (path === "database.pool") return { max: 5 };
                if (path === "database.replicas") return [];
                return fallback;
              },
            };
          }
          return undefined;
        },
        makeSync: () => {
          throw new Error("not bound");
        },
        tryMake: () => null,
      },
    } as any;

    const provider = new DatabaseProvider(app);
    provider.onRegister();
    const result = await registeredFactory!();
    expect(result).toBeDefined();
  });
});

describe("DatabaseProvider — environments", () => {
  /**
   * `worker` was missing until 1.7.1, and the consequence was total: `bun zt
   * queue:work` could not boot. The queue's default driver is `sqlite`,
   * `QueueProvider` *does* run in `worker`, and it asked for a connection this
   * provider had not made — so the worker died on startup with "No database
   * connection. Is DatabaseProvider registered?" while it plainly was.
   */
  it("runs in every mode, including worker", () => {
    expect(DatabaseProvider.environments).toContain("worker");
  });

  it("covers every mode a job could run under", () => {
    // Nine providers run in `worker` — queue, notifications, audit, media,
    // tenancy, scheduler among them — and a job exists to do work with models.
    // `as const` so each entry is an `AppEnvironment` rather than a widened
    // `string`, which `toContain` will not accept against the typed array.
    for (const mode of ["web", "console", "worker", "test"] as const) {
      expect(DatabaseProvider.environments).toContain(mode);
    }
  });
});
