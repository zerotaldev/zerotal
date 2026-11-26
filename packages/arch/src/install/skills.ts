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

    // Emphasis is written `_like this_`, not `*like this*`. These files land in
    // somebody's repository and are checked by their formatter, and a generator
    // whose output fails the project's own format check is one nobody can run in
    // CI.
    const owner =
      source === "migrations"
        ? "**Migrations own the schema in this app.**"
        : source === "models"
          ? "**The models own the schema in this app** (`database.synchronize` is on)."
          : source === "both"
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
import { Migration, Schema } from "${shape?.bundle ? "zerotal/orm" : "@zerotal/orm"}";

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

/** Where a column lands, worded for the step that needs one. */
function schemaStep(shape: ProjectShape | undefined): string {
  switch (shape?.schemaSource) {
    case "migrations":
      return "Migrations own the schema here, so the table needs one: `bun zt make:model <Name> -m`.";
    case "models":
      return "The models own the schema here (`database.synchronize`), so `bun zt make:model <Name>` is the whole schema step.";
    default:
      return "Run `doctor` and read which owns the schema here — models or migrations — before deciding whether `make:model` needs `-m`.";
  }
}

const RESOURCE_SKILL: Skill = {
  name: "zerotal-crud-resource",
  description:
    "Add a resource users create, list, edit and delete in a Zerotal app — model, schema, " +
    "factory, policy, validation, routes, pages and tests, in the order that keeps each step checkable.",
  requires: ["@zerotal/orm"],
  body: (shape) =>
    `
# Adding a resource

If this app still has the starter's example \`Project\` resource, it is the pattern to copy:
\`app/models/Project.ts\`, its migration and factory, \`app/policies/ProjectPolicy.ts\`,
\`app/requests/ProjectRequest.ts\`, the routes under \`projects/\`, its pages and
\`tests/projects.test.ts\`. Read those before writing anything — they answer most of the
questions below the way this app already answers them.

## Sequence

1. **Model and schema.** ${schemaStep(shape)} Make the model's \`table(...)\` name and the
   migration's table name agree; nothing checks it until the first query.
2. **Factory.** \`bun zt make:factory <Name>\` — the model's name; it writes \`<Name>Factory\`. Tests and seeders both need one.
3. **Policy.** \`bun zt make:policy <Name>Policy --model <Name>\`. Policies in
   \`app/policies/\` are discovered; there is nothing to register.
4. **Validation.** \`bun zt make:request <Name>Request\`, one request for create and update
   unless the rules really differ.
5. **Routes and pages**, in whichever style this app already uses — look at \`routes/\` and
   \`app/routes/\` before adding either. Then \`bun zt route:types\`.
6. **Tests**, then \`bun zt test\` and \`bun zt doctor\`.

## Traps

- **Set the owner in code, never from the form.** \`fill()\` the validated fields, then
  assign \`userId\` (or \`tenantId\`) from \`Auth.user()\`. A form field named \`user_id\` is an
  invitation to write someone else's record.
- **Load records through their owner.** A route with \`:id\` in it is reachable with every id.
  Either scope the query to the signed-in user or check the policy on _every_ action that
  loads one — show, edit, update and delete, not just the ones with a button.
- **Test the negative.** One test where a second user asks for the first user's record and
  is refused. It is the test that catches the trap above, and the one nobody writes.
- **Paginate the index.** \`.paginate(perPage, page)\` from the start; an unbounded list is a
  slow page the day a real user has real data.

Read signatures with \`api_surface\` (\`@zerotal/orm\`, \`@zerotal/validator\`) rather than
from memory.
`.trim(),
};

const TEST_SKILL: Skill = {
  name: "zerotal-feature-tests",
  description:
    "Write a feature test for a Zerotal app — booting the real app once per file, a fresh " +
    "database per test, signing in, faking mail and notifications, and asserting what must not happen.",
  requires: ["@zerotal/testing"],
  body: (shape) =>
    `
# Writing a feature test

If \`tests/support.ts\` exists, use its \`bootApp()\` rather than writing another: it already
sets the key and database a test needs. The tests beside it show the house style.

## Shape

\`\`\`ts
import { afterAll, beforeAll, beforeEach, describe, test } from "bun:test";
import { createTestApp, refreshDatabase, type TestApp } from "${shape?.bundle === false ? "@zerotal/testing" : "zerotal/testing"}";

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp(() => import("../bootstrap/app.ts").then((m) => m.default));
});
afterAll(() => app.close());
beforeEach(() => app.actingAsGuest());

describe("invoices", () => {
  refreshDatabase();

  test("a guest is sent to sign in", async () => {
    (await app.get("/invoices")).assertRedirect("/login");
  });
});
\`\`\`

## Traps

- **One app per file, not per test.** Booting is the slow part. \`refreshDatabase()\` gives
  each test a clean database without paying for it again.
- **The schema under test must be the one that ships.** ${
      shape?.schemaSource === "migrations"
        ? "Migrations own the schema here, so call `migrateDatabase()` after booting — a test database built any other way can pass against columns production never gets."
        : "If migrations own the schema, call `migrateDatabase()` after booting; a test database built any other way can pass against columns production never gets."
    }
- **Sign-in state leaks between tests** unless each one resets it. \`app.actingAs(user)\` for
  one signed-in request, \`app.actingAsGuest()\` in \`beforeEach\`. A flow that spans requests
  — sign in, then a two-factor code — needs the cookies kept between them.
- **Fake what leaves the process.** \`NotificationFake.install()\` (restore it in
  \`afterEach\`) records notifications instead of sending them; assert on what was sent, not on
  an inbox the fake never fills.
- **Assert the refusal.** For every rule — owner only, admin only, tenant only — one test
  where the wrong user is refused, with \`assertForbidden()\` or \`assertNotFound()\` as the app
  answers it. Assert counts, not the absence of one row: a query that returns everything
  except the row you looked for passes the second and fails the first.
- **Run with \`bun zt test\`**, and read its exit status directly — \`| tail\` replaces it with
  \`tail\`'s.

\`api_surface @zerotal/testing\` has every assertion on a response.
`.trim(),
};

const TENANCY_SKILL: Skill = {
  name: "zerotal-tenancy",
  description:
    "Make a Zerotal app multi-tenant, or make a model tenant-owned — installing and configuring " +
    "@zerotal/tenancy, scoping models, jobs that run outside a request, and the isolation test.",
  requires: ["@zerotal/orm"],
  body: () =>
    `
# Adding tenancy

Do not build tenant scoping by hand. \`@zerotal/tenancy\` resolves the tenant, scopes queries
and writes, owns the \`tenants\` and \`tenant_members\` tables, and scopes cache and storage.
If \`app_info\` does not list it, ask before \`bun add @zerotal/tenancy\`.

## Sequence

1. Read the \`tenancy\` page (\`search_docs "tenancy"\`) and pick a strategy: one database with
   a \`tenant_id\` column per table (the default), or a database per tenant.
2. \`config/tenancy.ts\` with \`TenancyConfig({ resolvers: [...] })\`; register
   \`TenancyProvider.withConfig(tenancyConfig)\` in \`bootstrap/providers.ts\`. The provider
   installs the resolving middleware itself — do not register it again.
3. Compose \`Tenantable\` onto each tenant-owned model: \`Model.using(Tenantable)\`, alongside
   any mixins it already has. Add the \`tenant_id\` column the way this app adds any column
   (see the \`zerotal-schema-changes\` skill).
4. Put \`EnsureTenancyMiddleware\` on the routes that make no sense without a tenant.
5. Write the isolation test, then \`bun zt test\` and \`bun zt doctor\`.

## Traps

- **Outside a tenant boundary a tenant-owned query matches nothing.** It fails closed: no
  error, just an empty result. Jobs, commands, schedules and test setup run outside a
  request: wrap their work in \`TenantContext.run(tenant, ...)\`, one tenant at a time.
- **Factories skip model hooks**, including the one that fills the tenant column. A factory
  for a tenant-owned model needs \`.dispatchEvents()\`, and its rows must be created inside a
  tenant boundary.
- **Never take the tenant id from the request body or query string.** It comes from the
  resolved context; a model's \`tenantId\` is filled on create for you.
- **Bypassing is explicit.** \`withoutTenancy()\` on a query is for an admin screen that
  genuinely spans tenants, and nothing else.
- **Cache keys and file paths cross tenants** unless you use \`tenantCache()\` and
  \`tenantDisk()\`.
- **The test that matters is a negative.** Create a row as one tenant, query as another,
  and assert the count is zero.
`.trim(),
};

const NOTIFICATION_SKILL: Skill = {
  name: "zerotal-queued-notifications",
  description:
    "Send an email or other notification from a Zerotal app in the background — the class, " +
    "queueing it, what survives serialisation, retries, and faking it in tests.",
  requires: ["@zerotal/notifications"],
  body: () =>
    `
# Sending a notification in the background

## Sequence

1. \`bun zt make:notification <Name>\` — classes in \`app/notifications/\` are found
   automatically, including by the queue worker that rebuilds them.
2. Name the channels in \`channels()\` and write one method per channel — \`toMail()\`,
   \`toDatabase()\` and the rest. The recipient model composes \`Notifiable\`.
3. Send with \`user.notifyLater(new <Name>(...))\` or \`Notify.queue(user, ...)\` from a request.
   \`notify()\` sends inline and is not retried.
4. Test with \`NotificationFake\` and \`assertQueued\`.

## Traps

- **A queued notification is rebuilt from JSON.** Store ids and plain values in it, not model
  instances; a model needs \`payload()\` and \`fromPayload()\` to cross. The recipient arrives
  as a snapshot — read its fields, not its methods.
- **A class outside \`app/notifications/\`** must call \`NotificationRegistry.register()\`, or the
  worker cannot rebuild it.
- **Something has to run the queue.** With \`QueueProvider\` registered in
  \`bootstrap/providers.ts\` and a \`config/queue.ts\`, \`bun zt dev\` runs a worker locally.
  In production a persistent driver needs \`bun zt queue:work\` running, or queued mail is
  never sent.
- **Failures wait in the failed jobs** after their retries; \`bun zt queue:retry\` sends them
  again.
- **The fake records, it does not deliver.** Database-channel rows are not written under it.
`.trim(),
};

/** Everything that could be installed, before the project narrows it. */
export const SKILLS: Skill[] = [
  SCHEMA_SKILL,
  RELEASE_SKILL,
  RESOURCE_SKILL,
  TEST_SKILL,
  TENANCY_SKILL,
  NOTIFICATION_SKILL,
];

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
