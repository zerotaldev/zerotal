import type { WithLoaded } from "zerotal/orm";
import { Issue, type IssuePriority, type IssueStatus } from "@app/models/Issue.ts";

/**
 * How an issue list is filtered, sorted and paged.
 *
 * One shape, shared by the three cookbook builds and by the behaviour suite, so
 * "high-priority open issues, page 2" is the same set of numbers everywhere. The
 * query string is the only source — see the route that parses it.
 */
export interface IssueFilters {
  q: string;
  status: IssueStatus | null;
  priority: IssuePriority | null;
  assignee: number | null;
  sort: "newest" | "oldest" | "priority" | "title";
  page: number;
}

export function noFilters(): IssueFilters {
  return { q: "", status: null, priority: null, assignee: null, sort: "newest", page: 1 };
}

/** Whether anything is actually narrowing the list — drives the "clear" affordance. */
export function filtersActive(filters: IssueFilters): boolean {
  return Boolean(filters.q || filters.status || filters.priority || filters.assignee);
}

/**
 * Priority in urgency order rather than alphabetical.
 *
 * SQLite has no enum, so `ORDER BY priority` would sort `high, low, medium,
 * urgent` — which reads as sorted and is not. The CASE makes the intended order
 * explicit and travels with the query rather than being re-derived per build.
 */
const PRIORITY_RANK = `CASE priority
  WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;

/**
 * The list query, eager-loading everything a row renders.
 *
 * `with()` is load-bearing: a row shows its author, its assignee and its labels,
 * and ten rows without this is thirty-one queries. The seed has eighteen issues
 * on one project so that shows up in a trace rather than staying theoretical —
 * and the DevTools N+1 warning is a gate in the behaviour suite.
 */
export function issueListQuery(projectId: number, filters: IssueFilters) {
  // Chained rather than `with([...])`: only the single-relation overload narrows
  // the row type, which is what makes `issueRow` below prove it was eager-loaded
  // instead of trusting a comment.
  let query = Issue.query()
    .where("project_id", projectId)
    .with("author")
    .with("assignee")
    .with("labels");

  if (filters.q) {
    // Title and body both — someone searching "telemetry" means the word, not
    // the heading. Escaped for LIKE so a literal % cannot widen the match.
    const term = `%${filters.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    query = query.where((sub) => sub.where("title", "like", term).orWhere("body", "like", term));
  }

  if (filters.status) query = query.where("status", filters.status);
  if (filters.priority) query = query.where("priority", filters.priority);
  if (filters.assignee) query = query.where("assignee_id", filters.assignee);

  switch (filters.sort) {
    case "oldest":
      return query.orderBy("created_at", "asc");
    case "title":
      return query.orderBy("title", "asc");
    case "priority":
      return query.orderByRaw(`${PRIORITY_RANK} asc`).orderBy("created_at", "desc");
    default:
      return query.orderBy("created_at", "desc");
  }
}

/** An issue with everything a list row reads already loaded. */
export type IssueRowModel = WithLoaded<Issue, "author" | "assignee" | "labels">;

/**
 * One issue as the list renders it — the same fields in all three builds.
 *
 * Takes the *narrowed* type on purpose. `BelongsTo<User>` is a phantom until
 * `.with("author")` resolves it, so a caller that forgot to eager-load cannot
 * reach this function at all — the N+1 is a compile error rather than a warning
 * in a trace nobody opened.
 */
export function issueRow(issue: IssueRowModel) {
  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    author: issue.author ? { id: issue.author.id, name: issue.author.name } : null,
    assignee: issue.assignee ? { id: issue.assignee.id, name: issue.assignee.name } : null,
    labels: (issue.labels ?? []).map((label) => ({ name: label.name, colour: label.colour })),
    commentCount: 0,
    createdAt: issue.createdAt?.toISOString?.() ?? null,
    dueAt: issue.dueAt?.toISOString?.() ?? null,
  };
}
