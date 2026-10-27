/**
 * The `make:test` command and the test stubs it writes.
 */
import { Command } from "../Command.ts";
import { pluralize, singularize, snakeCase } from "../../support/str.ts";

/**
 * A feature test: boots the app and drives it over real HTTP.
 *
 * @param options.helpers - Boot through `tests/helpers.ts` (the API starter has one) rather than
 *   through `bootstrap/app.ts`, which is what the other starters' own tests do.
 */
export function featureTestStub(
  name: string,
  options: { helpers?: boolean | undefined } = {},
): string {
  const subject = name.replace(/Test$/, "");
  // Resource routes and tables are plural, so the stub is a starting point you
  // edit rather than one you have to rewrite. Singular first, so a name that is already plural
  // stays as it is: `Posts` is `/posts`, not `/postses`.
  const table = pluralize(singularize(snakeCase(subject)));
  const route = table.replace(/_/g, "-");
  const boot = options.helpers
    ? `import { createApp } from '../helpers.ts';

let app: TestApp;

beforeAll(async () => {
  app = await createApp();
  await migrateDatabase();
});`
    : `let app: TestApp;

beforeAll(async () => {
  // Snapshot signing and sessions need a key, and each run gets a throwaway database.
  Bun.env.APP_KEY ??= 'test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa';
  Bun.env.ZT_DB_URL ??= ':memory:';
  app = await createTestApp(() => import('../../bootstrap/app.ts').then((m) => m.default));
  await migrateDatabase();
});`;
  const imports = options.helpers
    ? "migrateDatabase, refreshDatabase, assertDatabaseHas"
    : "createTestApp, migrateDatabase, refreshDatabase, assertDatabaseHas";
  return `import { describe, it, beforeAll, afterAll } from 'bun:test';
import { ${imports} } from 'zerotal/testing';
import type { TestApp } from 'zerotal/testing';
${boot}

afterAll(() => app.close());

describe('${subject}', () => {
  // Each test runs in a transaction that rolls back, so they start from the
  // same clean database and can be read in any order.
  refreshDatabase();

  it('lists ${route}', async () => {
    const res = await app.get('/${route}');

    res.assertOk();
  });

  it('rejects an invalid payload', async () => {
    const res = await app.asJson().post('/${route}', {});

    res.assertUnprocessable();
    res.assertInvalid();
  });

  it('creates a record', async () => {
    const res = await app.asJson().post('/${route}', { name: 'Example' });

    res.assertCreated();
    await assertDatabaseHas('${table}', { name: 'Example' });
  });
});
`;
}

/** A unit test: no server, no database, just the thing under test. */
export function unitTestStub(name: string): string {
  const subject = name.replace(/Test$/, "");
  return `import { describe, it, expect } from 'bun:test';

describe('${subject}', () => {
  it('does the thing it exists to do', () => {
    expect(true).toBe(true);
  });
});
`;
}

/**
 * `tests/feature/posts.test.ts` for `PostsTest` or `Posts`.
 *
 * `bun test` only discovers files named `*.test.*`, and the old `PostsTest.ts` was never run: a
 * green suite with the new test silently missing from it.
 *
 * @internal Exported for tests.
 */
export function _testPath(name: string, unit: boolean): string {
  const file = snakeCase(name.replace(/Test$/, "")).replace(/_/g, "-");
  return `tests/${unit ? "unit" : "feature"}/${file}.test.ts`;
}

/**
 * `bun zt make:test <name>` — scaffolds a test file under `tests/feature/`
 * (or `tests/unit/` with `--unit`).
 *
 * The file is named `*.test.ts`, which is what `bun test` discovers. The feature stub boots the
 * app the way the starter's own tests do: through `bootstrap/app.ts`, or through
 * `tests/helpers.ts` when the app has one (the API starter does), so a generated test runs against
 * the same configured application as the rest of the suite.
 *
 * @category Scaffolding (make:*)
 */
export class MakeTestCommand extends Command {
  static commandName = "make:test";
  static description = "Create a new test file";
  static needsApp = false;

  static get args() {
    return [{ name: "name", required: true, description: "Test name (e.g. PostTest)" }];
  }

  static get flags() {
    return [
      {
        name: "unit",
        type: "boolean" as const,
        description: "Create a unit test (no app, no database) instead of a feature test",
        default: false,
      },
    ];
  }

  async run(): Promise<void> {
    const name = this.args["name"]!;
    const unit = this.flags["unit"] === true;
    const path = _testPath(name, unit);
    // The API starter boots its tests through tests/helpers.ts; the others import
    // bootstrap/app.ts, and have no helper for a generated test to lean on.
    const helpers = await Bun.file("tests/helpers.ts").exists();

    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }

    // Bun.write() creates any missing parent directories, so no mkdir is needed.
    await Bun.write(path, unit ? unitTestStub(name) : featureTestStub(name, { helpers }));
    this.info(`Created: ${path}`);
    if (!unit) {
      this.dim(
        "  It assumes the resource's routes and a name column; edit the requests to match your app.",
      );
    }
  }
}
