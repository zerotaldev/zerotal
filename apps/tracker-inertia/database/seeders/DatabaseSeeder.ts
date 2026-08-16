import { deployEnv, env } from "zerotal";
import { Seeder } from "zerotal/orm";
import { Hash } from "zerotal/auth";
import { User } from "@app/models/User.ts";
import { Project } from "@app/models/Project.ts";
import { Issue, ISSUE_PRIORITIES, ISSUE_STATUSES } from "@app/models/Issue.ts";
import { Label } from "@app/models/Label.ts";
import { Comment } from "@app/models/Comment.ts";

/**
 * Enough data to exercise the pages, and deliberately lopsided.
 *
 * A seed where every project has ten issues and every issue has two comments
 * tests nothing: pagination never spills, empty states never render, and an N+1
 * on the assignee lookup costs the same as a single query. So one project is
 * large enough to page, one is empty, and most issues are unassigned.
 *
 * The three cookbook apps share this file, so what one shows on `/projects` is
 * what the others must show.
 */
const INSECURE_DEFAULT = "password";

// `forceCreate` throughout, not `create`. Every model here guards its attributes,
// and rightly so — `ownerId` and `authorId` must never be settable from a request
// body. A seeder is trusted input by definition, which is the case the guard
// documents an escape hatch for.

function seedPassword(): string {
  const password = env("SEED_PASSWORD", "");
  if (password) return password;
  // `deployEnv()`, not `env("APP_ENV")`. The framework overwrites APP_ENV with the
  // *runtime mode* at boot — inside a console command it reads "console", not the
  // "development" this project's .env sets. A guard written the obvious way is a
  // guard that never fires, which for a seeder is the wrong direction to fail in.
  const where = deployEnv();
  if (where !== "local" && where !== "development") {
    throw new Error(
      "Refusing to seed accounts with the default password outside local development. " +
        "Set SEED_PASSWORD, or do not seed here.",
    );
  }
  return INSECURE_DEFAULT;
}

const PEOPLE = [
  { name: "Ada Lovelace", email: "ada@example.com" },
  { name: "Grace Hopper", email: "grace@example.com" },
  { name: "Linus Torvalds", email: "linus@example.com" },
];

const LABELS = [
  { name: "backend", colour: "sky" },
  { name: "frontend", colour: "violet" },
  { name: "telemetry", colour: "amber" },
  { name: "infra", colour: "emerald" },
  { name: "regression", colour: "rose" },
];

/** Titles that read like real work, so a screenshot of the list is worth taking. */
const APOLLO_ISSUES = [
  "Landing gear telemetry drops every third frame",
  "Retry failed jobs with exponential backoff",
  "Upload handling rejects files over 8MB without a message",
  "Session expires mid-form and loses the draft",
  "Board reorder does not persist across a reload",
  "Search ignores the status filter when a query is present",
  "Dark mode flashes white on first paint",
  "Assignee dropdown lists deactivated accounts",
  "Comment timestamps drift by an hour in BST",
  "Migration runner leaves a partial schema on failure",
  "N+1 on the issue list when labels are eager-loaded",
  "Attachment thumbnails never regenerate",
  "Keyboard focus is lost after closing the dialog",
  "Pagination shows page 3 of 2 on an empty filter",
  "Rate limiter counts preflight requests",
  "Audit log records the actor as null for queued jobs",
  "Locale falls back to English inside a socket action",
  "Due dates render in UTC on the board but local in the list",
];

export default class DatabaseSeeder extends Seeder {
  async run(): Promise<void> {
    const password = await Hash.make(seedPassword());

    const users: User[] = [];
    for (const person of PEOPLE) {
      users.push(await User.forceCreate({ ...person, password }));
    }
    const [ada, grace, linus] = users as [User, User, User];

    const labels: Label[] = [];
    for (const label of LABELS) {
      labels.push(await Label.forceCreate(label));
    }

    const apollo = await Project.forceCreate({
      name: "Apollo",
      slug: "apollo",
      description: "Flight telemetry and ground control.",
      ownerId: ada.id,
    });

    const gemini = await Project.forceCreate({
      name: "Gemini",
      slug: "gemini",
      description: "The parts of Apollo nobody wants to own yet.",
      ownerId: grace.id,
    });

    // Deliberately empty — this is the project that renders the empty state.
    await Project.forceCreate({
      name: "Mercury",
      slug: "mercury",
      description: "Archived. Kept so the empty state has somewhere to live.",
      ownerId: linus.id,
    });

    let position = 0;
    for (const [index, title] of APOLLO_ISSUES.entries()) {
      const status = ISSUE_STATUSES[index % ISSUE_STATUSES.length]!;
      const priority = ISSUE_PRIORITIES[index % ISSUE_PRIORITIES.length]!;
      const issue = await Issue.forceCreate({
        projectId: apollo.id,
        authorId: users[index % users.length]!.id,
        // Most issues are unassigned on purpose: "assign this" is feature 6, and
        // a board where everything already has an owner never exercises it.
        assigneeId: index % 4 === 0 ? users[(index + 1) % users.length]!.id : null,
        title,
        body: `## What happens\n\n${title}.\n\n## Expected\n\nIt does not.`,
        status,
        priority,
        position: (position += 10),
      });

      if (index % 3 === 0) {
        await issue.labels.attach(labels[index % labels.length]!.id);
      }

      if (index % 5 === 0) {
        await Comment.forceCreate({
          issueId: issue.id,
          authorId: grace.id,
          body: "Reproduced on the staging box. Attaching the trace next.",
        });
      }
    }

    await Issue.forceCreate({
      projectId: gemini.id,
      authorId: linus.id,
      title: "Decide whether Gemini survives the quarter",
      body: "Nothing has been merged here in six weeks.",
      status: "backlog",
      priority: "low",
      position: 10,
    });
  }
}
