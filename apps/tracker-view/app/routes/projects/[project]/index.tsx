import { view } from "zerotal";
import type { HttpContext } from "zerotal";
import { Auth, AuthMiddleware } from "zerotal/auth";
import type { Project } from "@app/models/Project.ts";
import { Issue, ISSUE_PRIORITIES, ISSUE_SORTS, ISSUE_STATUSES } from "@app/models/Issue.ts";
import { User } from "@app/models/User.ts";
import { issueRow, type IssueFilters } from "@app/support/issues.ts";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";
import { AppLayout } from "../../../../resources/views/layouts/AppLayout.tsx";
import {
  EmptyState,
  PageHeader,
  PRIORITY_LABEL,
  PriorityBadge,
  SORT_LABEL,
  STATUS_LABEL,
  StatusBadge,
  buttonClass,
} from "../../../../resources/views/components/Ui.tsx";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

const PER_PAGE = 10;

/**
 * GET /projects/:project — the issue list, and the page this app is judged on.
 *
 * Every filter lives in the query string and nowhere else — identical to the
 * Inertia build, because that is what makes the two comparable. What differs is
 * what happens when a filter changes: there, a debounced partial reload patches
 * two props; here the form submits and the page comes back. Same URL, same
 * results, and this one works with JavaScript off.
 *
 * The filter bar is a `GET` form, so the browser builds the query string itself.
 * That is the entire mechanism, and it is why there is no script on this page.
 */
export const GET = async (http: HttpContext) => {
  const project = http.params.project as unknown as Project;
  const filters = readFilters(http);

  const paginated = await Issue.query()
    .where("project_id", project.id)
    .with("author")
    .with("assignee")
    .with("labels")
    .withScopes((s) => {
      s.search(filters.q);
      s.withStatus(filters.status);
      s.withPriority(filters.priority);
      s.assignedTo(filters.assignee);
      s.sorted(filters.sort);
    })
    .paginate(PER_PAGE, filters.page);

  const assigned = (await Issue.query()
    .where("project_id", project.id)
    .whereNotNull("assignee_id")
    .distinct()
    .pluck("assignee_id")) as unknown as number[];
  const assignees = assigned.length
    ? await User.query().whereIn("id", assigned).orderBy("name").get()
    : [];

  const issues = paginated.data.map(issueRow);
  const active = Boolean(filters.q || filters.status || filters.priority || filters.assignee);
  const user = Auth.userOrNull();
  const base = route("projects.show", { project: project.slug });
  const select = "h-9 rounded-md border border-input bg-card px-2 text-sm text-foreground";

  /** Keep every filter when only the page changes. */
  const pageHref = (page: number): string => {
    const q = new URLSearchParams();
    if (filters.q) q.set("q", filters.q);
    if (filters.status) q.set("status", filters.status);
    if (filters.priority) q.set("priority", filters.priority);
    if (filters.assignee) q.set("assignee", String(filters.assignee));
    if (filters.sort !== "newest") q.set("sort", filters.sort);
    if (page > 1) q.set("page", String(page));
    const query = q.toString();
    return query ? `${base}?${query}` : base;
  };

  view(
    <AppLayout
      title={project.name}
      active="projects"
      user={user ? { name: user.name, email: user.email } : null}
      flash={{
        success: http.session?.get<string>("success") ?? null,
        error: http.session?.get<string>("error") ?? null,
      }}
    >
      <div class="space-y-6">
        <div>
          <nav aria-label={__("Breadcrumb")} class="mb-2 text-xs text-muted-foreground">
            <a href={route("projects")} class="hover:text-foreground">
              {__("Projects")}
            </a>
            <span aria-hidden="true" class="px-1.5">
              /
            </span>
            <span class="text-foreground">{project.name}</span>
          </nav>

          <PageHeader
            title={project.name}
            description={project.description ?? undefined}
            actions={
              <>
                <a href={`${base}/board`} class={buttonClass("secondary")}>
                  {__("Board")}
                </a>
                <a href={`${base}/issues/new`} class={buttonClass("primary")}>
                  {__("New issue")}
                </a>
              </>
            }
          />
        </div>

        <div class="rounded-xl border border-border bg-card">
          {/* A GET form: the browser writes the query string, so the URL stays the
              single source of truth with no script needed to keep it there. */}
          <form
            method="get"
            action={base}
            class="flex flex-wrap items-center gap-2 border-b border-border p-3"
          >
            <label class="sr-only" for="q">
              {__("Search issues")}
            </label>
            <input
              id="q"
              name="q"
              type="search"
              value={filters.q}
              placeholder={__("Search issues…")}
              class={`${select} min-w-0 flex-1 sm:min-w-64`}
            />

            <select name="status" aria-label={__("Status")} class={select}>
              <option value="">{__("All statuses")}</option>
              {ISSUE_STATUSES.map((s) => (
                <option value={s} selected={filters.status === s}>
                  {__(STATUS_LABEL[s] ?? s)}
                </option>
              ))}
            </select>

            <select name="priority" aria-label={__("Priority")} class={select}>
              <option value="">{__("All priorities")}</option>
              {ISSUE_PRIORITIES.map((p) => (
                <option value={p} selected={filters.priority === p}>
                  {__(PRIORITY_LABEL[p] ?? p)}
                </option>
              ))}
            </select>

            <select name="assignee" aria-label={__("Assignee")} class={select}>
              <option value="">{__("Anyone")}</option>
              {assignees.map((person) => (
                <option value={String(person.id)} selected={filters.assignee === person.id}>
                  {person.name}
                </option>
              ))}
            </select>

            <select name="sort" aria-label={__("Sort")} class={select}>
              {ISSUE_SORTS.map((s) => (
                <option value={s} selected={filters.sort === s}>
                  {__(SORT_LABEL[s] ?? s)}
                </option>
              ))}
            </select>

            {/* The submit is what the Inertia build replaces with a debounce.
                Without a script there has to be one — and it is also the version
                someone navigating by keyboard alone can actually use. */}
            <button type="submit" class={buttonClass("secondary")}>
              {__("Apply")}
            </button>

            {active ? (
              <a
                href={base}
                class="h-9 rounded-md px-2.5 text-sm leading-9 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {__("Clear")}
              </a>
            ) : null}
          </form>

          {issues.length === 0 ? (
            active ? (
              <EmptyState
                title={__("No issues match these filters")}
                description={__("Nothing here fits the current search and filters. Clearing them will show the whole project.")}
                action={
                  <a href={base} class="text-sm font-medium text-primary hover:underline">
                    {__("Clear filters")}
                  </a>
                }
              />
            ) : (
              <EmptyState
                title={__("No issues yet")}
                description={__("This project has nothing tracked against it. The first issue is usually the one you just thought of.")}
                action={
                  <a href={`${base}/issues/new`} class={buttonClass("primary")}>
                    {__("Create issue")}
                  </a>
                }
              />
            )
          ) : (
            <>
              <ul class="divide-y divide-border">
                {issues.map((issue) => (
                  <li>
                    <a
                      href={`${base}/issues/${issue.id}`}
                      class="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
                    >
                      <span class="w-11 shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums">
                        #{String(issue.id)}
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-medium text-foreground">
                          {issue.title}
                        </span>
                        <span class="mt-1 block text-xs text-muted-foreground">
                          {issue.author?.name ?? ""}
                        </span>
                      </span>
                      <span class="hidden shrink-0 items-center gap-2 sm:flex">
                        <PriorityBadge
                          priority={issue.priority}
                          label={__(PRIORITY_LABEL[issue.priority] ?? issue.priority)}
                        />
                        <StatusBadge status={issue.status} label={__(STATUS_LABEL[issue.status] ?? issue.status)} />
                      </span>
                      <span class="hidden w-28 shrink-0 truncate text-right text-xs text-muted-foreground lg:block">
                        {issue.assignee?.name ?? __("Unassigned")}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>

              {/* Links, not infinite scroll. Appending on scroll needs a listener;
                  a link does not — and a link is what a reader can bookmark, share
                  and reach with a keyboard. That divergence is the recipe. */}
              {paginated.lastPage > 1 ? (
                <nav
                  aria-label={__("Pagination")}
                  class="flex items-center justify-between gap-4 border-t border-border px-4 py-3"
                >
                  <p class="text-xs text-muted-foreground tabular-nums">
                    {String(paginated.from ?? 0)}–{String(paginated.to ?? 0)} /{" "}
                    {String(paginated.total)}
                  </p>
                  <div class="flex items-center gap-1">
                    {paginated.page > 1 ? (
                      <a
                        href={pageHref(paginated.page - 1)}
                        rel="prev"
                        class="rounded-md px-2 py-1 text-sm hover:bg-muted"
                      >
                        {__("Previous")}
                      </a>
                    ) : null}
                    {paginated.page < paginated.lastPage ? (
                      <a
                        href={pageHref(paginated.page + 1)}
                        rel="next"
                        class="rounded-md px-2 py-1 text-sm hover:bg-muted"
                      >
                        {__("Next")}
                      </a>
                    ) : null}
                  </div>
                </nav>
              ) : null}
            </>
          )}
        </div>
      </div>
    </AppLayout>,
  );
};

/**
 * The query string, narrowed to what the list understands.
 *
 * Deliberately identical to the Inertia build's copy: a hand-edited URL has to
 * behave the same in both, and anything unrecognised is dropped rather than
 * passed through to a query builder.
 */
function readFilters(http: HttpContext): IssueFilters {
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
    sort: one("sort", ISSUE_SORTS) ?? "newest",
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
  };
}
