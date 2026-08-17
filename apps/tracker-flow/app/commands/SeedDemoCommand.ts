import { Command } from "zerotal";
import { DB } from "zerotal/orm";
import { User } from "@app/models/User.ts";
import { Project } from "@app/models/Project.ts";
import { Issue, ISSUE_PRIORITIES, ISSUE_STATUSES } from "@app/models/Issue.ts";
import { Label } from "@app/models/Label.ts";

/**
 * Bulk demo data, for looking at pages that only misbehave when they are full.
 *
 * Separate from `DatabaseSeeder` rather than added to it, for two reasons. The
 * shared seeder is the *cookbook's* fixture — its own docblock says the three
 * apps share it and what one shows on `/projects` the others must show — so
 * growing it to a hundred projects would silently change the other two builds.
 * And this is **additive**: it creates rows and truncates nothing, so a dev
 * database somebody is already signed into and looking at survives running it.
 *
 * ```
 * bun zt seed:demo --project=apollo --issues=100   # fill one existing project
 * bun zt seed:demo                                 # 100 projects, one of them deep
 * bun zt seed:demo --projects=20 --issues=500
 * bun zt seed:demo --fresh                         # remove previous demo rows first
 * ```
 */
export class SeedDemoCommand extends Command {
  static commandName = "seed:demo";
  static description = "Add bulk demo projects and issues (additive; --fresh replaces them)";

  static flags = [
    { name: "projects", type: "number" as const, default: 100 },
    /** Issues in the one deep project — the page infinite scroll is actually on. */
    { name: "issues", type: "number" as const, default: 250 },
    /**
     * Fill an existing project by slug instead of creating any.
     *
     * The common case is "make this page long enough to look at", and that page
     * is usually one you already have open.
     */
    { name: "project", type: "string" as const, default: "" },
    { name: "fresh", type: "boolean" as const, default: false },
  ];

  /** Every generated project's slug starts with this, so `--fresh` can find them. */
  private static readonly PREFIX = "demo-";

  /** Marks an issue body this command wrote, so `--fresh` can find it again. */
  private static readonly MARKER = "Generated for scrolling.";

  async run(): Promise<void> {
    const projectCount = Number(this.flags["projects"] ?? 100);
    const issueCount = Number(this.flags["issues"] ?? 250);

    const owners = await User.query().orderBy("id").get();
    if (owners.length === 0) {
      this.error("No users to own the projects. Run `bun zt db:seed` first.");
      return;
    }
    const labels = await Label.query().get();

    // `--project=<slug>` fills something that already exists and creates nothing.
    // It runs before `--fresh` on purpose: the target is a real project, not a
    // demo one, and nothing here should be able to delete it.
    const target = String(this.flags["project"] ?? "");
    if (target) {
      const project = await Project.query().where("slug", target).first();
      if (!project) {
        this.error(`No project with slug "${target}".`);
        return;
      }
      await DB.transaction(async () => {
        if (this.flags["fresh"]) {
          // Only rows this command wrote. The body marker is the only thing that
          // distinguishes them — they live in a real project alongside issues
          // somebody may have written by hand, and those must survive.
          // Counted before the delete: `delete()` reports nothing useful back,
          // and "Removed undefined issues" is worse than not saying it.
          const stale = Issue.query()
            .where("project_id", project.id)
            .where("body", "like", `${SeedDemoCommand.MARKER}%`);
          const removed = await stale.count();
          await stale.delete();
          this.info(`Removed ${removed} previously seeded issue(s).`);
        }

        const before = await Issue.query().where("project_id", project.id).count();
        await this.addIssues(project, owners, labels, issueCount, before);
        this.info(
          `Added ${issueCount} issue(s) to /projects/${project.slug} — ` +
            `${before + issueCount} total.`,
        );
      });
      return;
    }

    // One transaction for the lot — the delete included.
    //
    // Several thousand inserts committed one at a time is the difference between
    // a second and a minute on SQLite, because each commit is its own fsync. But
    // the delete belongs inside it for a different reason: with the removal
    // outside, a write that failed partway (SQLITE_BUSY, because a dev server
    // has the file open) left the old projects half-deleted and none of the new
    // ones written — a database in a state neither run intended. Observed, not
    // theorised.
    await DB.transaction(async () => {
      if (this.flags["fresh"]) {
        const stale = await Project.query()
          .where("slug", "like", `${SeedDemoCommand.PREFIX}%`)
          .get();
        for (const project of stale) {
          // Issues first: the rows point at the project, and leaving them would
          // orphan them rather than remove them.
          await Issue.query().where("project_id", project.id).delete();
          await project.delete();
        }
        this.info(`Removed ${stale.length} previous demo project(s).`);
      }

      const deep = await this.makeDeepProject(owners, labels, issueCount);
      await this.makeShallowProjects(owners, projectCount - 1);
      this.info(`Deep project: /projects/${deep.slug} — ${issueCount} issues.`);
    });

    this.info(`Seeded ${projectCount} demo project(s).`);
    this.dim("Infinite scroll lives on a project's issue list, not on /projects.");
  }

  /**
   * The project the issue list is worth opening.
   *
   * Titles are generated but not identical — a list of 250 rows reading
   * "Issue 1, Issue 2" tells you nothing about whether the row layout holds up,
   * and truncation bugs only show on a title long enough to truncate.
   */
  private async makeDeepProject(
    owners: User[],
    labels: Label[],
    issueCount: number,
  ): Promise<Project> {
    const owner = owners[0]!;
    const project = await Project.forceCreate({
      name: "Voyager",
      slug: `${SeedDemoCommand.PREFIX}voyager`,
      description: `Deliberately large — ${issueCount} issues, for scrolling.`,
      ownerId: owner.id,
    });

    await this.addIssues(project, owners, labels, issueCount, 0);
    return project;
  }

  /**
   * Append `count` issues to a project.
   *
   * `offset` is how many it already has, so `position` continues past them
   * rather than colliding — the board orders on that column, and two cards
   * claiming position 10 sort by whatever the database felt like.
   */
  private async addIssues(
    project: Project,
    owners: User[],
    labels: Label[],
    count: number,
    offset: number,
  ): Promise<void> {
    for (let n = 1; n <= count; n++) {
      const i = offset + n;
      const issue = await Issue.forceCreate({
        projectId: project.id,
        authorId: owners[i % owners.length]!.id,
        // Left unassigned three times in four, matching the shared seeder's
        // reasoning: a list where everything has an owner never renders the
        // "Unassigned" column or exercises assignment.
        assigneeId: i % 4 === 0 ? owners[(i + 1) % owners.length]!.id : null,
        title: this.title(i),
        body: `${SeedDemoCommand.MARKER} Row ${i}.`,
        status: ISSUE_STATUSES[i % ISSUE_STATUSES.length]!,
        priority: ISSUE_PRIORITIES[i % ISSUE_PRIORITIES.length]!,
        position: i * 10,
      });

      if (labels.length > 0 && i % 3 === 0) {
        await issue.labels.attach(labels[i % labels.length]!.id);
      }
    }
  }

  /** The rest — enough to fill `/projects`, cheap enough to create quickly. */
  private async makeShallowProjects(owners: User[], count: number): Promise<void> {
    for (let i = 1; i <= count; i++) {
      const name = `${NAMES[i % NAMES.length]} ${i}`;
      const project = await Project.forceCreate({
        name,
        // The slug is derived through the model, so these URLs are built the
        // same way a real one is — and the prefix is what `--fresh` matches on.
        slug: `${SeedDemoCommand.PREFIX}${Project.slugFor(name)}`,
        description: DESCRIPTIONS[i % DESCRIPTIONS.length]!,
        ownerId: owners[i % owners.length]!.id,
      });

      // A handful each, and every fifth one empty — a hundred identically-sized
      // projects would hide both the empty state and the count column.
      if (i % 5 === 0) continue;
      for (let n = 1; n <= (i % 7) + 1; n++) {
        await Issue.forceCreate({
          projectId: project.id,
          authorId: owners[n % owners.length]!.id,
          title: this.title(n),
          body: "",
          status: ISSUE_STATUSES[n % ISSUE_STATUSES.length]!,
          priority: ISSUE_PRIORITIES[n % ISSUE_PRIORITIES.length]!,
          position: n * 10,
        });
      }
    }
  }

  /**
   * A title that varies in shape as well as in wording.
   *
   * No counter in the text. An earlier version appended `(#n)`, which put a
   * second number beside the row's real `#id` — and because the list is
   * newest-first, that counter ran *down* the page while the id ran down too but
   * from a different base. Two disagreeing numbers on one row read as a bug in
   * the list rather than as noise in the fixture.
   */
  private title(n: number): string {
    const subject = SUBJECTS[n % SUBJECTS.length]!;
    const verb = VERBS[(n * 3) % VERBS.length]!;
    const tail = n % 11 === 0 ? " under sustained load with the cache disabled" : "";
    return `${subject} ${verb}${tail}`;
  }
}

const NAMES = ["Voyager", "Pioneer", "Cassini", "Juno", "Kepler", "Hubble", "Magellan", "Galileo"];

const DESCRIPTIONS = [
  "Ground segment and downlink scheduling.",
  "The parts nobody wants to own yet.",
  "Telemetry ingest and replay.",
  "Long-running migrations and their fallout.",
  "Everything that only fails in production.",
];

const SUBJECTS = [
  "Telemetry ingest",
  "The board reorder",
  "Attachment upload",
  "Session renewal",
  "The audit trail",
  "Locale resolution",
  "The rate limiter",
  "Queue retries",
  "Search ranking",
  "The migration runner",
];

const VERBS = [
  "drops frames on reconnect",
  "loses its position after a reload",
  "rejects valid input without a message",
  "records the wrong actor",
  "falls back to English",
  "double-counts preflight requests",
  "leaves a partial write behind",
  "times out before the first byte",
];
