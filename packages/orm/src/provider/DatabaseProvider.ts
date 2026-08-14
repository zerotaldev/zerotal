import type { SQLInstance } from "../db/sql-types.ts";
import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { SQL } from "bun";
import { DB, _getConnection } from "../db/DB.ts";
import { preventNPlusOne } from "../db/NPlusOneDetector.ts";
import {
  _setBaseModelConnection,
  _setBaseModelDialect,
  _setModelEventDispatcher,
} from "../model/BaseModel.ts";
import { setConnectionResolver } from "../db/resolver.ts";
import { createReadWriteRouter } from "../db/ReadWriteRouter.ts";
import { ormConcerns } from "../conventions.ts";
import { validateDatabaseConfig } from "../config.ts";
import { autoMigrateConcern } from "../schema/autoMigrate.ts";
import { registerImplicitBinding } from "../implicitBinding.ts";
import { installOrmObservability } from "../observability.ts";

// Extend the core container registry so 'db' is a typed binding.
declare module "@zerotal/core" {
  interface ContainerBindings {
    db: SQLInstance;
  }
}

/**
 * Service provider that wires the ORM into a Zerotal application.
 *
 * @remarks
 * Register this provider to get: the `db` container binding (a `Bun.sql`
 * connection, optionally wrapped in a read/write router when `database.replicas`
 * is set), convention auto-discovery of `app/models` and `app/observers`,
 * auto-migration, implicit route-model binding, N+1 detection outside production,
 * validator `unique`/`exists` rule wiring, and the `migrate` / `make:*` / `db:seed`
 * CLI commands. The connection URL, pool, replicas, and dialect are read from the
 * `database` config namespace (see {@link DatabaseConfig}).
 *
 * @example
 * ```ts
 * // config/app.ts
 * providers: [DatabaseProvider]
 * ```
 */
export class DatabaseProvider extends ServiceProvider {
  static override provides = ["db"] as const;
  // Use an explicit mutable array type to satisfy ServiceProvider's static property constraint.
  static override environments: AppEnvironment[] = ["web", "console", "test", "repl"];

  private _disposeObservability: (() => void) | undefined = undefined;

  override onRegister(): void {
    // Convention-based auto-discovery: app/models, app/observers, and auto-migrate.
    // Optional-chained so bare-container unit tests with a minimal app stub still pass.
    for (const concern of ormConcerns) this.app.registerConcern?.(concern);
    this.app.registerConcern?.(autoMigrateConcern);

    // Refuse a production boot on a driver/URL mismatch; warn on in-memory
    // stores and no-op synchronize flags. Runs in the boot-time config pass.
    this.app.registerConfigValidator?.("database", validateDatabaseConfig);

    // Implicit route-model binding: `:user` -> User.findOrFail(value), for every registered
    // model (opt out per model with `static implicitBinding = false`). Resolves lazily at
    // route-compile time, so model registration order doesn't matter.
    registerImplicitBinding();

    setConnectionResolver(() => {
      try {
        return this.app.container.makeSync("db") as SQLInstance;
      } catch {
        return undefined;
      }
    });

    this.app.container.singleton("db", async () => {
      const config = (await this.app.container.make("config")) as ConfigManager;
      const rawUrl = config.get<string>("database.url", ":memory:");
      const pool = config.get<{ max?: number; idleTimeout?: number } | undefined>("database.pool");
      const replicaUrls = config.get<string[]>("database.replicas", []);

      const url = _normaliseSqliteUrl(rawUrl);
      const sqlArg =
        pool?.max !== undefined || pool?.idleTimeout !== undefined ? { url, ...pool } : url;
      const primary = new SQL(sqlArg as unknown as string);

      if (replicaUrls.length === 0) return primary;

      // Build read replicas and wrap in a transparent read/write router.
      // SELECT / WITH / EXPLAIN → round-robin replica pool.
      // INSERT / UPDATE / DELETE / DDL / transactions → primary.
      const replicas = replicaUrls.map((ru) => {
        const replicaUrl = _normaliseSqliteUrl(ru);
        const replicaSqlArg =
          pool?.max !== undefined || pool?.idleTimeout !== undefined
            ? { url: replicaUrl, ...pool }
            : replicaUrl;
        return new SQL(replicaSqlArg as unknown as string);
      });

      return createReadWriteRouter(primary, replicas);
    });
  }

  override async onBooting(): Promise<void> {
    const config = (await this.app.container.make("config")) as ConfigManager;
    const rawUrl = config.get<string>("database.url", ":memory:");
    _setBaseModelDialect(_detectDialect(rawUrl));

    const sql = (await this.app.container.make("db")) as SQLInstance;
    _setBaseModelConnection(sql);
    await sql`SELECT 1`;

    // Bridge model `dispatchesEvents` to the app event bus (no-op if no emitter).
    _setModelEventDispatcher((event) => {
      void this.app.container.tryMake("events")?.emit(event as object);
    });

    // Wire unique()/exists() validation rules to query through this connection.
    // Lazy-import so @zerotal/validator is an optional peer — apps that don't use
    // the validator still boot without errors.
    try {
      const { registerDbRuleRunner } = await import("@zerotal/validator");
      registerDbRuleRunner(async (rule, table, column, value, options) => {
        const conn = _getConnection();

        if (rule === "unique") {
          const ignoreId = options.ignoreId;
          let rows: unknown[];
          if (ignoreId !== undefined) {
            const strs = [`SELECT 1 FROM ${table} WHERE ${column} = `, ` AND id != `, ` LIMIT 1`];
            rows = await conn(
              Object.assign(strs, { raw: strs }) as unknown as TemplateStringsArray,
              value,
              ignoreId,
            );
          } else {
            const strs = [`SELECT 1 FROM ${table} WHERE ${column} = `, ` LIMIT 1`];
            rows = await conn(
              Object.assign(strs, { raw: strs }) as unknown as TemplateStringsArray,
              value,
            );
          }
          return rows.length === 0; // true = unique (no duplicate found)
        }

        // exists
        const strs = [`SELECT 1 FROM ${table} WHERE ${column} = `, ` LIMIT 1`];
        const rows = await conn(
          Object.assign(strs, { raw: strs }) as unknown as TemplateStringsArray,
          value,
        );
        return rows.length > 0; // true = exists (row found)
      });
    } catch {
      // @zerotal/validator not installed — unique()/exists() rules won't work
    }
  }

  override replContext(): Record<string, unknown> {
    return { DB };
  }

  override async onStopping(): Promise<void> {
    this._disposeObservability?.();
    this._disposeObservability = undefined;
    try {
      const sql = this.app.container.makeSync("db") as SQLInstance;
      _setBaseModelConnection(null);
      setConnectionResolver(null);
      await sql.end();
    } catch {
      // DB was never initialised — nothing to close
    }
  }

  override async onBooted(): Promise<void> {
    // Forward the ORM's framework events to whatever observers are installed.
    this._disposeObservability = installOrmObservability(this.app);

    // N+1 query detection — enabled outside production. Previously activated by
    // the devtools provider; owned here so devtools needs no ORM import.
    const env = Bun.env.APP_ENV ?? "";
    if (env !== "production" && env !== "prod") {
      preventNPlusOne({ threshold: 5, mode: "warn" });
    }

    const runner = this.app.container.tryMake("commands");
    if (!runner) return;

    runner.registerLazy(
      "migrate",
      () => import("../commands/MigrateCommand.ts").then((m) => m.MigrateCommand),
      ["db:migrate"],
    );
    runner.registerLazy("migrate:rollback", () =>
      import("../commands/MigrateRollbackCommand.ts").then((m) => m.MigrateRollbackCommand),
    );
    runner.registerLazy("migrate:fresh", () =>
      import("../commands/MigrateFreshCommand.ts").then((m) => m.MigrateFreshCommand),
    );
    // Same command, the name it has elsewhere. Nothing otherwise pushes anyone to
    // exercise their `down()` methods, and a rollback nobody has run is a
    // rollback that does not work.
    runner.registerLazy("migrate:refresh", () =>
      import("../commands/MigrateRefreshCommand.ts").then((m) => m.MigrateRefreshCommand),
    );
    runner.registerLazy("migrate:status", () =>
      import("../commands/MigrateStatusCommand.ts").then((m) => m.MigrateStatusCommand),
    );
    runner.registerLazy("make:migration", () =>
      import("../commands/MakeMigrationCommand.ts").then((m) => m.MakeMigrationCommand),
    );
    runner.registerLazy(
      "make:model",
      () => import("../commands/MakeModelCommand.ts").then((m) => m.MakeModelCommand),
      ["make:m"],
    );
    runner.registerLazy("db:seed", () =>
      import("../commands/DbSeedCommand.ts").then((m) => m.DbSeedCommand),
    );
    runner.registerLazy("make:seeder", () =>
      import("../commands/MakeSeederCommand.ts").then((m) => m.MakeSeederCommand),
    );
    runner.registerLazy("make:factory", () =>
      import("../commands/MakeFactoryCommand.ts").then((m) => m.MakeFactoryCommand),
    );
    runner.registerLazy("migrate:generate", () =>
      import("../commands/MigrateGenerateCommand.ts").then((m) => m.MigrateGenerateCommand),
    );
  }
}

/**
 * Normalise a database URL for Bun.sql.
 *
 * Bun v1.3.x on Windows only recognises SQLite when the URL begins with
 * 'sqlite:' or is exactly ':memory:'. Bare file paths are silently treated
 * as PostgreSQL connection strings, so we add the scheme explicitly.
 *
 * Mapping:
 *   :memory:            → :memory:        (Bun accepts it directly)
 *   sqlite://…          → sqlite:…        (collapse double-slash)
 *   sqlite:…            → sqlite:…        (keep)
 *   file:…              → sqlite:…        (rewrite scheme)
 *   postgres(ql)://…    → unchanged       (PostgreSQL pass-through)
 *   mysql(2)://…        → unchanged       (MySQL pass-through)
 *   ./path or path      → sqlite:./path   (add scheme)
 *
 * @internal
 */
export function _normaliseSqliteUrl(raw: string): string {
  if (!raw || raw === ":memory:") return raw;
  if (raw.startsWith("postgres://")) return raw;
  if (raw.startsWith("postgresql://")) return raw;
  if (raw.startsWith("mysql2://")) return raw;
  if (raw.startsWith("mysql://")) return raw;
  if (raw.startsWith("sqlite://")) return raw.replace("sqlite://", "sqlite:");
  if (raw.startsWith("sqlite:")) return raw;
  if (raw.startsWith("file:")) return "sqlite:" + raw.slice("file:".length);
  return "sqlite:" + raw;
}

/**
 * Infer the ORM dialect from a raw database URL.
 * @internal
 */
function _detectDialect(raw: string): "sqlite" | "postgres" | "mysql" {
  if (raw.startsWith("postgres://") || raw.startsWith("postgresql://")) return "postgres";
  if (raw.startsWith("mysql://") || raw.startsWith("mysql2://")) return "mysql";
  return "sqlite";
}
