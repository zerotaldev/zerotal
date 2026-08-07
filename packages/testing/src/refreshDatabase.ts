import { _getModelConnection, _setBaseModelConnection, type SQLInstance } from "@zerotal/orm";
import { migrateDatabase } from "./migrateDatabase.ts";

interface TestHooks {
  beforeAll(fn: () => void | Promise<void>): void;
  afterAll(fn: () => void | Promise<void>): void;
  beforeEach(fn: () => void | Promise<void>): void;
  afterEach(fn: () => void | Promise<void>): void;
}

function _hooks(): TestHooks {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("bun:test") as TestHooks;
  } catch {
    throw new Error("[Zerotal] refreshDatabase() can only be used inside a `bun test` run.");
  }
}

export interface RefreshDatabaseOptions {
  connection?: SQLInstance;
  /**
   * Build the schema by running the project's migrations before the suite.
   * `true` uses `database/migrations`; pass a string for a different directory.
   *
   * Prefer this over hand-written DDL in `setup` — see {@link migrateDatabase}.
   */
  migrate?: boolean | string;
  setup?: (db: SQLInstance) => void | Promise<void>;
  teardown?: (db: SQLInstance) => void | Promise<void>;
}

export function refreshDatabase(options: RefreshDatabaseOptions = {}): void {
  const { beforeAll, afterAll, beforeEach, afterEach } = _hooks();

  let releaseGate: (() => void) | null = null;
  let txDone: Promise<void> | null = null;
  let prevConn: SQLInstance | null = null;
  let installedConn = false;

  beforeAll(async () => {
    if (options.connection) {
      _setBaseModelConnection(options.connection);
      installedConn = true;
    }
    if (options.migrate) {
      await migrateDatabase({
        connection: _getModelConnection(),
        ...(typeof options.migrate === "string" ? { path: options.migrate } : {}),
      });
    }
    if (options.setup) {
      await options.setup(_getModelConnection());
    }
  });

  afterAll(async () => {
    if (options.teardown) {
      await options.teardown(_getModelConnection());
    }
    if (installedConn) {
      _setBaseModelConnection(null);
      installedConn = false;
    }
  });

  beforeEach(async () => {
    prevConn = _getModelConnection();
    const conn = prevConn as unknown as {
      begin<T>(cb: (tx: unknown) => Promise<T>): Promise<T>;
    };

    const ROLLBACK = Symbol("zerotal.test.rollback");
    let openGate!: () => void;
    const gate = new Promise<void>((r) => {
      openGate = r;
    });
    let markReady!: () => void;
    const ready = new Promise<void>((r) => {
      markReady = r;
    });
    let txConn!: SQLInstance;

    txDone = conn
      .begin(async (tx) => {
        txConn = tx as SQLInstance;
        markReady();
        await gate;
        throw ROLLBACK;
      })
      .then(
        () => undefined,
        (e: unknown) => {
          if (e !== ROLLBACK) throw e;
        },
      );

    await ready;
    _setBaseModelConnection(txConn);
    releaseGate = openGate;
  });

  afterEach(async () => {
    if (releaseGate) {
      releaseGate();
      releaseGate = null;
    }
    if (txDone) {
      await txDone;
      txDone = null;
    }
    _setBaseModelConnection(prevConn);
    prevConn = null;
  });
}
