import type { WithLoaded } from "zerotal/orm";
import type { Issue, IssuePriority, IssueSort, IssueStatus } from "@app/models/Issue.ts";

/**
 * How an issue list is filtered, sorted and paged.
 *
 * The *shape* of the query string, shared by the three cookbook builds and by
 * the behaviour suite, so "high-priority open issues, page 2" is the same set of
 * numbers everywhere. The querying itself lives on the model as scopes — see
 * `Issue.search`, `Issue.withStatus`, `Issue.sorted`.
 */
export interface IssueFilters {
  q: string;
  status: IssueStatus | null;
  priority: IssuePriority | null;
  assignee: number | null;
  sort: IssueSort;
  page: number;
}

export function noFilters(): IssueFilters {
  return { q: "", status: null, priority: null, assignee: null, sort: "newest", page: 1 };
}

/** Whether anything is actually narrowing the list — drives the "clear" affordance. */
export function filtersActive(filters: IssueFilters): boolean {
  return Boolean(filters.q || filters.status || filters.priority || filters.assignee);
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
    createdAt: issue.createdAt?.toISOString?.() ?? null,
    dueAt: issue.dueAt?.toISOString?.() ?? null,
  };
}
