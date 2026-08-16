import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { AuthMiddleware, Gate } from "zerotal/auth";
import type { Project } from "@app/models/Project.ts";
import { Issue } from "@app/models/Issue.ts";
import { Comment } from "@app/models/Comment.ts";

export const middleware = [AuthMiddleware];

/** GET /projects/:project/issues/:issue — one issue, its labels and its thread. */
export const GET = async (http: HttpContext) => {
  const project = http.params.project as unknown as Project;
  const bound = http.params.issue as unknown as Issue;

  // Re-queried with its relations rather than using the bound instance: route
  // binding resolves the row, not the graph, and reading `issue.author.name`
  // off an unloaded relation is how a detail page becomes four queries.
  const issue = await Issue.query()
    .where("id", bound.id)
    .with("author")
    .with("assignee")
    .with("labels")
    .firstOrFail();

  const comments = await Comment.query()
    .where("issue_id", bound.id)
    .with("author")
    .orderBy("created_at", "asc")
    .get();

  return Inertia.render("issues/show", {
    project: { name: project.name, slug: project.slug },
    issue: {
      id: issue.id,
      title: issue.title,
      body: issue.body ?? "",
      status: issue.status,
      priority: issue.priority,
      author: issue.author ? { id: issue.author.id, name: issue.author.name } : null,
      assignee: issue.assignee ? { id: issue.assignee.id, name: issue.assignee.name } : null,
      labels: (issue.labels ?? []).map((label) => ({ name: label.name, colour: label.colour })),
      createdAt: issue.createdAt?.toISOString?.() ?? null,
      dueAt: issue.dueAt?.toISOString?.() ?? null,
    },
    comments: comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      author: comment.author ? { name: comment.author.name } : null,
      createdAt: comment.createdAt?.toISOString?.() ?? null,
    })),
    // The page hides the edit affordance when this is false. The gate on the
    // route is what actually enforces it — this only stops the UI offering a
    // door that would shut in your face.
    can: { update: Gate.allows("update", issue) },
  });
};
