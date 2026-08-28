import type { SQLInstance } from "./sql-types.ts";
/**
 * Transparent read/write routing for Bun SQL connections.
 *
 * `createReadWriteRouter()` returns a `SQLInstance`-compatible proxy that:
 *
 * - Routes **SELECT / WITH / EXPLAIN / PRAGMA / SHOW / DESCRIBE** → round-robin replica pool.
 * - Routes **everything else** (INSERT, UPDATE, DELETE, DDL, transactions) → primary.
 * - Delegates `begin()` (transactions) exclusively to the primary.
 * - Closes all unique connections on `end()`.
 *
 * The returned value is structurally identical to `SQLInstance`, so it is a
 * drop-in replacement everywhere a connection is expected — `DB.table()`,
 * `BaseModel`, and `DB.raw()` all route automatically with no code changes.
 *
 * @param primary  The writable primary/master connection.
 * @param replicas One or more read-replica connections. Load-balanced round-robin.
 *                 When empty, the primary is returned as-is (no overhead).
 *
 * @example
 * const primary = new SQL(env('DATABASE_URL'));
 * const replica = new SQL(env('REPLICA_URL'));
 * const router  = createReadWriteRouter(primary, [replica]);
 *
 * // Drop-in: pass router wherever you'd pass a SQL connection
 * DB.table('users')  // SELECT → replica, mutating → primary
 *
 * @internal
 */
export function createReadWriteRouter(primary: SQLInstance, replicas: SQLInstance[]): SQLInstance {
  if (replicas.length === 0) return primary;

  let _rr = 0;
  const pool = replicas;

  const handler: ProxyHandler<object> = {
    // Intercepts the tagged-template function call: conn`SELECT ...`
    apply(_target, _thisArg, args: unknown[]) {
      const tpl = args[0] as TemplateStringsArray;
      // Join ALL template fragments — locking clauses (FOR UPDATE / FOR SHARE)
      // appear at the END of a SELECT, typically after binding placeholders,
      // so classifying on the first fragment alone would miss them.
      const sql = Array.isArray(tpl) ? tpl.join(" ") : "";
      const conn = _isReadQuery(sql) ? pool[_rr++ % pool.length]! : primary;
      return (conn as unknown as (...a: unknown[]) => unknown)(...args);
    },

    get(_target, prop: string | symbol) {
      // Transactions always run on the primary
      if (prop === "begin") {
        return (primary as unknown as Record<string | symbol, unknown>)["begin"];
      }

      // On shutdown, close all unique connections
      if (prop === "end") {
        const unique = [...new Set([primary, ...pool])];
        return () => Promise.all(unique.map((c) => c.end())).then(() => undefined);
      }

      // Escape hatch used by DB.onPrimary() to extract the underlying primary
      if (prop === "__primary__") return primary;

      // Delegate all other property access to the primary
      return (primary as unknown as Record<string | symbol, unknown>)[prop];
    },
  };

  // The proxy target must be a function so the `apply` trap fires on calls
  return new Proxy(primary as unknown as object, handler) as unknown as SQLInstance;
}

/**
 * Returns `true` for queries that are safe to run on a read replica.
 * Strips leading block comments (`/* ... *\/`) and line comments (`-- ...`)
 * before testing so that annotated SQL is classified correctly.
 *
 * Locking reads (`SELECT … FOR UPDATE / FOR SHARE / LOCK IN SHARE MODE`)
 * are classified as writes — a row lock taken on a replica is useless, so
 * they must reach the primary even outside a transaction.
 *
 * Anything not matched here is treated as a write and routed to the primary.
 */
export function _isReadQuery(sql: string): boolean {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, "") // /* block comments */
    .replace(/--[^\n]*/g, "") // -- line comments
    .trimStart();
  if (!/^(select|with\b|explain\b|pragma\b|show\b|describe\b)/i.test(stripped)) return false;
  // Pessimistic-lock clauses defeat replication — route to the primary.
  if (
    /\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b|\block\s+in\s+share\s+mode\b/i.test(
      stripped,
    )
  ) {
    return false;
  }
  return true;
}
