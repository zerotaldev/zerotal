import { _getModelConnection } from "@zerotal/orm";

async function countRows(table: string, where: Record<string, unknown>): Promise<number> {
  const conn = _getModelConnection() as unknown as (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<Array<{ cnt: number }>>;

  const entries = Object.entries(where);
  const parts: string[] = [];
  const vals: unknown[] = [];

  let sql = `SELECT COUNT(*) as cnt FROM ${table}`;
  entries.forEach(([col, val], i) => {
    sql += i === 0 ? ` WHERE ${col} = ` : ` AND ${col} = `;
    parts.push(sql);
    vals.push(val);
    sql = "";
  });
  parts.push(sql);

  const tpl = Object.assign([...parts], { raw: [...parts] }) as unknown as TemplateStringsArray;
  const rows = await conn(tpl, ...vals);
  return Number(rows[0]?.cnt ?? 0);
}

/**
 * Assert that at least one row in `table` matches all key/value pairs in `where`.
 *
 * @example
 * await assertDatabaseHas('users', { email: 'alice@example.com' });
 */
export async function assertDatabaseHas(
  table: string,
  where: Record<string, unknown>,
): Promise<void> {
  const count = await countRows(table, where);
  if (count === 0) {
    throw new Error(
      `assertDatabaseHas: expected table "${table}" to contain a row matching ` +
        `${JSON.stringify(where)}, but no such row was found.`,
    );
  }
}

/**
 * Assert that `table` contains exactly `expected` rows (optionally filtered by `where`).
 *
 * @example
 * await assertDatabaseCount('users', 3);
 * await assertDatabaseCount('posts', 1, { published: 1 });
 */
export async function assertDatabaseCount(
  table: string,
  expected: number,
  where: Record<string, unknown> = {},
): Promise<void> {
  const count = await countRows(table, where);
  if (count !== expected) {
    const filter = Object.keys(where).length ? ` matching ${JSON.stringify(where)}` : "";
    throw new Error(
      `assertDatabaseCount: expected table "${table}"${filter} to have ${expected} row(s), but found ${count}.`,
    );
  }
}

/**
 * Assert that no row in `table` matches all key/value pairs in `where`.
 *
 * @example
 * await assertDatabaseMissing('users', { email: 'deleted@example.com' });
 */
export async function assertDatabaseMissing(
  table: string,
  where: Record<string, unknown>,
): Promise<void> {
  const count = await countRows(table, where);
  if (count > 0) {
    throw new Error(
      `assertDatabaseMissing: expected table "${table}" NOT to contain a row matching ` +
        `${JSON.stringify(where)}, but ${count} row(s) were found.`,
    );
  }
}
