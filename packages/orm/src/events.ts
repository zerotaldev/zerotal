/**
 * The ORM's framework-event vocabulary. These are emitted on core's synchronous
 * {@link FrameworkEvents} bus by the ORM's query, transaction, migration, and
 * model-lifecycle machinery; observability packages subscribe to them by kind
 * (their class name) without importing the classes.
 *
 * `ctx` is typed as `object` (the request `HttpContext` when inside a request)
 * so these events carry no dependency back into the kernel or the pipeline.
 */

/**
 * Emitted after every SQL query completes — carries the SQL, its bindings,
 * timing, row count, and the active request context when inside one. Powers the
 * query log, slow-query warnings, and the N+1 detector.
 *
 * @category Database
 */
export class QueryExecuted {
  constructor(
    readonly sql: string,
    readonly bindings: unknown[],
    readonly startMs: number,
    readonly durationMs: number,
    readonly rowCount: number,
    /** Active HttpContext object, or undefined when outside a request. */
    readonly ctx: object | undefined,
  ) {}
}

/**
 * Emitted when the N+1 detector fires for a repeated query pattern (the same
 * SQL fingerprint run `count` times within one request).
 *
 * @category Database
 */
export class NPlusOneDetected {
  constructor(
    /** Normalised SQL fingerprint (parameter placeholders replaced with \x00). */
    readonly fingerprint: string,
    readonly count: number,
    readonly ctx: object | undefined,
  ) {}
}

/**
 * Emitted when a database transaction begins.
 * @category Database
 */
export class TransactionStarted {
  constructor(
    readonly txId: string,
    readonly ctx: object | undefined,
  ) {}
}

/**
 * Emitted when a database transaction commits successfully.
 * @category Database
 */
export class TransactionCommitted {
  constructor(
    readonly txId: string,
    readonly durationMs: number,
    readonly ctx: object | undefined,
  ) {}
}

/**
 * Emitted when a database transaction rolls back. `reason` is set when the
 * rollback was triggered by a caught error.
 * @category Database
 */
export class TransactionRolledBack {
  constructor(
    readonly txId: string,
    readonly durationMs: number,
    readonly reason: string | undefined,
    readonly ctx: object | undefined,
  ) {}
}

/**
 * Emitted after a single migration runs up or down; `ok` is false and `error`
 * is set when it failed.
 * @category Database
 */
export class MigrationRan {
  constructor(
    readonly name: string,
    readonly direction: "up" | "down",
    readonly durationMs: number,
    readonly ok: boolean,
    readonly error?: string,
  ) {}
}

/**
 * Emitted after a model row is created, updated, or deleted. The panel aggregates
 * these into per-model change counts. Suppressed during factory seeding (it rides
 * the hook system, which mutes there).
 *
 * @category Database
 */
export class ModelChanged {
  constructor(
    /** Model class name, e.g. "User". */
    readonly model: string,
    /** Backing table, e.g. "users". */
    readonly table: string,
    readonly operation: "created" | "updated" | "deleted",
  ) {}
}
