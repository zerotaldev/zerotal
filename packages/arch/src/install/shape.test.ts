/**
 * The guidance stops being a function of the package list.
 *
 * A package list answers "what is available here". It cannot answer the
 * questions that decide what an agent should actually write, because the
 * framework's contracts are not uniform across projects — and the places they
 * differ are the places where guessing wrong compiles cleanly and fails at
 * runtime.
 *
 * The case that prompted this: `EmailVerification` registers its column
 * imperatively, and a boot-time concern adds it to a table that already exists.
 * In an app whose models own the schema that is the whole story. In an app whose
 * migrations own it, the table is created by a migration that does not mention
 * the column, the concern never revisits it, and every query touching it fails —
 * `no such column: email_verified_at`, 419 tests down at once. The generated
 * `AGENTS.md` said nothing either way, and `zt doctor` had known the answer the
 * whole time.
 *
 * These tests are about detection being *right*, because guidance that states a
 * fact confidently and wrongly is worse than guidance that omits it.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectShape } from "./shape.ts";
import { buildGuidelines } from "./guidelines.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zt-shape-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, contents, "utf8");
}

const database = (synchronize: string): string =>
  `export default { default: "sqlite", synchronize: ${synchronize} };`;

describe("who owns the schema", () => {
  it("says migrations when migrations exist and sync is off", async () => {
    await write("config/database.ts", database("false"));
    await write("database/migrations/0001_create_users.ts", "export {};");

    expect((await detectShape(root)).schemaSource).toBe("migrations");
  });

  it("says models when sync is on and there are no migrations", async () => {
    await write("config/database.ts", database("true"));

    expect((await detectShape(root)).schemaSource).toBe("models");
  });

  it("says both when sync is on and migrations exist", async () => {
    // A real arrangement — sync locally, migrations in production — and also a
    // real mistake. Worth naming as ambiguous rather than resolving by guess.
    await write("config/database.ts", database("true"));
    await write("database/migrations/0001_create_users.ts", "export {};");

    expect((await detectShape(root)).schemaSource).toBe("both");
  });

  it("treats an expression as possibly on rather than off", async () => {
    // `synchronize: env("APP_ENV") !== "production"` is the common spelling. Only
    // a literal `false` is a confident "off"; reading anything else as off would
    // tell an app that syncs locally that migrations own its schema.
    await write("config/database.ts", database('env("APP_ENV") !== "production"'));
    await write("database/migrations/0001_create_users.ts", "export {};");

    expect((await detectShape(root)).schemaSource).toBe("both");
  });

  it("says nothing at all when there is no database config", async () => {
    // An app with no database gets no line about schemas. Silence is the correct
    // output here, not a default.
    expect((await detectShape(root)).schemaSource).toBe("unknown");

    const block = buildGuidelines({
      packages: [],
      serverName: "zerotal",
      shape: await detectShape(root),
    });
    expect(block).not.toContain("How this app is set up");
  });

  it("ignores an empty migrations directory", async () => {
    await write("config/database.ts", database("false"));
    await mkdir(join(root, "database", "migrations"), { recursive: true });

    expect((await detectShape(root)).schemaSource).toBe("unknown");
  });
});

describe("strictness", () => {
  it("follows the extends chain", async () => {
    // The failure this guards is silent and was live: a workspace app that
    // extends a strict base has none of these flags in its own file, so reading
    // only that file reports all three off and the guidance says nothing. The
    // framework's own docs app is exactly that shape.
    await write(
      "tsconfig.base.json",
      JSON.stringify({
        compilerOptions: {
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
        },
      }),
    );
    await write(
      "tsconfig.json",
      JSON.stringify({ extends: "./tsconfig.base.json", compilerOptions: { jsx: "react-jsx" } }),
    );

    expect((await detectShape(root)).strict).toEqual({
      strict: true,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
    });
  });

  it("lets the nearer file turn an inherited flag back off", async () => {
    await write(
      "tsconfig.base.json",
      JSON.stringify({ compilerOptions: { exactOptionalPropertyTypes: true } }),
    );
    await write(
      "tsconfig.json",
      JSON.stringify({
        extends: "./tsconfig.base.json",
        compilerOptions: { exactOptionalPropertyTypes: false },
      }),
    );

    expect((await detectShape(root)).strict.exactOptionalPropertyTypes).toBe(false);
  });

  it("does not infer the two from `strict`", async () => {
    // Neither is part of the `strict` family. Claiming them would put an
    // instruction in front of an agent that its compiler does not enforce.
    await write("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true } }));

    const { strict } = await detectShape(root);
    expect(strict.strict).toBe(true);
    expect(strict.exactOptionalPropertyTypes).toBe(false);
    expect(strict.noUncheckedIndexedAccess).toBe(false);
  });

  it("survives a tsconfig it cannot follow", async () => {
    // A package reference resolves through node_modules, which this does not
    // chase. Reporting what the file itself says beats reporting nothing.
    await write(
      "tsconfig.json",
      JSON.stringify({ extends: "@tsconfig/bun", compilerOptions: { strict: true } }),
    );

    expect((await detectShape(root)).strict.strict).toBe(true);
  });
});

describe("the block it produces", () => {
  it("tells a migrations app that a mixin's column still needs one", async () => {
    await write("config/database.ts", database("false"));
    await write("database/migrations/0001_create_users.ts", "export {};");

    const block = buildGuidelines({
      packages: ["@zerotal/auth"],
      serverName: "zerotal",
      shape: await detectShape(root),
    });

    expect(block).toContain("Migrations own the schema");
    expect(block).toContain("Schema.hasColumn");
  });

  it("is unchanged when no shape is passed", async () => {
    // The old callers keep the old output, so this is additive for anything that
    // has not been taught to detect.
    const without = buildGuidelines({ packages: ["@zerotal/orm"], serverName: "zerotal" });
    expect(without).not.toContain("How this app is set up");
  });

  it("says nothing about route types until they exist", async () => {
    await write("config/database.ts", database("false"));
    const before = buildGuidelines({
      packages: [],
      serverName: "zerotal",
      shape: await detectShape(root),
    });
    expect(before).not.toContain("Route names are typed");

    await write("types/routes.generated.ts", "export {};");
    const after = buildGuidelines({
      packages: [],
      serverName: "zerotal",
      shape: await detectShape(root),
    });
    expect(after).toContain("bun zt route:types");
  });
});
