#!/usr/bin/env bun
/**
 * Generate the coding-agent files every starter ships: `AGENTS.md`, `CLAUDE.md`,
 * `.mcp.json` (and `.vscode/mcp.json` where the starter has `.vscode/`), and the
 * skills under `.agents/` and `.claude/`.
 *
 *   bun run scripts/starter-agent-files.ts            # write
 *   bun run scripts/starter-agent-files.ts --check    # fail if any is stale
 *
 * ## Why generated, and generated this way
 *
 * The files are exactly what `bun zt arch:install` writes into the scaffolded app,
 * produced by the same function (`planInstall`). That is the contract that makes
 * shipping them safe: `arch:update` after the first upgrade merges into files it
 * recognises, and the `doctor` check that compares `AGENTS.md` against a fresh
 * generation finds a new app in agreement with itself. Hand-written copies would
 * disagree with the generator on the first release that touched either.
 *
 * Each starter is scaffolded into a temporary directory first, rather than read
 * where it sits, because what `arch:install` sees is the app — `.vscode/` and not
 * `_vscode/`, `tests/*.test.ts` and not `.tmpl` — and the shape it reports is
 * read off those names.
 *
 * The package list is given rather than read from `node_modules`, which a starter
 * does not have: everything the template declares, with the `zerotal` bundle read
 * as the packages it bundles — what `declaredPackages()` reports once installed.
 *
 * `--check` runs in CI beside `arch:docs:check`. Guidance edited in `@zerotal/arch`
 * reaches new apps only through this, so a change there that is not regenerated
 * here would ship starters describing last release's framework.
 */
import { Glob } from "bun";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { format } from "prettier";
import { dirname, join } from "node:path";
import { ArchConfig } from "../packages/arch/src/config.ts";
import { planInstall } from "../packages/arch/src/install/plan.ts";
import {
  AGENT_PATHS,
  RENAMED,
  isAgentPath,
  scaffold,
} from "../packages/create-zerotal/src/scaffold.ts";
import type { Template } from "../packages/create-zerotal/src/scaffold.ts";
import { TEMPLATES } from "../packages/create-zerotal/src/args.ts";

const ROOT = join(import.meta.dir, "..");
const TEMPLATES_DIR = join(ROOT, "packages", "create-zerotal", "templates");

/** Written by hand, not generated: the provider that keeps the rest current. */
const HAND_WRITTEN = new Set(["app/providers/ArchProvider.ts"]);

const check = process.argv.includes("--check");

/** The output path's stored name in the template — the inverse of {@link RENAMED}. */
function storedPath(out: string): string {
  const [first = "", ...rest] = out.split("/");
  const stored = Object.entries(RENAMED).find(([, written]) => written === first)?.[0];
  return [stored ?? first, ...rest].join("/");
}

/** The `@zerotal/*` packages a starter has once installed. */
async function starterPackages(template: Template): Promise<string[]> {
  const manifest = (await Bun.file(join(TEMPLATES_DIR, template, "package.json")).json()) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter(
    (name) => name === "zerotal" || name.startsWith("@zerotal/"),
  );
  if (!declared.includes("zerotal")) return declared.sort();

  const bundle = (await Bun.file(join(ROOT, "packages", "zerotal", "package.json")).json()) as {
    dependencies?: Record<string, string>;
  };
  const bundled = Object.keys(bundle.dependencies ?? {}).filter((n) => n.startsWith("@zerotal/"));
  return [...new Set([...declared, ...bundled])].sort();
}

/** Every generated file for one starter, keyed by its stored path in the template. */
async function generate(template: Template): Promise<Map<string, string>> {
  const dir = await mkdtemp(join(tmpdir(), `zt-starter-agent-${template}-`));
  try {
    await scaffold({ name: "starter", template, db: "sqlite", target: dir, agent: false });
    // Skills go where Claude Code reads them as well as to the portable `.agents/`,
    // and `arch:install` decides that by whether `.claude/` exists.
    await mkdir(join(dir, ".claude"), { recursive: true });

    const packages = await starterPackages(template);
    const config = ArchConfig();

    // Applied until nothing changes: a file written in one pass can be what the
    // next pass detects, and the shipped set has to be the fixed point — the
    // state in which `arch:update` has nothing left to do.
    for (let pass = 0; ; pass++) {
      if (pass > 3) throw new Error(`${template}: arch:install did not settle`);
      const { changes } = await planInstall(dir, config, { packages });
      const conflict = changes.find((change) => change.status === "conflict");
      if (conflict) throw new Error(`${template}: ${conflict.path} — ${conflict.detail ?? ""}`);
      const writes = changes.filter((c) => c.status !== "unchanged" && c.text !== undefined);
      if (writes.length === 0) break;
      for (const change of writes) {
        const path = join(dir, change.path);
        await mkdir(dirname(path), { recursive: true });
        // JSON in the shape the starters' own `prettier --check` accepts.
        // `JSON.stringify` spreads a one-element array over three lines where the
        // formatter keeps it on one, so the raw output fails a new app's format
        // gate. `arch:update` compares these files as data, not text, so the
        // formatted file still reads as already up to date.
        const text = change.path.endsWith(".json")
          ? await format(change.text!, { parser: "json" })
          : change.text!;
        await Bun.write(path, text);
      }
    }

    const files = new Map<string, string>();
    for await (const rel of new Glob("**/*").scan({ cwd: dir, onlyFiles: true, dot: true })) {
      const out = rel.replace(/\\/g, "/");
      if (!isAgentPath(out) || HAND_WRITTEN.has(out)) continue;
      files.set(storedPath(out), await Bun.file(join(dir, rel)).text());
    }
    return files;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Generated files already in the template, so one no longer produced is noticed. */
async function shipped(template: Template): Promise<Set<string>> {
  const dir = join(TEMPLATES_DIR, template);
  const found = new Set<string>();
  for (const entry of AGENT_PATHS) {
    const stored = storedPath(entry.replace(/\/$/, ""));
    const pattern = entry.endsWith("/") ? `${stored}/**/*` : stored;
    for await (const rel of new Glob(pattern).scan({ cwd: dir, onlyFiles: true, dot: true })) {
      const path = rel.replace(/\\/g, "/");
      if (!HAND_WRITTEN.has(path)) found.add(path);
    }
  }
  return found;
}

const stale: string[] = [];

for (const template of TEMPLATES) {
  const dir = join(TEMPLATES_DIR, template);
  const expected = await generate(template);
  const existing = await shipped(template);

  for (const [path, text] of expected) {
    const file = Bun.file(join(dir, path));
    const current = (await file.exists()) ? await file.text() : undefined;
    if (current === text) continue;
    if (check) {
      stale.push(`${template}/${path}`);
      continue;
    }
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await Bun.write(join(dir, path), text);
    console.log(`${current === undefined ? "created" : "updated"} templates/${template}/${path}`);
  }

  for (const path of existing) {
    if (expected.has(path)) continue;
    if (check) {
      stale.push(`${template}/${path} (no longer generated)`);
      continue;
    }
    await rm(join(dir, path));
    console.log(`removed templates/${template}/${path}`);
  }
}

if (check) {
  if (stale.length > 0) {
    console.error(
      `The starters' agent files are stale:\n${stale.map((s) => `  ${s}`).join("\n")}\n\n` +
        "Run `bun run starters:agent` and commit the result.",
    );
    process.exit(1);
  }
  console.log("starters:agent — every starter's agent files are current.");
}
