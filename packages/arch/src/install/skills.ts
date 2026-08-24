/**
 * Depth that costs nothing until it is needed.
 *
 * `guidelines.ts` opens by saying that every prompt its output lands in pays for
 * its whole length, and that is why the block there is short and points rather
 * than teaches. The cost is real, and so is what it buys: an agent gets a map and
 * no detail, and the detail is where the expensive mistakes live. Knowing that
 * migrations exist is not the same as knowing that a mixin's column needs one
 * here and not in the app next door.
 *
 * A skill is the other half. It sits on disk with a one-line description, costs
 * nothing while it is not relevant, and is loaded whole when it is — so the depth
 * that could never be afforded upfront can be written out properly.
 *
 * ## What belongs here rather than in the block
 *
 * Anything procedural. The block says what exists and who owns it; a skill says
 * how to do one thing correctly, including the parts that look optional and are
 * not. If a line would only ever matter to someone already doing the task, it is
 * a skill.
 *
 * ## What does not belong here at all
 *
 * Anything the tools answer better. `api_surface` gives exact signatures for the
 * installed version and `search_docs` gives the pages; a skill that paraphrases
 * either is a copy that starts wrong on the next release. These describe
 * *sequences and traps* — what the documentation is worst at and what costs the
 * most to learn by hitting it.
 */
import type { ProjectShape } from "./shape.ts";

/**
 * Marks a file as this tool's to rewrite.
 *
 * Placed as the first body line, after the frontmatter, because frontmatter has
 * to open the file. A `SKILL.md` without it is somebody's own and is never
 * touched — overriding a shipped skill should be as simple as editing it.
 */
export const SKILL_MARKER = "<!-- zerotal:arch:generated -->";

export interface Skill {
  /** Directory name, and the name in the frontmatter. */
  name: string;
  /** The one line an agent reads to decide whether to load the rest. */
  description: string;
  /** Packages that must be installed for this skill to apply. */
  requires?: string[];
  /** Body, given the project's shape. Empty means "not applicable here". */
  body: (shape: ProjectShape | undefined) => string;
}

const SCHEMA_SKILL: Skill = {
  name: "zerotal-schema-changes",
  description:
    "Add or change a database column in a Zerotal app — deciding whether a migration is " +
    "required, writing one that is safe to re-run, and the mixin columns that need one even " +
    "though nothing declares them.",
  requires: ["@zerotal/orm"],
  body: (shape) => {
    const source = shape?.schemaSource ?? "unknown";
    const owner =
      source === "migrations"
        ? "**Migrations own the schema in this app.**"
        : source === "models"
          ? "**The models own the schema in this app** (`database.synchronize` is on)."
          : source === "both"
            // `_and_`, not `*and*`: the file is written into someone's repository
            // and prettier's markdown emphasis is underscores. A generator that
            // emits output failing the project's own format check is a generator
            // nobody can run in CI.
            ? "**Both are in play here** — `database.synchronize` is on _and_ migrations exist. " +
              "Run `doctor` and read the source-of-truth line before you touch anything."
            : "**Which one owns the schema here is not obvious from the config.** Run `doctor` " +
              "and read the source-of-truth line first.";

    return `
# Changing the schema

${owner}

## Decide who owns the schema before writing anything

Two arrangements, and they need different work for the same change:

- **Models own it** (\`database.synchronize\`). The table is built from what the models
  declare. A \`@column\` is the whole change; there is no migration to write.
- **Migrations own it.** The table is built from what a migration says. A \`@column\` alone
  changes nothing on disk, and every query touching it fails at runtime.

\`bun zt doctor\` reports which. Ask it rather than guessing — the failure mode for guessing
wrong is a clean type-check and a runtime error under load.

## The columns nothing declares

Some mixins register a column imperatively rather than with \`@column\` — \`EmailVerification\`
adds \`email_verified_at\`, \`Authenticatable\` adds \`remember_token\`. A boot-time concern
adds those to their table **if the table already exists**.

It never creates a table, and it never revisits one. So where migrations own the schema, a
\`create users\` migration that does not mention \`email_verified_at\` produces a table
without it, permanently:

\`\`\`
SQLiteError: no such column: email_verified_at
\`\`\`

Composing such a mixin in a migrations-owned app means writing the migration too.

## Write the migration so it can meet a database that already has the column

The concern above may already have added it — on any database that has booted the app since
the mixin was composed. An unguarded \`ALTER TABLE\` then fails with \`duplicate column name\`,
during the release's \`migrate\` step:

\`\`\`ts
import { Schema } from "@zerotal/orm";

export default class extends Migration {
  async up(): Promise<void> {
    if (!(await Schema.hasColumn("users", "email_verified_at"))) {
      await Schema.table("users", (table) => {
        table.dateTime("email_verified_at").nullable();
      });
    }
  }
}
\`\`\`

## Sequence

1. \`bun zt doctor\` — who owns the schema.
2. \`bun zt make:migration\` if migrations do. Never hand-edit one that has run: the runner
   records it as applied and will not run it again, so the edit reaches no database that
   already migrated.
3. Call the \`schema\` tool afterwards to confirm the column is really there. It reads the
   database, not the models, which is the difference that matters here.
4. \`bun zt test\`.
`.trim();
  },
};

const RELEASE_SKILL: Skill = {
  name: "zerotal-releases",
  description:
    "Ship a Zerotal app — ordering the release steps, replacing built assets rather than " +
    "merging into them, and the proxy and shell settings that fail quietly in production.",
  body: () =>
    `
# Shipping a release

## Name your own steps

\`deploy:<env>\` runs the steps named in \`config/deploy.ts\`, defaulting to build-and-migrate.
A preflight command of your own runs only if you name it, and nothing prompts you to:

\`\`\`ts
// config/deploy.ts
export default {
  targets: {
    production: {
      url: "https://example.com",
      steps: ["release:check", "assets:build", "inertia:build", "migrate"],
    },
  },
};
\`\`\`

Put the check first. A step that fails stops the release, and a check that runs after the
migration has missed its moment.

\`deploy:<env>\` runs **where the app runs**, with that environment's variables. It does not
reach another machine.

## Replace the asset directory, do not merge into it

Each build emits a fresh set of content-hashed chunks and cleans up the set it replaced. It
can only clean a directory it is run in. A release unpacked over the top of the running one
— \`tar -xzf\` into the app directory, \`rsync\` without \`--delete\` — merges: files in the
archive are written, files not in it are left exactly where they were. Nothing on that
machine ever runs a build, so last release's bundles stay, and they stay **publicly
fetchable at their hashed URLs**. Copy you withdrew is still readable by anyone with the
link.

\`\`\`bash
rm -rf "$APP_DIR/public/assets"    # before extracting
tar -xzf release.tgz -C "$APP_DIR"

# or
rsync -a --delete public/assets/ "$HOST:$APP_DIR/public/assets/"
\`\`\`

Clearing takes the running release's bundles away, so do it close to the swap, or stage into
a new directory and move it into place.

\`--clean\` on \`assets:build\` / \`inertia:build\` removes anything in the output directory the
build did not write. It is for output some other naming produced; it does not help a
directory nothing runs in, and it refuses \`public/\` itself.

## Rate limiting counts the proxy, not the visitor

Behind a proxy every request arrives from the same address, so one bucket is shared by
everybody and a single client can lock the site out. Say how many proxies are in front:

\`\`\`ts
ThrottleMiddleware.with({ maxAttempts: 60, trustedProxies: 1 });
\`\`\`

It defaults to zero because \`X-Forwarded-For\` is client-written until something trusted
overwrites it. Count the proxies you actually run — too many reads an entry the client
supplied.

## A pipe hides the exit status

\`\`\`bash
bun test 2>&1 | tail -3     # the status is tail's. Always 0, however the suite went.
\`\`\`

A deploy script gated that way prints \`1 fail\` and carries on to upload and restart. Use
\`set -o pipefail\`, or capture the status. \`set -e\` alone does not cover it — the pipeline
succeeded, as far as the shell is concerned.
`.trim(),
};

/** Everything that could be installed, before the project narrows it. */
export const SKILLS: Skill[] = [SCHEMA_SKILL, RELEASE_SKILL];

/** The skills that apply to a project with these packages and this shape. */
export function selectSkills(
  packages: readonly string[],
  shape: ProjectShape | undefined,
  all: readonly Skill[] = SKILLS,
): Skill[] {
  const installed = new Set(packages);
  return all.filter(
    (skill) =>
      (skill.requires ?? []).every((pkg) => installed.has(pkg)) &&
      skill.body(shape).trim().length > 0,
  );
}

/** One `SKILL.md`: frontmatter, the marker, then the body. */
export function renderSkill(skill: Skill, shape: ProjectShape | undefined): string {
  return [
    "---",
    `name: ${skill.name}`,
    // Quoted: descriptions contain commas and colons, which unquoted YAML reads
    // as structure.
    `description: ${JSON.stringify(skill.description)}`,
    "---",
    "",
    SKILL_MARKER,
    "",
    skill.body(shape),
    "",
  ].join("\n");
}

/**
 * Where a skill directory goes.
 *
 * `.agents/skills` is the cross-client path; `.claude/skills` is read by Claude
 * Code, and some clients scan it too. Written to both when that agent is present,
 * because a skill in the wrong directory is not a degraded skill — it is an
 * inert file that looks installed.
 */
export function skillPaths(name: string, agents: readonly string[]): string[] {
  const paths = [`.agents/skills/${name}/SKILL.md`];
  if (agents.includes("Claude Code")) paths.push(`.claude/skills/${name}/SKILL.md`);
  return paths;
}
