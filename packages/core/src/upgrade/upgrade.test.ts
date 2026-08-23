/**
 * The properties that make an upgrade tool safe to run on someone's project.
 *
 * Not "does it rewrite `BaseModel`" — `sed` does that. These are the four things
 * that separate a codemod runner from a find-and-replace, and each one is a way
 * this could quietly ruin a working app:
 *
 * 1. **Dry by default.** A run that was not asked to write must not write.
 * 2. **Idempotent.** The second run reports nothing. Anyone whose first run
 *    printed warnings will run it again.
 * 3. **Version-scoped.** A 2.0.0 codemod must not fire on a 1.6 → 1.7 move.
 * 4. **Honest about what it skipped.** The handover list is the product.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planUpgrade, applyPlan, collectFiles, selectCodemods } from "./runner.ts";
import { compareVersions } from "./types.ts";
import type { Codemod } from "./types.ts";
import { CODEMODS, deprecatedAliases } from "./codemods/index.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zt-upgrade-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, contents, "utf8");
}

const read = (rel: string): Promise<string> => readFile(join(root, rel), "utf8");

// ── The runner's guarantees ───────────────────────────────────────────────────

describe("planUpgrade", () => {
  it("writes nothing while planning", async () => {
    await write(
      "app/models/Post.ts",
      'import { BaseModel } from "@zerotal/orm";\n\nexport class Post extends BaseModel {}\n',
    );

    const plan = await planUpgrade(root, CODEMODS, "1.9.0", "2.0.0");

    expect(plan.changes.size).toBe(1);
    // The file on disk is untouched: the plan holds the new contents instead.
    expect(await read("app/models/Post.ts")).toContain("extends BaseModel");
  });

  it("applies only when asked, and then exactly once", async () => {
    await write(
      "app/models/Post.ts",
      'import { BaseModel } from "@zerotal/orm";\n\nexport class Post extends BaseModel {}\n',
    );

    const first = await planUpgrade(root, CODEMODS, "1.9.0", "2.0.0");
    await applyPlan(root, first);
    expect(await read("app/models/Post.ts")).toContain("extends Model");

    // The second run is the real test. Anyone whose first run printed a warning
    // runs it again, and a codemod that is not idempotent mangles the file the
    // second time — or reports work that no longer exists.
    const second = await planUpgrade(root, CODEMODS, "1.9.0", "2.0.0");
    expect(second.changes.size).toBe(0);
  });

  it("runs nothing outside the version range", async () => {
    await write("app/models/Post.ts", "export class Post extends BaseModel {}\n");

    const plan = await planUpgrade(root, CODEMODS, "1.6.0", "1.7.0");

    expect(plan.codemods).toEqual([]);
    expect(plan.changes.size).toBe(0);
  });

  it("feeds each codemod what the last one produced", async () => {
    // Two codemods touching the same file. Reading the original in the second
    // would silently drop the first one's work — the failure this guards is a
    // file that comes out with only half its upgrade applied.
    const first: Codemod = {
      version: "2.0.0",
      name: "a",
      description: "one",
      run: (files) =>
        files[0]
          ? {
              changes: [{ file: files[0].file, summary: "a", contents: `${files[0].contents}A` }],
              manual: [],
            }
          : { changes: [], manual: [] },
    };
    const second: Codemod = {
      version: "2.0.0",
      name: "b",
      description: "two",
      run: (files) =>
        files[0]
          ? {
              changes: [{ file: files[0].file, summary: "b", contents: `${files[0].contents}B` }],
              manual: [],
            }
          : { changes: [], manual: [] },
    };

    await write("x.ts", "start");
    const plan = await planUpgrade(root, [first, second], "1.0.0", "2.0.0");

    expect(plan.changes.get("x.ts")?.contents).toBe("startAB");
    // One entry naming both, rather than the same file listed twice.
    expect(plan.changes.get("x.ts")?.summary).toBe("a; b");
  });

  it("skips node_modules and build output", async () => {
    await write("node_modules/pkg/index.ts", "export class X extends BaseModel {}\n");
    await write("dist/bundle.ts", "export class Y extends BaseModel {}\n");
    await write("app/Real.ts", "export class Z extends BaseModel {}\n");

    const plan = await planUpgrade(root, CODEMODS, "1.9.0", "2.0.0");

    expect([...plan.changes.keys()]).toEqual(["app/Real.ts"]);
  });
});

describe("selectCodemods", () => {
  const at = (version: string): Codemod => ({
    version,
    name: version,
    description: "",
    run: () => ({ changes: [], manual: [] }),
  });

  it("excludes the version being upgraded from and includes the one going to", () => {
    const all = [at("1.8.0"), at("1.9.0"), at("2.0.0")];
    // Already on 1.8.0, so its codemods are paid; moving to 2.0.0, so its are owed.
    expect(selectCodemods(all, "1.8.0", "2.0.0").map((c) => c.version)).toEqual(["1.9.0", "2.0.0"]);
  });

  it("orders by version, not by registration", () => {
    const all = [at("2.0.0"), at("1.8.0"), at("1.10.0")];
    // 1.10.0 after 1.8.0 — string ordering would put it first.
    expect(selectCodemods(all, "1.7.0", "2.0.0").map((c) => c.version)).toEqual([
      "1.8.0",
      "1.10.0",
      "2.0.0",
    ]);
  });
});

describe("compareVersions", () => {
  it("compares numerically, not lexically", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.7.5", "1.7.5")).toBe(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
  });
});

describe("collectFiles", () => {
  it("returns repo-relative forward-slashed paths", async () => {
    await write("app/models/Post.ts", "x");
    const files = await collectFiles(root, [".ts"]);
    expect(files.map((f) => f.file)).toEqual(["app/models/Post.ts"]);
  });
});

// ── The first real codemod ────────────────────────────────────────────────────

describe("deprecated-aliases (ledger #4)", () => {
  const run = (contents: string) => deprecatedAliases.run([{ file: "x.ts", contents }]);

  it("renames the base class and its import together", () => {
    const { changes } = run(
      'import { BaseModel, column } from "@zerotal/orm";\n\nexport class Post extends BaseModel {}\n',
    );
    const out = changes[0]!.contents;
    expect(out).toContain("extends Model");
    // The import has to follow, or the file stops compiling — which is the exact
    // trap the 1.3.0 mixin codemod fell into.
    expect(out).toContain('import { Model, column } from "@zerotal/orm";');
    expect(out).not.toContain("BaseModel");
  });

  it("does not produce a duplicate specifier when both names are imported", () => {
    const { changes } = run(
      'import { Model, BaseModel } from "@zerotal/orm";\n\nexport class Post extends BaseModel {}\n',
    );
    const out = changes[0]!.contents;
    expect(out).toContain("extends Model");
    expect(out.match(/\bModel\b/g)?.length).toBe(2); // the import and the extends
    expect(out).not.toContain("Model, Model");
  });

  it("hands back type positions instead of rewriting them", () => {
    const { changes, manual } = run(
      "function all<T extends BaseModel>(x: T): T[] {\n  return [x];\n}\n",
    );

    // `Model` and `BaseModel` are the same class, so this compiles either way —
    // which makes renaming it a readability call rather than a correctness one.
    expect(changes).toEqual([]);
    expect(manual).toHaveLength(1);
    expect(manual[0]!.line).toBe(1);
    expect(manual[0]!.reason).toContain("type position");
  });

  it("rewrites the command aliases", () => {
    const { changes } = run("Run `bun zt routes:types` then `bun zt serve --dev`.\n");
    const out = changes[0]!.contents;
    expect(out).toContain("bun zt route:types");
    expect(out).toContain("bun zt dev");
    expect(out).not.toContain("serve --dev");
  });

  it("leaves a file it has nothing to say about alone", () => {
    const { changes, manual } = run(
      'import { Model } from "@zerotal/orm";\n\nexport class Post extends Model {}\n',
    );
    expect(changes).toEqual([]);
    expect(manual).toEqual([]);
  });
});
