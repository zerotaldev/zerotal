import type { SQLInstance } from "./sql-types.ts";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * AsyncLocalStorage that carries the active transaction connection through
 * the call stack. Set by DB.transaction(); read by BaseModel and DB helpers.
 *
 * This is the correct propagation mechanism for transactions that originate
 * outside a request context (console commands, scheduled jobs, seeders).
 * For request-scoped transactions, ctx._transaction is also set for legacy
 * callers, but TransactionContext is the authoritative source.
 */
export const TransactionContext = new AsyncLocalStorage<SQLInstance>();
