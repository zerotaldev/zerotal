#!/usr/bin/env bun
/**
 * Keep the docs app's coding-agent files equal to what `arch:update` would write.
 *
 *   bun run scripts/docs-agent-files.ts            # write
 *   bun run scripts/docs-agent-files.ts --check    # fail if any is stale
 *
 * `apps/docs` is an app like any other: its `AGENTS.md`, `CLAUDE.md`, `.mcp.json`
 * and the skills under `.agents/` are produced by `planInstall` in `@zerotal/arch`.
 * The starters have `starters:agent:check` for the same contract, and the docs app
 * had nothing. When 1.18.0 added per-tenant settings and the database queue's
 * engines to the capability list, the app's copies stayed a release behind until
 * `zt doctor` on the deployed site warned that `AGENTS.md` described a different
 * project.
 *
 * This runs the same function `arch:update` runs, against the app where it sits,
 * so "the gate passes" and "`arch:update --dry` has nothing to do" are the same
 * statement. It also reports a generated skill the generator no longer produces,
 * which `planInstall` cannot: it plans writes, never deletions.
 */
import { Glob } from "bun";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ArchConfig } from "../packages/arch/src/config.ts";
import { planInstall } from "../packages/arch/src/install/plan.ts";

const ROOT = join(import.meta.dir, "..");
export const DOCS_APP = join(ROOT, "apps", "docs");

/** Generated skills share this prefix; a skill the app wrote itself does not. */
const GENERATED_SKILL =
  /^\.agents\/skills\/zerotal-[^/]+\/SKILL\.md$|^\.claude\/skills\/zerotal-[^/]+\/SKILL\.md$/;

/** One file that differs from what `arch:update` would leave there. */
export interface AgentFileDrift {
  path: string;
  /** `stale` and `missing` would be written; `orphaned` is no longer generated. */
  kind: "stale" | "missing" | "orphaned" | "conflict";
  /** The text `arch:update` would write, for `stale` and `missing`. */
  text?: string | undefined;
  detail?: string | undefined;
}

/**
 * Every agent file in `root` that `arch:update` would change, or that it no
 * longer produces. Empty means the app is in agreement with its generator.
 */
export async function agentFileDrift(
  root: string,
  packages?: readonly string[] | undefined,
): Promise<AgentFileDrift[]> {
  const { changes } = await planInstall(root, ArchConfig(), { packages });
  const drift: AgentFileDrift[] = [];
  const planned = new Set<string>();

  for (const change of changes) {
    planned.add(change.path);
    if (change.status === "unchanged") continue;
    if (change.status === "conflict") {
      drift.push({ path: change.path, kind: "conflict", detail: change.detail });
      continue;
    }
    drift.push({
      path: change.path,
      kind: change.status === "created" ? "missing" : "stale",
      text: change.text,
    });
  }

  for await (const rel of new Glob("{.agents,.claude}/skills/*/SKILL.md").scan({
    cwd: root,
    onlyFiles: true,
    dot: true,
  })) {
    const path = rel.replace(/\\/g, "/");
    if (GENERATED_SKILL.test(path) && !planned.has(path)) drift.push({ path, kind: "orphaned" });
  }

  return drift.sort((a, b) => a.path.localeCompare(b.path));
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const drift = await agentFileDrift(DOCS_APP);

  if (check) {
    if (drift.length > 0) {
      console.error(
        "The docs app's agent files differ from what `arch:update` would write:\n" +
          drift
            .map((d) => `  apps/docs/${d.path} — ${d.kind}${d.detail ? ` (${d.detail})` : ""}`)
            .join("\n") +
          "\n\nRun `bun run docs:agent` and commit the result.",
      );
      process.exit(1);
    }
    console.log("docs:agent — the docs app's agent files are current.");
  } else {
    for (const d of drift) {
      const path = join(DOCS_APP, d.path);
      if (d.kind === "orphaned") {
        await rm(dirname(path), { recursive: true, force: true });
        console.log(`removed apps/docs/${d.path}`);
      } else if (d.kind === "conflict") {
        console.error(`left apps/docs/${d.path} — ${d.detail ?? "could not be merged"}`);
        process.exitCode = 1;
      } else if (d.text !== undefined) {
        await mkdir(dirname(path), { recursive: true });
        await Bun.write(path, d.text);
        console.log(`${d.kind === "missing" ? "created" : "updated"} apps/docs/${d.path}`);
      }
    }
    if (drift.length === 0) console.log("docs:agent — nothing to change.");
  }
}
