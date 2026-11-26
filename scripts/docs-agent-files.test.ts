import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { declaredPackages } from "../packages/arch/src/probe/topics.ts";
import { DOCS_APP, agentFileDrift } from "./docs-agent-files.ts";

/** Everything `planInstall` reads, without `node_modules` or build output. */
const SKIP = new Set(["node_modules", "public", "storage", ".zerotal"]);

let copy: string;
let packages: string[];

beforeAll(async () => {
  packages = (await declaredPackages(DOCS_APP)).map((pkg) => pkg.name);
  copy = await mkdtemp(join(tmpdir(), "zt-docs-agent-"));
  await cp(DOCS_APP, copy, {
    recursive: true,
    filter: (src) => !SKIP.has(src.slice(DOCS_APP.length + 1).split("/")[0] ?? ""),
  });
});

afterAll(async () => {
  await rm(copy, { recursive: true, force: true });
});

describe("docs app agent files", () => {
  test("the committed copy agrees with the generator", async () => {
    expect(await agentFileDrift(DOCS_APP, packages)).toEqual([]);
  });

  test("an edited AGENTS.md and a deleted skill are both reported", async () => {
    const agents = join(copy, "AGENTS.md");
    const text = await Bun.file(agents).text();
    await Bun.write(agents, text.replace(/per-tenant settings/i, "per-user settings"));
    await rm(join(copy, ".agents/skills/zerotal-tenancy"), { recursive: true });

    const drift = await agentFileDrift(copy, packages);
    expect(drift.map((d) => `${d.kind} ${d.path}`)).toEqual([
      "missing .agents/skills/zerotal-tenancy/SKILL.md",
      "stale AGENTS.md",
    ]);
  });

  test("a generated skill the generator no longer produces is reported", async () => {
    await mkdir(join(copy, ".agents/skills/zerotal-retired"), { recursive: true });
    await Bun.write(join(copy, ".agents/skills/zerotal-retired/SKILL.md"), "# retired\n");
    // A skill the app wrote itself is left alone.
    await mkdir(join(copy, ".agents/skills/house-style"), { recursive: true });
    await Bun.write(join(copy, ".agents/skills/house-style/SKILL.md"), "# ours\n");

    const drift = await agentFileDrift(copy, packages);
    expect(drift.filter((d) => d.kind === "orphaned").map((d) => d.path)).toEqual([
      ".agents/skills/zerotal-retired/SKILL.md",
    ]);
  });
});
