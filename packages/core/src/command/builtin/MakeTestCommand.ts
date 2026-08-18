/**
 * The `make:test` command and the test stubs it writes.
 */
import { Command } from "../Command.ts";
import { pluralize } from "../../support/str.ts";

/** A feature test: boots the app and drives it over real HTTP. */
export function featureTestStub(name: string): string {
  const subject = name.replace(/Test$/, "");
  // Resource routes and tables are plural, so the stub is a starting point you
  // edit rather than one you have to rewrite.
  const resource = pluralize(subject.toLowerCase());
  return `import { describe, it, beforeAll, afterAll } from 'bun:test';
import { migrateDatabase, refreshDatabase, assertDatabaseHas } from 'zerotal/testing';
import type { TestApp } from 'zerotal/testing';
import { createApp } from '../helpers.ts';

let app: TestApp;

beforeAll(async () => {
  app = await createApp();
  await migrateDatabase();
});

afterAll(() => app.close());

describe('${subject}', () => {
  // Each test runs in a transaction that rolls back, so they start from the
  // same clean database and can be read in any order.
  refreshDatabase();

  it('lists ${resource}', async () => {
    const res = await app.get('/${resource}');

    res.assertOk();
  });

  it('rejects an invalid payload', async () => {
    const res = await app.asJson().post('/${resource}', {});

    res.assertUnprocessable();
    res.assertInvalid();
  });

  it('creates a record', async () => {
    const res = await app.asJson().post('/${resource}', { name: 'Example' });

    res.assertCreated();
    await assertDatabaseHas('${resource}', { name: 'Example' });
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

function testPath(name: string, unit: boolean): string {
  const file = name.endsWith("Test") ? name : `${name}Test`;
  return `tests/${unit ? "unit" : "feature"}/${file}.ts`;
}

/**
 * `bun zt make:test <name>` — scaffolds a test file under `tests/feature/`
 * (or `tests/unit/` with `--unit`).
 *
 * The feature stub boots the app through `tests/helpers.ts`, the file the
 * templates scaffold, so a generated test runs against the same configured
 * application as every other test in the suite rather than building its own.
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
    const path = testPath(name, unit);

    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }

    // Bun.write() creates any missing parent directories, so no mkdir is needed.
    await Bun.write(path, unit ? unitTestStub(name) : featureTestStub(name));
    this.info(`Created: ${path}`);
    if (!unit) {
      this.dim("Feature tests boot the app through tests/helpers.ts — create it if you have not.");
    }
  }
}
