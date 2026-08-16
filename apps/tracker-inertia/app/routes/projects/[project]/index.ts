import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { AuthMiddleware } from "zerotal/auth";
import type { Project } from "@app/models/Project.ts";
import { Issue, ISSUE_PRIORITIES, ISSUE_STATUSES } from "@app/models/Issue.ts";
import { User } from "@app/models/User.ts";
import { issueListQuery, issueRow, type IssueFilters } from "@app/support/issues.ts";

export const middleware = [AuthMiddleware];

const PER_PAGE = 10;

/**
 * GET /projects/:project — the issue list, and the page this app is judged on.
 *
 * Every filter lives in the query string and nowhere else. That is not a
 * preference: it is what makes the three cookbook builds comparable. A filtered,
 * sorted, paginated list has exactly one URL, so `view` reloading it, `inertia`
 * partial-reloading it and `flow` patching it must all arrive at the same place —
 * and a link to "high-priority open issues, page 2" is a link, not a session.
 */
export const GET = async (http: HttpContext) => {
  // Model binding resolved this from the slug; `params` is typed as strings
  // because the router cannot know statically which segments are bound.
  const project = http.params.project as unknown as Project;
  const filters = readFilters(http);

  const paginated = await issueListQuery(project.id, filters).paginate(PER_PAGE, filters.page);

  // Assignees for the filter dropdown: only people who actually hold an issue
  // here, so the list cannot offer a filter that returns nothing.
  const assigned = (await Issue.query()
    .where("project_id", project.id)
    .whereNotNull("assignee_id")
    .distinct()
    .pluck("assignee_id")) as unknown as number[];
  const assignees = assigned.length
    ? await User.query().whereIn("id", assigned).orderBy("name").get()
    : [];

  return Inertia.render("projects/show", {
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description ?? null,
    },
    issues: paginated.data.map(issueRow),
    pagination: {
      page: paginated.page,
      perPage: paginated.perPage,
      total: paginated.total,
      lastPage: paginated.lastPage,
      from: paginated.from,
      to: paginated.to,
    },
    filters,
    options: {
      statuses: ISSUE_STATUSES,
      priorities: ISSUE_PRIORITIES,
      assignees: assignees.map((user) => ({ id: user.id, name: user.name })),
    },
  });
};

/**
 * The query string, narrowed to what the list understands.
 *
 * Anything unrecognised is dropped rather than passed through — a status of
 * `?status=' OR 1=1` has to become "no status filter", not a value that reaches
 * a query builder. Shared with the other two builds so a hand-edited URL behaves
 * the same in all three.
 */
function readFilters(http: HttpContext): IssueFilters {
  // `http.query(key)` — a method, not a bag. Reading it as an object returns
  // undefined for every key, which is a filter set that silently never filters:
  // the URL changes, the list does not, and nothing errors.
  const one = <T extends string>(key: string, allowed: readonly T[]): T | null => {
    const value = http.query(key);
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : null;
  };

  const assignee = http.query("assignee");
  const page = Number(http.query("page") ?? 1);

  return {
    q: (http.query("q") ?? "").trim().slice(0, 120),
    status: one("status", ISSUE_STATUSES),
    priority: one("priority", ISSUE_PRIORITIES),
    assignee: assignee && /^\d+$/.test(assignee) ? Number(assignee) : null,
    sort: one("sort", ["newest", "oldest", "priority", "title"] as const) ?? "newest",
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
  };
}
