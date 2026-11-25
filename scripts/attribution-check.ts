/**
 * Fails when a commit, or a pull request's title or body, carries AI attribution:
 *
 * - in a message: a `Co-Authored-By:` trailer naming Claude or Anthropic, a "Generated with
 *   Claude Code" footer, or a `Claude-Session:` trailer;
 * - on a commit itself: an author or committer that is an AI agent (an `@anthropic.com`
 *   address, or the name `Claude`).
 *
 * The repository's commits are authored by its maintainer. One such commit reaching `main`
 * lists an extra account as a contributor on the repository page, whether through a trailer or
 * through the author field, and a force-push does not take it back: GitHub keeps the old
 * commit, pinned by its pull request. So the only cheap fix is not merging one, and this runs
 * on every pull request and every push.
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

/** A commit to check. `author` and `committer` are `Name <email>`. */
export interface CommitToCheck {
  sha: string;
  message: string;
  author?: string | undefined;
  committer?: string | undefined;
}

const MARKERS: readonly RegExp[] = [
  /^co-authored-by:.*\b(claude|anthropic)\b/i,
  /^co-authored-by:.*noreply@anthropic\.com/i,
  // The footer itself, with its link brackets; prose that names it ("the Generated with
  // Claude Code footer") is not one.
  /generated with \[claude code\]/i,
  /^claude-session:/i,
];

/** The lines of `text` that carry an attribution marker. */
export function attributionLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => MARKERS.some((marker) => marker.test(line)));
}

/**
 * Whether a `Name <email>` identity is an AI agent: an `@anthropic.com` address, or the name
 * `Claude` (or the `claude[bot]` app) exactly. A person who happens to be called Claude has a
 * surname, so a whole-name match leaves them alone.
 */
export function isAgentIdentity(identity: string): boolean {
  const match = /^(.*?)\s*<([^>]*)>\s*$/.exec(identity.trim());
  const name = (match ? match[1] : identity)?.trim() ?? "";
  const email = match?.[2]?.trim() ?? "";
  return /@anthropic\.com$/i.test(email) || /^claude(\[bot\])?$/i.test(name);
}

/** Every marker in the given commits and pull request text. */
export function findAttribution(
  commits: readonly CommitToCheck[],
  pullRequest: { title?: string | undefined; body?: string | undefined } = {},
): AttributionHit[] {
  const hits: AttributionHit[] = [];
  for (const { sha, message, author, committer } of commits) {
    const where = `commit ${sha.slice(0, 9)}`;
    if (author && isAgentIdentity(author)) hits.push({ where, line: `Author: ${author}` });
    if (committer && isAgentIdentity(committer)) {
      hits.push({ where, line: `Committer: ${committer}` });
    }
    for (const line of attributionLines(message)) hits.push({ where, line });
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

async function commitsToCheck(): Promise<CommitToCheck[]> {
  const base = Bun.env["BASE_SHA"]?.trim() ?? "";
  const head = Bun.env["HEAD_SHA"]?.trim() || "HEAD";
  const range = base !== "" && !NO_COMMIT.test(base) ? `${base}..${head}` : `${head}^!`;
  // Interpolated so the shell takes `<` as text, not as a redirect.
  const format = "--format=%H%x00%an <%ae>%x00%cn <%ce>%x00%B%x01";
  const raw = await $`git log ${format} ${range}`.text();
  return raw
    .split("\x01")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const [sha = "", author = "", committer = "", message = ""] = entry.split("\x00");
      return { sha, author, committer, message };
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
      "\nCommits here are authored by the maintainer alone. Remove the trailer lines, and give " +
        "any commit an agent authored the maintainer as author " +
        "(git commit --amend --reset-author, or an interactive rebase); edit the pull request " +
        "text too.",
    );
    process.exit(1);
  }
}
