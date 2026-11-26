/**
 * @zerotal/testing/guard — stops a bare `bun test` from running against the
 * development database.
 *
 * `bun zt test` prepares the run: `APP_ENV=test`, a test database in `ZT_DB_URL`,
 * a 30-second timeout and in-process drivers. `bun test` typed straight into a
 * shell does none of that, and Bun still loads `.env` — so the suite boots with
 * `DATABASE_URL` pointing at the development database. The first sign is usually
 * migration 001 failing with "table already exists" against tables the dev
 * database already has; the worse outcome is a `refreshDatabase()` emptying them.
 *
 * New apps load this from `bunfig.toml`:
 *
 * ```toml
 * [test]
 * preload = ["zerotal/testing/guard"]
 * ```
 *
 * Under `bun zt test` it does nothing. A direct run that names its own database
 * with `ZT_DB_URL` — `ZT_DB_URL=:memory: bun test` — is deliberate and runs. A
 * direct run that would fall through to `DATABASE_URL` stops before the first
 * test file loads, with the command to run instead.
 *
 * @module
 */

/**
 * Set by `bun zt test` on the process it spawns, so the guard knows the run was prepared.
 *
 * @internal
 */
export const _TEST_RUNNER_MARKER = "ZT_TEST_RUNNER";

/**
 * Why this run should not go ahead, or `undefined` when it is safe.
 *
 * @param env - The process environment.
 * @internal
 */
export function _bareTestRunProblem(env: Record<string, string | undefined>): string | undefined {
  if (env[_TEST_RUNNER_MARKER] === "1") return undefined;
  if (env["ZT_DB_URL"] !== undefined && env["ZT_DB_URL"] !== "") return undefined;

  const url = env["DATABASE_URL"];
  if (url === undefined || url === "" || url === ":memory:") return undefined;

  return (
    `\n[Zerotal] This is a bare \`bun test\`, so the suite would run against ` +
    `DATABASE_URL=${url} — the database .env points \`zt dev\` at.\n\n` +
    `  Run the tests with:  bun zt test\n` +
    `  It sets APP_ENV=test, gives the suite its own database (ZT_DB_URL), resets the ` +
    `mail, queue, session and cache drivers, and allows 30s for each test and hook.\n\n` +
    `  To run \`bun test\` directly, name the database yourself:  ZT_DB_URL=:memory: bun test\n`
  );
}

const problem = _bareTestRunProblem(Bun.env as Record<string, string | undefined>);
if (problem !== undefined) {
  // A preload that throws stops the run before any test file is evaluated, which is
  // the point: nothing has connected to anything yet.
  throw new Error(problem);
}
