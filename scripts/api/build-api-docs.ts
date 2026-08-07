/**
 * Build the API reference: collect entry points from the `exports` maps, then
 * run TypeDoc to emit Markdown into `docs/api/`.
 *
 * Phase 1 of the API-docs plan. Later phases add frontmatter injection, link
 * normalisation, and nav generation as post-process steps after the TypeDoc run.
 *
 * Usage: `bun run scripts/api/build-api-docs.ts`
 */
import { spawnSync } from "node:child_process";

function run(cmd: string, args: string[]): void {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

console.log("[api] collecting entry points from exports maps…");
run("bun", ["run", "scripts/api/collect-entrypoints.ts"]);

console.log("[api] running TypeDoc → docs/api …");
run("bunx", ["typedoc", "--options", "typedoc.json"]);

console.log("[api] post-processing links for the docs router…");
run("bun", ["run", "scripts/api/postprocess-api-docs.ts"]);

console.log("[api] generating sidebar nav…");
run("bun", ["run", "scripts/api/generate-nav.ts"]);

console.log("[api] done. Output in docs/api/");
