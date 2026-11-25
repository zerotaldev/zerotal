/**
 * Fails when a commit message, or a pull request's title or body, carries an AI attribution
 * marker: a `Co-Authored-By:` trailer naming Claude or Anthropic, a "Generated with Claude
 * Code" footer, or a `Claude-Session:` trailer.
 *
 * The repository's commits are authored by its maintainer. One co-author trailer reaching
 * `main` lists an extra account as a contributor on the repository page, and a force-push
 * does not take it back: GitHub keeps the old commit, pinned by its pull request. So the
 * only cheap fix is not merging one, and this runs on every pull request and every push.
 *
 * Commits checked: `BASE_SHA..HEAD_SHA` when both are set (a pull request, or a push with a
 * known previous tip), otherwise `HEAD` alone. `PR_TITLE` and `PR_BODY` are checked when set.
 *
 * Usage: bun run attribution:check
 */
import { $ } from "bun";

/** One marker found, and where. */
export interface AttributionHit {
  where: string;
  line: string;
}

const MARKERS: readonly RegExp[] = [
  /^co-authored-by:.*\b(claude|anthropic)\b/i,
  /^co-authored-by:.*noreply@anthropic\.com/i,
  /generated with \[?claude code/i,
  /^claude-session:/i,
];

/** The lines of `text` that carry an attribution marker. */
export function attributionLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => MARKERS.some((marker) => marker.test(line)));
}

/** Every marker in the given commits (`[sha, message]` pairs) and pull request text. */
export function findAttribution(
  commits: ReadonlyArray<readonly [string, string]>,
  pullRequest: { title?: string | undefined; body?: string | undefined } = {},
): AttributionHit[] {
  const hits: AttributionHit[] = [];
  for (const [sha, message] of commits) {
    for (const line of attributionLines(message)) {
      hits.push({ where: `commit ${sha.slice(0, 9)}`, line });
    }
  }
  for (const [field, text] of [
    ["title", pullRequest.title],
    ["body", pullRequest.body],
  ] as const) {
    if (!text) continue;
    for (const line of attributionLines(text)) hits.push({ where: `pull request ${field}`, line });
  }
  return hits;
}

const NO_COMMIT = /^0+$/;

async function commitsToCheck(): Promise<Array<[string, string]>> {
  const base = Bun.env["BASE_SHA"]?.trim() ?? "";
  const head = Bun.env["HEAD_SHA"]?.trim() || "HEAD";
  const range = base !== "" && !NO_COMMIT.test(base) ? `${base}..${head}` : `${head}^!`;
  const raw = await $`git log --format=%H%x00%B%x01 ${range}`.text();
  return raw
    .split("\x01")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const [sha = "", message = ""] = entry.split("\x00");
      return [sha, message];
    });
}

if (import.meta.main) {
  const commits = await commitsToCheck();
  const hits = findAttribution(commits, { title: Bun.env["PR_TITLE"], body: Bun.env["PR_BODY"] });
  if (hits.length === 0) {
    console.log(`\x1b[32m✓\x1b[0m no AI attribution in ${commits.length} commit(s).`);
  } else {
    console.error(`\x1b[31m✖ AI attribution found (${hits.length}):\x1b[0m`);
    for (const { where, line } of hits) console.error(`  ${where}: ${line}`);
    console.error(
      "\nRemove these lines. Commits here are authored by the maintainer alone; reword the " +
        "commit (git commit --amend, or an interactive rebase) and edit the pull request text.",
    );
    process.exit(1);
  }
}
