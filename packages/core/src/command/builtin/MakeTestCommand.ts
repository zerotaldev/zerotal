/**
 * The `make:test` command and the test stubs it writes.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GeneratorCommand } from "../GeneratorCommand.ts";
import { _frameworkImport } from "../appSource.ts";
import { pluralize, singularize, snakeCase } from "../../support/str.ts";

/** What {@link featureTestStub} is told about the app it writes into. */
export interface FeatureTestStubOptions {
  /** Boot through `tests/helpers.ts` (the API starter has one), as a JSON API's tests do. */
  helpers?: boolean | undefined;
  /**
   * Boot through `bootApp()` from `tests/support.ts` (the React, Vue and Flow starters have it),
   * and send forms, as those starters' own tests do.
   */
  support?: boolean | undefined;
  /**
   * The app's pages are server-rendered HTML (the Flow starter's are), so the tests read a page
   * with `res.html()`: its text, and its links, fields and buttons by role and name.
   */
  html?: boolean | undefined;
  /** Sign in as a user from `database/factories/UserFactory.ts`, which the starters have. */
  userFactory?: boolean | undefined;
  /** The resource's list route already answers, so the test that reads it can run. */
  routeExists?: boolean | undefined;
  /** The test's directory, relative to the app root. `tests` unless given. */
  dir?: string | undefined;
  /** The specifier the testing helpers are imported by. `zerotal/testing` unless given. */
  testing?: string | undefined;
}

/**
 * A feature test: boots the app and drives it over real HTTP.
 *
 * Every test in it either passes on the app as it stands or is a `test.todo`: a test that calls
 * a route nobody has written yet is a todo, listed by `bun zt test` without failing it. The one
 * that reads the list runs as soon as the list's route exists.
 */
export function featureTestStub(name: string, options: FeatureTestStubOptions = {}): string {
  const subject = name.replace(/Test$/, "");
  // Resource routes and tables are plural, so the stub is a starting point you
  // edit rather than one you have to rewrite. Singular first, so a name that is already plural
  // stays as it is: `Posts` is `/posts`, not `/postses`.
  const table = pluralize(singularize(snakeCase(subject)));
  const route = table.replace(/_/g, "-");
  const singular = singularize(table).replace(/_/g, " ");
  const testing = options.testing ?? "zerotal/testing";
  const depth = (options.dir ?? "tests").split("/").filter(Boolean).length;
  const up = "../".repeat(depth);
  const helpersImport = depth === 1 ? "./helpers.ts" : `${"../".repeat(depth - 1)}helpers.ts`;
  const list = options.routeExists ? "test" : "test.todo";

  if (options.support) {
    const signIn = options.userFactory ? "    const user = await UserFactory.create();\n" : "";
    const as = options.userFactory ? "app.actingAs(user)" : "app";
    const listed = options.html
      ? `    const page = (await ${as}.get("/${route}")).assertOk().html();

    // Read it as a visitor does: \`page.assertSeeText("…")\`, a link or a button by its role and
    // name with \`page.getByRole("link", { name: "…" })\`, a field by its label or name with
    // \`page.field("…")\`. Then assert on what the list shows.
    expect(page.text()).not.toBe("");
`
      : `    (await ${as}.get("/${route}")).assertOk();
`;
    const shown = options.html
      ? `
    // And the list shows it.
    (await ${as}.get("/${route}")).assertOk().html().assertSeeText("Example");
`
      : "";
    return `import { afterAll, beforeAll, beforeEach, describe, ${options.html ? "expect, " : ""}test } from "bun:test";
import { assertDatabaseHas, refreshDatabase, type TestApp } from "${testing}";
${options.userFactory ? `import { UserFactory } from "${up}database/factories/UserFactory";\n` : ""}import { bootApp } from "./support";

let app: TestApp;

beforeAll(async () => {
  app = await bootApp();
});
afterAll(() => app.close());
beforeEach(() => app.actingAsGuest());

describe("${subject}", () => {
  // Each test runs in a transaction that rolls back, so they start from the
  // same clean database and can be read in any order.
  refreshDatabase();

  // A \`test.todo\` is listed by \`bun zt test\` and not run. Take \`.todo\` off each one
  // once the route it calls exists, and change the fields to the ones your form sends.
  ${list}("lists ${table.replace(/_/g, " ")}", async () => {
${signIn}${listed}  });

  test.todo("creates a ${singular}", async () => {
${signIn}    const res = await ${as}.postForm("/${route}", { name: "Example" });

    res.assertRedirect("/${route}");
    await assertDatabaseHas("${table}", { name: "Example" });
${shown}  });

  test.todo("rejects an invalid ${singular}", async () => {
${signIn}    const from = \`\${app.baseUrl}/${route}\`;
    const res = await ${as}.postForm("/${route}", {}, { Referer: from });

    res.assertRedirect("/${route}");
    res.assertInvalid(["name"]);
  });
});
`;
  }

  const boot = options.helpers
    ? `import { createApp } from "${helpersImport}";

let app: TestApp;

beforeAll(async () => {
  app = await createApp();
  await migrateDatabase();
});`
    : `let app: TestApp;

beforeAll(async () => {
  // Snapshot signing and sessions need a key, and each run gets a throwaway database.
  Bun.env.APP_KEY ??= "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  Bun.env.ZT_DB_URL ??= ":memory:";
  app = await createTestApp(() => import("${up}bootstrap/app.ts").then((m) => m.default));
  await migrateDatabase();
});`;
  // The write tests assume a JSON API, which the API starter is. In the other starters a page
  // saves through its own actions, so they are left as todos to fill in, not as failures on a
  // fresh app.
  const write = options.helpers && options.routeExists ? "test" : "test.todo";
  const imports = options.helpers
    ? `import { migrateDatabase, refreshDatabase, assertDatabaseHas } from "${testing}";`
    : `import {
  createTestApp,
  migrateDatabase,
  refreshDatabase,
  assertDatabaseHas,
} from "${testing}";`;
  return `import { describe, test, beforeAll, afterAll } from "bun:test";
${imports}
import type { TestApp } from "${testing}";
${boot}

afterAll(() => app.close());

describe("${subject}", () => {
  // Each test runs in a transaction that rolls back, so they start from the
  // same clean database and can be read in any order.
  refreshDatabase();

  // A \`test.todo\` is listed by \`bun zt test\` and not run. Take \`.todo\` off each one
  // once the route it calls exists.
  ${list}("lists ${table.replace(/_/g, " ")}", async () => {
    const res = await app.get("/${route}");

    res.assertOk();
  });

  ${write}("rejects an invalid payload", async () => {
    const res = await app.asJson().post("/${route}", {});

    res.assertUnprocessable();
    res.assertInvalid();
  });

  ${write}("creates a record", async () => {
    const res = await app.asJson().post("/${route}", { name: "Example" });

    res.assertCreated();
    await assertDatabaseHas("${table}", { name: "Example" });
  });
});
`;
}

/** A unit test: no server, no database, just the thing under test. */
export function unitTestStub(name: string): string {
  const subject = name.replace(/Test$/, "");
  return `import { describe, expect, test } from "bun:test";

describe("${subject}", () => {
  test("does the thing it exists to do", () => {
    expect(true).toBe(true);
  });
});
`;
}

/**
 * `tests/posts.test.ts` for `PostsTest` or `Posts`.
 *
 * `bun test` only discovers files named `*.test.*`, and the old `PostsTest.ts` was never run: a
 * green suite with the new test silently missing from it. The starters keep their tests flat in
 * `tests/`, beside the `support.ts` they share, so that is where a new one goes. An app that
 * already sorts its tests into `tests/feature/` and `tests/unit/` keeps that layout.
 *
 * @internal Exported for tests.
 */
export function _testPath(name: string, unit: boolean, cwd: string = process.cwd()): string {
  const file = snakeCase(name.replace(/Test$/, "")).replace(/_/g, "-");
  const sub = unit ? "unit" : "feature";
  const dir = existsSync(join(cwd, "tests", sub)) ? `tests/${sub}` : "tests";
  return `${dir}/${file}.test.ts`;
}

/**
 * Whether the app answers `GET <url>` already: a file in `app/routes/` that exports `GET` at
 * that path, or a route file under `routes/` that names it.
 *
 * Read from the source rather than a booted router, because a generator runs without the app.
 * A miss only makes a generated test a todo, so reading too little is safe.
 *
 * @internal Exported for tests.
 */
export function _routeExists(url: string, cwd: string = process.cwd()): boolean {
  const routes = join(cwd, "app", "routes");
  if (existsSync(routes)) {
    for (const file of new Bun.Glob("**/*.{ts,tsx}").scanSync({ cwd: routes })) {
      const segments = file
        .replace(/\.tsx?$/, "")
        .split(/[\\/]/)
        .filter((segment) => !/^\(.*\)$/.test(segment));
      if (segments.some((segment) => segment.startsWith("_"))) continue;
      if (segments.at(-1) === "index") segments.pop();
      if (`/${segments.join("/")}` !== url) continue;
      const source = readFileSync(join(routes, file), "utf8");
      if (/export\s+(?:async\s+)?(?:function|const)\s+GET\b/.test(source)) return true;
    }
  }
  const files = join(cwd, "routes");
  if (existsSync(files)) {
    for (const file of new Bun.Glob("*.ts").scanSync({ cwd: files })) {
      const source = readFileSync(join(files, file), "utf8");
      if (source.includes(`"${url}"`) || source.includes(`'${url}'`)) return true;
    }
  }
  return false;
}

/**
 * `bun zt make:test <name>` — scaffolds a test file in `tests/` (`--unit` for one with no app).
 *
 * The file is named `*.test.ts`, which is what `bun test` discovers. The feature stub boots the
 * app the way the rest of the suite does: through `bootApp()` from `tests/support.ts` (the React,
 * Vue and Flow starters), `tests/helpers.ts` (the API starter) or `bootstrap/app.ts`. Every test
 * in it passes on the app as it stands or is a `test.todo`.
 *
 * @category Scaffolding (make:*)
 */
export class MakeTestCommand extends GeneratorCommand {
  static override commandName = "make:test";
  static override description = "Create a new test file";
  // A test is named after what it covers, `PostTest` or `tasks`, and the file is kebab-case.
  static override nameKind = "file" as const;

  static override args = [
    { name: "name", required: true, description: "Test name (e.g. PostTest or tasks)" },
  ];

  static override flags = [
    {
      name: "unit",
      type: "boolean" as const,
      description: "Create a unit test (no app, no database) instead of a feature test",
      default: false,
    },
  ];

  protected override async generate(): Promise<void> {
    const name = this.args["name"]!;
    const unit = this.flags["unit"] === true;
    const path = _testPath(name, unit);

    const dir = path.slice(0, path.lastIndexOf("/"));
    // The React, Vue and Flow starters boot their tests through `bootApp()` in tests/support.ts;
    // the API starter through tests/helpers.ts. A generated test leans on the same one, and
    // lives beside it.
    const support =
      dir === "tests" &&
      /export\s+(?:async\s+)?function\s+bootApp\b/.test(readText("tests/support.ts"));
    const helpers = existsSync("tests/helpers.ts");
    const subject = name.replace(/Test$/, "");
    const route = `/${pluralize(singularize(snakeCase(subject))).replace(/_/g, "-")}`;
    const routeExists = _routeExists(route);

    const written = await this.writeFile(
      path,
      unit
        ? unitTestStub(name)
        : featureTestStub(name, {
            support,
            helpers: !support && helpers,
            // A Flow app's pages are HTML on the server; the React and Vue starters' are props.
            html: support && existsSync("app/flow"),
            userFactory: existsSync("database/factories/UserFactory.ts"),
            routeExists,
            dir,
            testing: _frameworkImport("@zerotal/testing"),
          }),
    );
    if (!written) return;
    if (!unit) {
      this.dim(
        routeExists
          ? `  It reads ${route}; the tests that write are todos until you fill in your form's fields.`
          : `  Nothing answers ${route} yet, so its tests are todos: \`bun zt test\` lists them ` +
              `and stays green. Take \`.todo\` off each once its route exists.`,
      );
    }
    this.next(`Run it: bun zt test ${path}`);
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
