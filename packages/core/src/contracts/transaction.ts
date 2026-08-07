/**
 * The database-transaction contract — the opaque handle the kernel *carries*
 * for a request or scope without depending on `@zerotal/orm`.
 *
 * `HttpContext._transaction` and `RequestContext.transaction()` are typed as
 * this so the ORM can stash the active connection on the request and read it
 * back, while core never learns what a `Bun.sql` connection actually is. The
 * ORM's `SQLInstance` is a structural supertype of this — it adds `begin()` /
 * `end()` — so assigning one here is checked, not cast.
 *
 * @remarks
 * Core only ever *holds* the value; it never calls it. The single call
 * signature is enough to make the carried value type-safe while leaving the
 * full query API to the ORM, which narrows back to `SQLInstance` at its own
 * boundary.
 *
 * @category Contracts
 */
export interface TransactionContext {
  /**
   * Run a query via a tagged template. Present so the contract is a genuine
   * SQL-connection shape rather than an empty marker; the ORM's connection type
   * is assignable to it.
   */
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
}
