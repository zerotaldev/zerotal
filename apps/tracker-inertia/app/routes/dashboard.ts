import { Inertia } from "@zerotal/inertia";
import { AuthMiddleware } from "zerotal/auth";
import { Cache } from "@zerotal/cache";
import { Issue, ISSUE_PRIORITIES, ISSUE_STATUSES } from "@app/models/Issue.ts";
import { Project } from "@app/models/Project.ts";

export const middleware = [AuthMiddleware];

/** Short. Counts that lag are worse than counts that cost a query. */
const TTL_SECONDS = 30;

/**
 * GET /dashboard — feature 10.
 *
 * Every number here is a **`GROUP BY` in the database**, not a table loaded into
 * memory and counted. That distinction is the feature: the obvious version of
 * this page is `(await Issue.all()).filter(…).length` per tile, which is one
 * full table scan per number and looks identical until the table is large.
 *
 * The whole set is cached under one key. Caching each tile separately would
 * mean six keys expiring at six moments, so a refresh could show a status
 * breakdown that disagrees with the total beside it — a dashboard that
 * contradicts itself is worse than one that is thirty seconds old.
 */
export const GET = async () => {
  const stats = await Cache.remember("dashboard:stats", TTL_SECONDS, async () => {
    // One row per status, one per priority — two queries, not ten.
    const byStatus = await Issue.query()
      .selectRaw("status, COUNT(*) as total")
      .groupBy("status")
      .get();

    const byPriority = await Issue.query()
      .selectRaw("priority, COUNT(*) as total")
      .groupBy("priority")
      .get();

    // `withCount` rather than loading each project's issues — the same choice
    // the projects index makes, and for the same reason.
    const projects = await Project.query().withCount("issues").orderBy("name").get();

    const total = await Issue.query().count();
    const unassigned = await Issue.query().whereNull("assignee_id").count();

    const tally = (rows: unknown[], key: string): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const row of rows) {
        const record = row as Record<string, unknown>;
        out[String(record[key])] = Number(record["total"] ?? 0);
      }
      return out;
    };

    const statusCounts = tally(byStatus, "status");
    const priorityCounts = tally(byPriority, "priority");

    return {
      total,
      unassigned,
      // Zero-filled from the canonical lists, so a status nobody has used still
      // renders its tile. A missing row means none, not "no such status".
      byStatus: ISSUE_STATUSES.map((status) => ({
        status,
        total: statusCounts[status] ?? 0,
      })),
      byPriority: ISSUE_PRIORITIES.map((priority) => ({
        priority,
        total: priorityCounts[priority] ?? 0,
      })),
      projects: projects.map((project) => ({
        name: project.name,
        slug: project.slug,
        issueCount: Number((project as unknown as { issuesCount?: number }).issuesCount ?? 0),
      })),
    };
  });

  return Inertia.render("dashboard", { title: "Dashboard", stats });
};
