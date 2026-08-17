import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { AuthMiddleware } from "zerotal/auth";
import type { Project } from "@app/models/Project.ts";
import { Issue, ISSUE_STATUSES } from "@app/models/Issue.ts";
import { ReorderBoardRequest } from "@app/requests/ReorderBoardRequest.ts";

export const middleware = [AuthMiddleware];

/** Sparse, so a later insert between two cards need not renumber the column. */
const STEP = 10;

/**
 * GET /projects/:project/board — feature 9.
 *
 * One query for every issue in the project, grouped in memory. Grouping here
 * rather than five status-scoped queries is the difference between one round
 * trip and five, and the board is the page where that is most visible in a
 * trace.
 */
export const GET = async (http: HttpContext) => {
  const project = http.params.project as unknown as Project;

  const issues = await Issue.query()
    .where("project_id", project.id)
    .with("assignee")
    .orderBy("position", "asc")
    .orderBy("id", "asc")
    .get();

  const columns = ISSUE_STATUSES.map((status) => ({
    status,
    issues: issues
      .filter((issue) => issue.status === status)
      .map((issue) => ({
        id: issue.id,
        title: issue.title,
        priority: issue.priority,
        assignee: issue.assignee ? { name: issue.assignee.name } : null,
      })),
  }));

  return Inertia.render("projects/board", {
    project: { name: project.name, slug: project.slug },
    columns,
    statuses: ISSUE_STATUSES,
  });
};

/**
 * POST /projects/:project/board — persist a column's order after a drag.
 *
 * The whole destination column arrives, so this is a rewrite rather than a
 * delta: replaying the same request lands on the same board.
 *
 * `whereIn` scoped to the project is the security boundary. Without it, a
 * request could name an id from someone else's project and this would happily
 * move it — the ids come from a request body, and a body is not evidence of
 * ownership. Anything not in the project is silently absent from the update
 * rather than reported, which tells a prober nothing about what exists.
 */
export async function POST(http: HttpContext): Promise<void> {
  const project = http.params.project as unknown as Project;
  const { status, issueIds } = await ReorderBoardRequest.validate();

  if (issueIds.length > 0) {
    const owned = await Issue.query()
      .where("project_id", project.id)
      .whereIn("id", issueIds)
      .get();
    const ownedIds = new Set(owned.map((issue) => issue.id));

    // Ordered by the client's array, filtered to what this project actually has.
    let position = 0;
    for (const id of issueIds) {
      if (!ownedIds.has(id)) continue;
      position += STEP;
      await Issue.query().where("id", id).update({ status, position });
    }
  }

  // No flash. A drag is its own confirmation — the card is where it was
  // dropped — and a toast for every reorder is noise.
  http.redirect(`/projects/${project.slug}/board`, 303);
}
