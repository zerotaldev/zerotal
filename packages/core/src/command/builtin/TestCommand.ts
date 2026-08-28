import { Command } from "../Command.ts";
import { bunBinary } from "../../support/runtime.ts";

/**
 * `bun zt test [pattern] [flags]` — runs the test suite in the test environment.
 *
 * Wraps `bun test` with proper app-environment setup:
 *  - Sets APP_ENV=test before spawning so config loads correctly.
 *  - Passes ZT_DB_URL to the child process; the @zerotal/testing/preload module
 *    reads it and wires up the DB connection before each test file runs, so
 *    withDatabase() and DB.table() work without manual beforeAll boilerplate.
 *  - If @zerotal/testing is not installed the preload is silently skipped —
 *    tests that use createTestApp() still work without it.
 *
 * All positional args and recognised flags are forwarded to bun test.
 *
 * @example
 * ```bash
 * bun zt test                        # run all tests
 * bun zt test src/models             # filter by path
 * bun zt test --coverage             # with coverage
 * bun zt test --watch                # watch mode
 * ```
 *
 * @category Testing
 */
export class TestCommand extends Command {
  static commandName = "test";
  static description = "Run the test suite in test environment";
  static needsApp = false;

  /**
   * Default per-test and per-hook timeout, in milliseconds.
   *
   * Generous on purpose: the expensive thing in a Zerotal suite is booting the app in a
   * `beforeAll`, which Bun's 5s default does not allow for. Raising it costs nothing on a
   * passing suite and removes a failure mode that looks exactly like flakiness.
   */
  static readonly DEFAULT_TIMEOUT_MS = 30_000;

  static override args = [{ name: "pattern", required: false, default: "" }];

  static override flags = [
    {
      name: "coverage",
      type: "boolean" as const,
      description: "Collect test coverage",
      default: false,
    },
    {
      name: "watch",
      short: "w",
      type: "boolean" as const,
      description: "Watch for file changes and re-run",
      default: false,
    },
    {
      name: "timeout",
      type: "number" as const,
      description: `Per-test and per-hook timeout in milliseconds (default ${TestCommand.DEFAULT_TIMEOUT_MS})`,
      default: 0,
    },
    {
      name: "bail",
      type: "boolean" as const,
      description: "Stop after first failure",
      default: false,
    },
    {
      name: "migrate",
      type: "boolean" as const,
      description: "Run database/migrations against the test database before the suite",
      default: false,
    },
  ];

  async run(): Promise<void> {
    // Resolve DB URL — prefer an explicit ZT_DB_URL, then DATABASE_URL,
    // then fall back to :memory: (each createTestApp() call gets its own
    // in-process SQLite; preload is a no-op for that case anyway).
    const dbUrl = Bun.env["ZT_DB_URL"] ?? Bun.env["DATABASE_URL"] ?? ":memory:";

    if (this.flags["migrate"]) {
      const migrated = await _migrateTestDatabase(dbUrl);
      if (migrated === null) {
        this.error("--migrate needs @zerotal/orm installed in this project.");
        return;
      }
      this.dim(
        migrated.length > 0
          ? `Migrated ${migrated.length} migration(s) into ${dbUrl}`
          : `Test database schema already up to date`,
      );
    }

    const bunArguments: string[] = ["test"];

    // Only add --preload when @zerotal/testing is resolvable. If it isn't
    // installed, skip the preload rather than crashing bun test startup.
    const preloadPath = _resolvePreload(process.cwd());
    if (preloadPath) {
      bunArguments.push("--preload", preloadPath);
    } else {
      this.warn(
        "@zerotal/testing not found — skipping DB preload (add it to devDependencies for withDatabase() auto-setup)",
      );
    }

    const pattern = this.args["pattern"];
    if (pattern) bunArguments.push(pattern);

    if (this.flags["coverage"]) bunArguments.push("--coverage");
    if (this.flags["watch"]) bunArguments.push("--watch");
    if (this.flags["bail"]) bunArguments.push("--bail");

    // Bun's default is 5s and applies to hooks as well as tests — and `bunfig.toml`'s
    // `[test] timeout` does not cover hooks, only this flag does. A `beforeAll` that calls
    // `createTestApp()` boots providers and runs migrations, which on a cold start with a
    // dozen providers exceeds 5s; the failure lands on the first run and not the second,
    // so it reads as a flaky test and sends you hunting for a race that is not there.
    // A framework's own test runner should account for that framework's boot cost.
    const timeout = (this.flags["timeout"] as number | undefined) || TestCommand.DEFAULT_TIMEOUT_MS;
    bunArguments.push(`--timeout=${timeout}`);

    this.dim(`APP_ENV=test  ZT_DB_URL=${dbUrl}  bun ${Bun.version}`);
    this.dim(`bun ${bunArguments.join(" ")}\n`);

    // `bunBinary()`, not `"bun"`. The child of a command whose entire job is to run
    // this app's tests must be the runtime this app is served by, and `"bun"` is
    // resolved against PATH — so `node_modules/.bin/bun zt test` used to satisfy every
    // check in the parent process and then hand the suite to whatever the shell had.
    // The parent already refuses to boot on a runtime mismatch; spawning its own
    // binary is what extends that guarantee to the process the assertions run in.
    const subprocess = Bun.spawn([bunBinary(), ...bunArguments], {
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...Bun.env,
        APP_ENV: "test",
        ZT_DB_URL: dbUrl,
      } as Record<string, string | undefined>,
    });

    const code = await subprocess.exited;
    // Mirror bun test's exit code — non-zero means failures or errors.
    if (code !== 0) process.exit(code);
  }
}

/** Try to resolve @zerotal/testing/preload from the app's working directory. */
function _resolvePreload(cwd: string): string | null {
  try {
    return Bun.resolveSync("@zerotal/testing/preload", cwd);
  } catch {
    return null;
  }
}

/**
 * Apply `database/migrations` to the test database before the suite starts.
 *
 * An `:memory:` database belongs to whichever process opened it, so there is
 * nothing for a parent process to migrate — each test builds its own schema with
 * `refreshDatabase({ migrate: true })`. This is for the file-backed or server
 * databases where migrating once up front is both possible and much faster than
 * migrating per test file.
 *
 * @returns The migrations applied, or `null` when the ORM is not installed.
 */
async function _migrateTestDatabase(dbUrl: string): Promise<string[] | null> {
  if (dbUrl === ":memory:") return [];
  try {
    const { SQL } = await import("bun");
    // Core does not depend on the ORM — this reaches for it only when the app
    // being tested has one installed. The specifier lives in a variable so it
    // stays a runtime lookup rather than a compile-time dependency.
    const ormSpecifier = "@zerotal/orm";
    const orm = (await import(ormSpecifier)) as {
      MigrationRunner: new (o: { connection: unknown }) => {
        runFromDirectory(dir: string): Promise<string[]>;
      };
      _setDbConnection(conn: unknown): void;
      _setBaseModelConnection(conn: unknown): void;
    };
    const connection = new SQL(dbUrl);
    // A migration's `up()` reaches for the ambient connection through `Schema`,
    // so it has to be installed, not just handed to the runner.
    orm._setDbConnection(connection);
    orm._setBaseModelConnection(connection);
    return await new orm.MigrationRunner({ connection }).runFromDirectory("database/migrations");
  } catch {
    return null;
  }
}
