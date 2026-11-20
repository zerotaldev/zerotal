/**
 * One SQLite transaction at a time, and no other request inside it.
 *
 * Bun opens a single SQLite connection per database, and a transaction is a state of that
 * connection, not of the code that began it. While one request's `DB.transaction()` is open,
 * every statement any other request sends runs inside it: an ordinary write reports success and
 * then disappears when the transaction rolls back, and a second `DB.transaction()` either joins
 * the first or fails with `cannot start a transaction within a transaction`, depending on the
 * Bun version.
 *
 * PostgreSQL and MySQL have a pool, so each transaction has a connection of its own. This gives
 * SQLite the same isolation the only way one connection can have it: while a transaction is open,
 * the connection belongs to it. A statement from inside the transaction runs at once. A statement
 * or transaction from anywhere else waits until it ends, in the order they arrived.
 *
 * "Inside" is decided the way the rest of the ORM decides it:
 *
 * - **`DB.transaction(cb)`**: the callback and everything it awaits, tracked with
 *   AsyncLocalStorage, as `TransactionContext` already is.
 * - **`DB.beginTransaction()`**: the request that began it. A manual transaction has no callback
 *   to scope, and its caller commonly reaches the database through models rather than through the
 *   handle, so every statement from the same request belongs to it. Outside a request (a console
 *   command, a seeder) there is nothing to tell callers apart, and a manual transaction keeps the
 *   connection's own behaviour.
 *
 * A wait that outlasts `busyTimeout` fails with `database is locked`, which is what SQLite says
 * when two connections contend for a write, and what `DB.transaction(cb, attempts)` retries.
 * A cycle — a transaction awaiting work that is itself waiting for the transaction — is then an
 * error after the timeout rather than a request that never answers.
 *
 * @module
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { RequestContext, ZerotalError } from "@zerotal/core";
import type { SQLInstance } from "./sql-types.ts";

/** Milliseconds a statement waits for another request's transaction. */
export const DEFAULT_BUSY_TIMEOUT_MS = 5000;

/** The transaction holding the connection. */
interface Holder {
  /** Marks the async context of a `DB.transaction()` callback. */
  readonly token: symbol;
  /** The request that began a manual transaction; `undefined` for a callback transaction. */
  readonly request: object | null | undefined;
}

/**
 * The error a statement fails with when another request's transaction held the connection past
 * the timeout. Its message carries `database is locked`, as SQLite's own does.
 */
export class SqliteBusyError extends ZerotalError {
  constructor(timeoutMs: number) {
    super(
      `database is locked: another request's transaction held the SQLite connection for more ` +
        `than ${timeoutMs} ms. Keep transactions short, or raise database.sqlite.busyTimeout.`,
      "SQLITE_BUSY",
      503,
    );
  }
}

/**
 * Wrap a SQLite connection so that a transaction holds it exclusively.
 *
 * The wrapper is the connection everywhere the app reaches it: a tagged-template call, `unsafe()`
 * and `begin()` wait their turn, and every other property is the connection's own.
 *
 * @param conn - The SQLite connection.
 * @param options.busyTimeoutMs - How long a statement waits before failing.
 * @returns The wrapped connection.
 * @internal
 */
export function _sqliteExclusive(
  conn: SQLInstance,
  options: { busyTimeoutMs?: number } = {},
): SQLInstance {
  const timeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  const inside = new AsyncLocalStorage<symbol>();
  let holder: Holder | null = null;
  /** Resolves when the current holder releases. */
  let released: Promise<void> = Promise.resolve();
  /** The tail of the line of transactions waiting for the connection. */
  let line: Promise<void> = Promise.resolve();

  const request = (): object | undefined => RequestContext.tryGet();

  /** Whether the caller is part of the transaction holding the connection. */
  const belongs = (): boolean => {
    if (!holder) return true;
    if (inside.getStore() === holder.token) return true;
    // A manual transaction: the request that began it, or, outside requests, anyone.
    if (holder.request !== undefined) return (request() ?? null) === holder.request;
    return false;
  };

  /** `promise`, or a {@link SqliteBusyError} once `deadline` passes. */
  const until = async <T>(promise: Promise<T>, deadline: number): Promise<T> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SqliteBusyError(timeoutMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new SqliteBusyError(timeoutMs)), remaining);
    });
    try {
      return await Promise.race([promise, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  };

  /** Wait until the caller may use the connection: it is free, or held by the caller. */
  const waitTurn = async (): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (holder && !belongs()) await until(released, deadline);
  };

  /**
   * Take the connection for a transaction, after every transaction already waiting for it.
   * Resolves with the function that gives it back.
   */
  const acquire = (next: Holder): Promise<() => void> => {
    const ahead = line;
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Whoever queues next waits for this one, whether it ends by releasing or by timing out.
    let leave!: () => void;
    const left = new Promise<void>((resolve) => {
      leave = resolve;
    });
    line = ahead.then(() => left);
    const free = () => {
      if (holder === next) holder = null;
      release();
      leave();
    };
    return until(ahead, Date.now() + timeoutMs).then(
      () => {
        holder = next;
        released = mine;
        return free;
      },
      (error: unknown) => {
        // Never held, but the line must not wait for it.
        ahead.then(leave, leave);
        throw error;
      },
    );
  };

  const begin = async <T>(fn: (tx: SQLInstance) => Promise<T>): Promise<T> => {
    // A begin from inside the holding transaction is the connection's own business, as before.
    if (holder && belongs()) return conn.begin(fn);
    const token = Symbol("sqlite-transaction");
    const free = await acquire({ token, request: undefined });
    try {
      return await inside.run(token, () => conn.begin((tx) => inside.run(token, () => fn(tx))));
    } finally {
      free();
    }
  };

  /** Run `call` now when the caller may, or after waiting its turn. */
  const inTurn = <T>(call: () => T): T | Promise<T> =>
    !holder || belongs() ? call() : waitTurn().then(call);

  const handler: ProxyHandler<SQLInstance> = {
    apply(_target, _thisArg, args: unknown[]) {
      return inTurn(() => Reflect.apply(conn, undefined, args));
    },
    get(_target, prop) {
      if (prop === "begin") return begin;
      if (prop === _MANUAL) return holdForRequest;
      if (prop === _RAW) return conn;
      const value: unknown = Reflect.get(conn, prop);
      if (typeof value !== "function") return value;
      if (prop === "unsafe") {
        return (...args: unknown[]) => inTurn(() => Reflect.apply(value, conn, args));
      }
      return value.bind(conn);
    },
  };
  return new Proxy(conn, handler);

  /**
   * Hold the connection for a manual transaction until the returned release is called. The
   * request that asked owns it; outside a request, the connection is shared as it always was.
   */
  async function holdForRequest(): Promise<() => void> {
    const owner = request() ?? null;
    if (holder && belongs()) return () => {};
    return acquire({ token: Symbol("sqlite-manual-transaction"), request: owner });
  }
}

/** The property a manual transaction asks the wrapper for. */
const _MANUAL = Symbol.for("zerotal.orm.sqliteExclusive.manual");

/** The property that answers the connection inside the wrapper. */
const _RAW = Symbol.for("zerotal.orm.sqliteExclusive.raw");

/**
 * The connection a wrapped SQLite connection holds, or `conn` itself.
 *
 * For a transaction meant to contain everything that happens while it is open, which is what
 * `refreshDatabase()` opens around each test: on the bare connection, every statement runs inside
 * it, as it did before the wrapper.
 *
 * @internal
 */
export function _unwrapSqlite(conn: SQLInstance): SQLInstance {
  const raw: SQLInstance | undefined = Reflect.get(conn, _RAW);
  return raw ?? conn;
}

/**
 * For `DB.beginTransaction()`: take a wrapped SQLite connection for the current request, or do
 * nothing on any other connection. Resolves with the function that gives it back.
 *
 * @internal
 */
export async function _holdForManualTransaction(conn: SQLInstance): Promise<() => void> {
  const hold: (() => Promise<() => void>) | undefined = Reflect.get(conn, _MANUAL);
  return hold ? hold() : () => {};
}
