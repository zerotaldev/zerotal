import { Command } from "../Command.ts";
import { bunBinary } from "../../support/runtime.ts";
import { testEnvOverrides } from "../testEnv.ts";

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
 *  - Resets the driver keys `.env` would otherwise lend the suite (mail, queue,
 *    session, cache) to their in-process defaults, and loads `.env.test` when
 *    the app has one. See `../testEnv.ts` for why, and `--keep-env` to opt out.
 *
 * All positional args and recognised flags are forwarded to bun test. A flag it does not
 * recognise is refused rather than dropped; anything after `--` goes to `bun test` untouched.
 *
 * @example
 * ```bash
 * bun zt test                        # run all tests
 * bun zt test src/models             # filter by path
 * bun zt test a.test.ts b.test.ts    # several paths
 * bun zt test --coverage             # with coverage
 * bun zt test --watch                # watch mode
 * bun zt test --isolate              # a fresh global per test file
 * bun zt test --parallel             # files across CPU cores (Bun 1.4+)
 * bun zt test -- --shard=1/3         # any other bun test flag, after --
 * bun zt test -- --parallel=4        # an exact number of worker processes
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
      name: "isolate",
      type: "boolean" as const,
      description: "Run each test file in a fresh global, so one file cannot affect the next",
      default: false,
    },
    {
      name: "parallel",
      type: "boolean" as const,
      description:
        "Run test files across CPU cores, each in a fresh global (Bun 1.4+); a SQLite test " +
        "file is copied per worker",
      default: false,
    },

    {
      name: "migrate",
      type: "boolean" as const,
      description: "Run database/migrations against the test database before the suite",
      default: false,
    },
    {
      name: "keep-env",
      type: "boolean" as const,
      description: "Inherit .env's mail/queue/session/cache drivers instead of resetting them",
      default: false,
    },
  ];

  async run(): Promise<void> {
    // An option this command does not know is not ignored: the parser would drop it, and the
    // suite would run without whatever it asked for and report success. `zt test --isolate`
    // did exactly that, with no sign anything was missing.
    if (this.unknownFlags.length > 0) {
      const known = TestCommand.flags.map((flag) => `--${flag.name}`).join(" ");
      this.error(
        `zt test does not take ${this.unknownFlags.join(", ")}. Its options: ${known}.\n` +
          `Pass any other flag to bun test after --:  zt test -- ${this.unknownFlags[0]}`,
      );
      process.exitCode = 1;
      return;
    }

    // Resolve DB URL — prefer an explicit ZT_DB_URL, then DATABASE_URL,
    // then fall back to :memory: (each createTestApp() call gets its own
    // in-process SQLite; preload is a no-op for that case anyway).
    const dbUrl = Bun.env["ZT_DB_URL"] ?? Bun.env["DATABASE_URL"] ?? ":memory:";

    if (this.flags["migrate"]) {
      let migrated: string[] | null;
      try {
        migrated = await _migrateTestDatabase(dbUrl);
      } catch (error) {
        this.error(`--migrate failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
        return;
      }
      if (migrated === null) {
        this.error("--migrate needs @zerotal/orm installed in this project.");
        process.exitCode = 1;
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

    // Every path or pattern given, not just the first: `bun test a.test.ts b.test.ts` runs both,
    // and this used to run only `a` while reporting a green result for the pair.
    const patterns = [this.args["pattern"], ...this.rest].filter(
      (pattern): pattern is string => !!pattern,
    );
    bunArguments.push(...patterns);

    if (this.flags["coverage"]) bunArguments.push("--coverage");
    if (this.flags["watch"]) bunArguments.push("--watch");
    if (this.flags["bail"]) bunArguments.push("--bail");
    if (this.flags["isolate"]) bunArguments.push("--isolate");
    if (this.flags["parallel"]) {
      const [major = 0, minor = 0] = Bun.version.split(".").map(Number);
      if (major === 1 && minor < 4) {
        this.error(`--parallel needs Bun 1.4 or later; this is Bun ${Bun.version}.`);
        process.exitCode = 1;
        return;
      }
      bunArguments.push("--parallel");
      // A SQLite file is copied per worker by the preload; a server is not, so the workers
      // would share one database and see each other's rows.
      if (/^(postgres|postgresql|mysql|mysql2|mariadb):\/\//.test(dbUrl)) {
        this.warn(
          `--parallel workers share ${dbUrl.split("@").pop()}: each worker's rows are visible ` +
            "to the others. Use a SQLite test database, or run without --parallel.",
        );
      }
    }

    // Bun's default is 5s and applies to hooks as well as tests — and `bunfig.toml`'s
    // `[test] timeout` does not cover hooks, only this flag does. A `beforeAll` that calls
    // `createTestApp()` boots providers and runs migrations, which on a cold start with a
    // dozen providers exceeds 5s; the failure lands on the first run and not the second,
    // so it reads as a flaky test and sends you hunting for a race that is not there.
    // A framework's own test runner should account for that framework's boot cost.
    const timeout = (this.flags["timeout"] as number | undefined) || TestCommand.DEFAULT_TIMEOUT_MS;
    bunArguments.push(`--timeout=${timeout}`);

    // `.env` is written for `zt dev`; a test run should decide for itself which
    // outbound services it reaches. Reported rather than applied silently — a
    // suite that behaves differently from the same code under `zt dev` has to
    // say so, or the next person debugs the difference instead of reading it.
    const { overrides, neutralised } = this.flags["keep-env"]
      ? { overrides: {}, neutralised: [] as string[] }
      : await testEnvOverrides(process.cwd(), Bun.env as Record<string, string | undefined>);

    this.dim(`APP_ENV=test  ZT_DB_URL=${dbUrl}  bun ${Bun.version}`);
    if (neutralised.length > 0) {
      this.dim(`Reset for tests: ${neutralised.join("  ")}  (keep .env's with --keep-env)`);
    }
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
        ...overrides,
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
  // Core does not depend on the ORM, so it is found from the app being tested, as the app's own
  // imports find it. Resolving it from core's directory worked only where `node_modules` was
  // hoisted, and said the ORM was missing under the isolated linker.
  let ormPath: string;
  try {
    ormPath = Bun.resolveSync("@zerotal/orm", process.cwd());
  } catch {
    return null;
  }
  const { SQL } = await import("bun");
  const orm = (await import(ormPath)) as {
    MigrationRunner: new (o: { connection: unknown }) => {
      runFromDirectory(dir: string): Promise<string[]>;
    };
    _setDbConnection(conn: unknown): void;
    _setBaseModelConnection(conn: unknown): void;
    _normaliseSqliteUrl(raw: string): string;
  };
  // `./database/test.sqlite` as the app's config writes it: Bun's SQL needs the `sqlite:` scheme
  // to open a file, and without it every --migrate against a SQLite file failed to connect.
  const connection = new SQL(orm._normaliseSqliteUrl(dbUrl));
  // A migration's `up()` reaches for the ambient connection through `Schema`,
  // so it has to be installed, not just handed to the runner.
  orm._setDbConnection(connection);
  orm._setBaseModelConnection(connection);
  // A migration that fails throws, with its own message. It used to be caught here and reported
  // as "@zerotal/orm is not installed", which sent people to reinstall a package they had.
  return await new orm.MigrationRunner({ connection }).runFromDirectory("database/migrations");
}
