#!/usr/bin/env bun
/**
 * The supply-chain rules for GitHub Actions workflows, as a gate.
 *
 * The npm worms of 2026 came in through CI: an action's tag was moved to a
 * malicious commit, every workflow that named the tag ran it on its next build,
 * and the ones holding a publish token published with it. Three rules close that
 * door here, and each is a line somebody can remove without noticing, so each is
 * checked:
 *
 * 1. **Every action is pinned to a full commit SHA**, with the version it is in a
 *    trailing comment (`uses: actions/checkout@<40 hex> # v5.1.0`). A tag or a
 *    branch can be moved; a commit cannot. Dependabot reads the comment and keeps
 *    the pin current.
 * 2. **No `pull_request_target`.** It runs with the base repository's secrets and
 *    write token on an event a stranger's fork can trigger.
 * 3. **`id-token: write` only on the job that publishes.** The OIDC token is what
 *    npm trusted publishing exchanges for a publish credential; every other job
 *    that holds it is one more place it can leak from.
 *
 * And every workflow states its `permissions:` at the top, so a job's token is
 * read-only unless that job asks for more, whatever the repository default is.
 *
 * Covers this repository's workflows and the ones the starters give new apps.
 *
 *   bun run scripts/workflows-check.ts
 *
 * @module
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Jobs allowed to hold an OIDC token, by workflow filename. */
export const ID_TOKEN_JOBS: Readonly<Record<string, readonly string[]>> = {
  "release.yml": ["publish"],
};

/** One rule broken, with where. */
export interface WorkflowProblem {
  file: string;
  line: number;
  message: string;
}

const PINNED = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*v?\d[\w.-]*\s*$/;

/**
 * Every rule `text` breaks.
 *
 * Line-based rather than a YAML parse: the rules are about the text a reviewer
 * reads, and the workflows here are written in one plain style.
 *
 * @param file - Path shown in a problem, and whose basename picks the id-token allowance.
 * @param text - The workflow's contents.
 */
export function workflowProblems(file: string, text: string): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  const name = file.split(/[\\/]/).at(-1) ?? file;
  const allowed = new Set(ID_TOKEN_JOBS[name] ?? []);
  const lines = text.split(/\r?\n/);

  let inJobs = false;
  let job: string | undefined;
  let topLevelPermissions = false;

  lines.forEach((raw, index) => {
    const line = index + 1;
    const content = raw.replace(/(^|\s)#.*$/, "");

    if (/^permissions\s*:/.test(raw)) topLevelPermissions = true;
    if (/^jobs\s*:/.test(raw)) inJobs = true;
    const jobHeader = inJobs ? /^ {2}([\w-]+)\s*:\s*$/.exec(raw) : null;
    if (jobHeader) job = jobHeader[1];

    const uses = /^\s*(?:-\s*)?uses\s*:\s*(.+?)\s*$/.exec(raw);
    if (uses) {
      const target = uses[1]!.replace(/^["']|["']$/g, "");
      const local = target.startsWith("./") || target.startsWith("docker://");
      if (!local && !PINNED.test(target)) {
        problems.push({
          file,
          line,
          message:
            `\`uses: ${target}\` is not pinned to a commit. Write the full 40-character SHA ` +
            `with the version as a comment: \`uses: owner/action@<sha> # v1.2.3\`.`,
        });
      }
    }

    if (/\bpull_request_target\b/.test(content)) {
      problems.push({
        file,
        line,
        message:
          "`pull_request_target` runs with this repository's secrets and write token on an " +
          "event a fork can trigger. Use `pull_request`.",
      });
    }

    if (/\bid-token\s*:\s*write\b/.test(content)) {
      const where = job === undefined ? "at the workflow level" : `in job \`${job}\``;
      if (job === undefined || !allowed.has(job)) {
        problems.push({
          file,
          line,
          message:
            `\`id-token: write\` ${where}. Only the job that publishes may hold an OIDC token ` +
            `(${Object.entries(ID_TOKEN_JOBS)
              .map(([f, jobs]) => `${f}: ${jobs.join(", ")}`)
              .join("; ")}).`,
        });
      }
    }
  });

  if (!topLevelPermissions) {
    problems.push({
      file,
      line: 1,
      message:
        "No top-level `permissions:`. State the least the workflow needs (usually " +
        "`contents: read`) and widen it per job.",
    });
  }

  return problems;
}

/** The workflow files this gate covers, relative to `root`. */
export function workflowFiles(root: string): string[] {
  const files: string[] = [];
  const yaml = (dir: string): string[] => {
    try {
      return readdirSync(dir)
        .filter((f) => /\.ya?ml$/.test(f))
        .map((f) => join(dir, f));
    } catch {
      return [];
    }
  };
  files.push(...yaml(join(root, ".github/workflows")));
  const templates = join(root, "packages/create-zerotal/templates");
  for (const template of readdirSync(templates)) {
    files.push(...yaml(join(templates, template, "_github/workflows")));
  }
  // Forward slashes on every platform: `relative()` answers with backslashes on
  // Windows, and these paths are reported and compared as repository paths.
  return files.map((f) => relative(root, f).split("\\").join("/")).sort();
}

function main(): void {
  const root = join(import.meta.dir, "..");
  const files = workflowFiles(root);
  const problems = files.flatMap((file) =>
    workflowProblems(file, readFileSync(join(root, file), "utf8")),
  );

  console.log(`\n── Workflow supply-chain rules ──\n`);
  if (problems.length > 0) {
    for (const p of problems) console.error(`\x1b[31m✖\x1b[0m ${p.file}:${p.line} ${p.message}`);
    console.error(`\n${problems.length} problem(s) in ${files.length} workflow(s).\n`);
    process.exit(1);
  }
  console.log(
    `\x1b[32m✓\x1b[0m ${files.length} workflow(s): actions pinned by SHA, no ` +
      `pull_request_target, id-token only where it publishes, permissions stated.\n`,
  );
}

if (import.meta.main) main();
