import { _getModelConnection, _setBaseModelConnection, type SQLInstance } from "@zerotal/orm";

/**
 * Wrap a test function in a database transaction that always rolls back.
 * Every query inside the callback uses the transaction, so changes are
 * invisible to other connections and never reach the actual database.
 *
 * Use with bun:test's `it()`:
 *
 * @example
 * it('creates a user', withDatabase(async () => {
 *   const user = await User.create({ name: 'Alice', email: 'alice@example.com' });
 *   expect(user.id).toBeDefined();
 *   await assertDatabaseHas('users', { email: 'alice@example.com' });
 *   // Rolls back after this function returns — no cleanup needed.
 * }));
 */
export function withDatabase(fn: () => Promise<void>): () => Promise<void> {
  return async (): Promise<void> => {
    const conn = _getModelConnection() as unknown as {
      begin<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
    };

    let testError: unknown;
    let testFailed = false;

    // Capture the pre-test connection so we can restore it after the transaction.
    const prevConn = _getModelConnection();

    await conn
      .begin(async (tx) => {
        _setBaseModelConnection(tx as SQLInstance);
        try {
          await fn();
        } catch (e) {
          testError = e;
          testFailed = true;
        } finally {
          // Restore to whatever was active before (usually the test DB), not null.
          _setBaseModelConnection(prevConn);
        }
        // Always rollback by throwing a sentinel — caught below.
        throw new Error("__ZT_TEST_ROLLBACK__");
      })
      .catch((e: unknown) => {
        if ((e as Error | null)?.message !== "__ZT_TEST_ROLLBACK__") throw e;
      });

    // Re-throw any error that came from the test body itself.
    if (testFailed) throw testError;
  };
}
