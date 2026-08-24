/**
 * What an app *declares* versus what happens to be in its `node_modules`.
 *
 * `installedPackages()` answers "what is on disk here", which is right for a
 * version report and wrong for guidance. Two other kinds of package get into
 * `node_modules/@zerotal`: transitive dependencies, and whatever the install
 * layout decides to hoist — and layouts disagree with each other.
 *
 * That was not theoretical. The same commit of one app resolved seventeen
 * packages on a developer's machine and eleven on its own server, because the
 * server hoisted the shared ones to the workspace root instead. The generated
 * `AGENTS.md` shipped with sections for `@zerotal/queue`, `@zerotal/cache`,
 * `@zerotal/scheduler` and `@zerotal/validator` — telling an agent where this
 * app's jobs and schedules live, for an app that declares none of them and has
 * neither. It also made the file unstable between machines, so the check that
 * compares it against the project could not tell drift from a difference of
 * layout, and warned on a production deploy for no fault of the project's.
 *
 * Direct dependencies only: deterministic, and the honest reading of "what this
 * app has" — you import what you declare.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { declaredPackages, installedPackages } from "./topics.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zt-declared-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Put a package in `node_modules` as an ordinary directory. */
async function install(name: string, version = "1.8.0"): Promise<void> {
  const dir = join(root, "node_modules", ...name.split("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ name, version }));
}

async function declare(...names: string[]): Promise<void> {
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "an-app",
      dependencies: Object.fromEntries(names.map((n) => [n, "^1.8.0"])),
    }),
  );
}

const names = (found: { name: string }[]): string[] => found.map((p) => p.name).sort();

describe("declaredPackages", () => {
  it("keeps what the app depends on and drops what it merely has", async () => {
    await declare("@zerotal/orm", "zerotal");
    await install("@zerotal/orm");
    await install("zerotal");
    // Pulled in underneath the two above, and no evidence this app uses either.
    await install("@zerotal/queue");
    await install("@zerotal/cache");

    expect(names(await declaredPackages(root))).toEqual(["@zerotal/orm", "zerotal"]);
    // The unfiltered reading still sees everything — that is its job.
    expect(names(await installedPackages(root))).toEqual([
      "@zerotal/cache",
      "@zerotal/orm",
      "@zerotal/queue",
      "zerotal",
    ]);
  });

  it("counts devDependencies, where a testing package belongs", async () => {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "an-app",
        dependencies: { "@zerotal/orm": "^1.8.0" },
        devDependencies: { "@zerotal/testing": "^1.8.0" },
      }),
    );
    await install("@zerotal/orm");
    await install("@zerotal/testing");

    expect(names(await declaredPackages(root))).toEqual(["@zerotal/orm", "@zerotal/testing"]);
  });

  it("reports nothing for a package declared but not installed", async () => {
    // The version comes from disk, so a dependency nothing has installed has no
    // version to report and is not something the app can be using yet.
    await declare("@zerotal/orm", "@zerotal/admin");
    await install("@zerotal/orm");

    expect(names(await declaredPackages(root))).toEqual(["@zerotal/orm"]);
  });

  it("falls back to everything installed when there is no manifest to read", async () => {
    // Nothing to filter by. Guessing narrow would silently strip the guidance;
    // the unfiltered list is at least no worse than before this existed.
    await install("@zerotal/orm");
    await install("@zerotal/queue");

    expect(names(await declaredPackages(root))).toEqual(["@zerotal/orm", "@zerotal/queue"]);
  });

  it("carries the installed version through, not the declared range", async () => {
    // `^1.8.0` is what the manifest asks for; `1.8.0` is what is there. A report
    // of what is running has to say the second.
    await declare("@zerotal/orm");
    await install("@zerotal/orm", "1.8.0");

    expect((await declaredPackages(root))[0]?.version).toBe("1.8.0");
  });
});
