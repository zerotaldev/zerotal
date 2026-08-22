import { deepMerge } from "@zerotal/core";
import type { ConfigValidator, ConfigIssue } from "@zerotal/core/config";

/**
 * Shape of the `database` config namespace produced by {@link DatabaseConfig}.
 * Consumed by {@link DatabaseProvider} to build the connection, read replicas,
 * pool, and auto-sync behaviour.
 */
export interface DatabaseConfigShape {
  /** Database driver. Default: 'sqlite' */
  driver: "sqlite" | "postgres" | "mysql";
  /** Connection URL. Default: './database/db.sqlite' */
  url: string;
  /**
   * Read-replica connection URLs.
   *
   * When one or more replicas are configured, the ORM automatically routes
   * SELECT / WITH / EXPLAIN queries to replicas (round-robin) and all
   * mutating queries (INSERT, UPDATE, DELETE, DDL) plus transactions to the
   * primary. No code changes are required in controllers or models.
   *
   * `env()` with no fallback is `string | undefined`, so an unset replica has to
   * drop out rather than widen the array — this field is `string[]`.
   *
   * @example
   * replicas: [
   *   env('REPLICA_1_URL'),
   *   env('REPLICA_2_URL'),
   * ].filter((url) => url !== undefined)
   */
  replicas?: string[];
  /**
   * Connection pool options (PostgreSQL and MySQL only).
   * Bun.sql manages the pool automatically - these tune its behaviour.
   */
  pool?: {
    /** Maximum number of connections in the pool. Default: 10 */
    max?: number;
    /** Seconds an idle connection is kept before being closed. Default: 30 */
    idleTimeout?: number;
  };
  /** SQLite-specific options */
  sqlite: {
    /** Path to the SQLite file. Use ':memory:' for in-memory database. */
    path: string;
  };
  /**
   * Auto-sync the schema to your models at boot (TypeORM-style). Opt-in, and
   * hard-off in production regardless of this value.
   *
   * - `false` (default): never sync; use generated migrations.
   * - `true`: additive sync - create missing tables, add missing columns. Never drops.
   * - `{ enabled, disruptive }`: set `disruptive: true` to also DROP columns that no
   *   model declares anymore (destroys their data - local/test only).
   *
   * @example
   * synchronize: env("APP_ENV") !== "production"          // additive
   * synchronize: { enabled: true, disruptive: false }     // explicit, additive
   * synchronize: { enabled: true, disruptive: true }      // also drops removed columns
   */
  synchronize?: boolean | { enabled: boolean; disruptive?: boolean };
}

const defaults: DatabaseConfigShape = {
  driver: "sqlite",
  url: "./database/db.sqlite",
  sqlite: { path: "./database/db.sqlite" },
};

/**
 * Create a typed database configuration object with defaults.
 *
 * IMPORTANT: For SQLite, do NOT use a 'sqlite://' protocol prefix.
 * Bun's native SQLite driver expects a raw file path or ':memory:'.
 *
 * @example
 * import { DatabaseConfig } from '@zerotal/orm';
 * export default DatabaseConfig({
 *   driver: 'sqlite',
 *   url:    env('DATABASE_URL', './database/db.sqlite'),
 * });
 */
export function DatabaseConfig(options: Partial<DatabaseConfigShape> = {}): DatabaseConfigShape {
  return deepMerge(defaults, options);
}

const DRIVERS = new Set<string>(["sqlite", "postgres", "mysql"]);

/**
 * Validate the `database` config namespace at boot. Catches driver/URL protocol
 * mismatches in any environment (they can never work), and flags
 * production-specific hazards — an in-memory database that vanishes on restart,
 * a `synchronize` flag that is silently ignored — as warnings. Registered by
 * {@link DatabaseProvider} via `app.registerConfigValidator("database", …)`.
 */
export const validateDatabaseConfig: ConfigValidator = (value, { isProduction }) => {
  const cfg = value as Partial<DatabaseConfigShape> | undefined;
  const issues: ConfigIssue[] = [];
  const driver = cfg?.driver ?? "sqlite";
  const url = cfg?.url ?? "";

  if (!DRIVERS.has(driver)) {
    issues.push({
      level: "error",
      message: `database.driver "${driver}" is not a supported dialect — use "sqlite", "postgres", or "mysql".`,
    });
    return issues;
  }

  const looksPostgres = /^postgres(ql)?:\/\//.test(url);
  const looksMysql = /^mysql2?:\/\//.test(url);
  if (driver === "postgres" && url && !looksPostgres) {
    issues.push({
      level: "error",
      message:
        `database.driver is "postgres" but database.url does not start with postgres:// — ` +
        `set DATABASE_URL to a PostgreSQL connection URL.`,
    });
  }
  if (driver === "mysql" && url && !looksMysql) {
    issues.push({
      level: "error",
      message:
        `database.driver is "mysql" but database.url does not start with mysql:// — ` +
        `set DATABASE_URL to a MySQL connection URL.`,
    });
  }
  if (driver === "sqlite" && (looksPostgres || looksMysql)) {
    issues.push({
      level: "error",
      message:
        `database.driver is "sqlite" but database.url points at a network database — ` +
        `set driver to match the URL, or point url at a file path.`,
    });
  }

  if (isProduction) {
    if (driver === "sqlite" && (url === ":memory:" || cfg?.sqlite?.path === ":memory:")) {
      issues.push({
        level: "warning",
        message:
          "database uses an in-memory SQLite store in production — every restart loses all data. " +
          "Point database.url at a file path or a network database.",
      });
    }
    const sync = cfg?.synchronize;
    if (sync === true || (typeof sync === "object" && sync !== null && sync.enabled)) {
      issues.push({
        level: "warning",
        message:
          "database.synchronize is enabled but auto-sync is hard-off in production — " +
          "the flag does nothing here. Ship schema changes as migrations.",
      });
    }
  }

  const replicas = cfg?.replicas ?? [];
  if (replicas.length > 0) {
    if (driver === "sqlite") {
      issues.push({
        level: "warning",
        message:
          "database.replicas is set with the sqlite driver — read/write splitting is for " +
          "network databases; the replica list adds no redundancy to a local file.",
      });
    }
    if (replicas.some((r) => typeof r !== "string" || r.length === 0)) {
      issues.push({
        level: "error",
        message:
          "database.replicas contains an empty entry — an unset environment variable is the " +
          "usual culprit. Every replica must be a full connection URL.",
      });
    }
  }

  return issues;
};

// Register this package's config namespace for typed `config()` dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    database: DatabaseConfigShape;
  }
}
