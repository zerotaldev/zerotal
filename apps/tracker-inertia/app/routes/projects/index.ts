import { Inertia } from "@zerotal/inertia";
import { AuthMiddleware } from "zerotal/auth";
import { Project } from "@app/models/Project.ts";

export const middleware = [AuthMiddleware];

/**
 * GET /projects — every project, with the counts the cards show.
 *
 * `withCount` rather than loading each project's issues and calling `.length`:
 * three projects would be four queries, and the seed has one project with
 * eighteen issues precisely so that difference is visible in the DevTools trace.
 */
export const GET = async () => {
  // One correlated subquery for the count rather than loading each project's
  // issues and reading `.length` — the difference between one query and one per
  // project, which this page exists partly to show in a trace.
  //
  // Only the total. An "open" count would need a second, differently-constrained
  // count of the same relation, and both would land on `issuesCount` — so the
  // split lives on the project page, where the status filter already provides it.
  const projects = await Project.query().with("owner").withCount("issues").orderBy("name").get();

  return Inertia.render("projects/index", {
    title: "Projects",
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description ?? null,
      owner: project.owner ? { name: project.owner.name } : null,
      issueCount: Number((project as unknown as { issuesCount?: number }).issuesCount ?? 0),
    })),
  });
};
