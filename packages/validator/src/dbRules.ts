/**
 * Inversion-of-control hook for DB-aware validation rules.
 *
 * Call `registerDbRuleRunner(fn)` from your ORM provider's onBooting()
 * so that unique() and exists() rules can query the database without
 * creating a hard dependency between @zerotal/validator and @zerotal/orm.
 *
 * @zerotal/orm's DatabaseProvider calls this automatically when you register it.
 */

type DbRuleRunner = (
  rule: "unique" | "exists",
  table: string,
  column: string,
  value: unknown,
  options: UniqueOptions,
) => Promise<boolean>;

export interface UniqueOptions {
  /** Ignore the row with this id — use on update to exclude the current record. */
  ignoreId?: number | string;
}

let _runner: DbRuleRunner | undefined;

/** Called by DatabaseProvider.onBooting() to wire in the DB query executor. */
export function registerDbRuleRunner(runner: DbRuleRunner): void {
  _runner = runner;
}

/**
 * @internal — clear the registered runner. Used by tests to assert the
 * "no runner registered" path deterministically, since `_runner` is a
 * process-global that another suite's DatabaseProvider may have set.
 */
export function _resetDbRuleRunner(): void {
  _runner = undefined;
}

/**
 * Run a DB-aware rule ('unique' or 'exists').
 * Returns an error string on failure, undefined on success.
 * Throws if no runner has been registered.
 */
export async function runDbRule(
  ruleName: "unique" | "exists",
  table: string,
  column: string,
  value: unknown,
  options: UniqueOptions,
  message?: string,
  field?: string,
): Promise<string | undefined> {
  if (_runner === undefined) {
    throw new Error(
      "[Zerotal] unique()/exists() rules require a database. " +
        "Register DatabaseProvider in your app to enable DB-aware validation.",
    );
  }

  const passed = await _runner(ruleName, table, column, value, options);

  if (!passed) {
    if (message !== undefined) return message;
    if (ruleName === "unique") return `The ${field ?? column} has already been taken.`;
    return `The selected ${field ?? column} is invalid.`;
  }

  return undefined;
}
