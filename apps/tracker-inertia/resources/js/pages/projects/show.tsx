import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Head, Link, router } from "@inertiajs/react";
import AppShell from "../../Layouts/AppShell";
import PageHeader from "../../Components/PageHeader";
import EmptyState from "../../Components/EmptyState";
import { type PageMeta } from "../../Components/Pagination";
import { LabelChip, PriorityBadge, StatusBadge } from "../../Components/Badge";
import { Button, ButtonLink } from "../../Components/Button";
import { controlClass } from "../../Components/Field";
import { cn } from "../../lib/cn";

interface IssueRow {
  id: number;
  title: string;
  status: string;
  priority: string;
  author: { id: number; name: string } | null;
  assignee: { id: number; name: string } | null;
  labels: { name: string; colour: string }[];
  createdAt: string | null;
  dueAt: string | null;
}

interface Filters {
  q: string;
  status: string | null;
  priority: string | null;
  assignee: number | null;
  sort: string;
  page: number;
}

interface Props {
  project: { id: number; name: string; slug: string; description: string | null };
  issues: IssueRow[];
  pagination: PageMeta;
  filters: Filters;
  options: {
    statuses: readonly string[];
    priorities: readonly string[];
    assignees: { id: number; name: string }[];
  };
}

/**
 * The issue list — features 2 and 3, and the page the cookbook is judged on.
 *
 * Every control writes to the URL and nothing else. The component holds no
 * filter state of its own beyond the search box's uncommitted keystrokes, so
 * "what am I looking at" is answerable by reading the address bar, and a
 * reload, a back button and a pasted link all land in the same place.
 *
 * Navigation is `preserveState` + `preserveScroll` with `only`, so changing a
 * filter re-fetches the issues and the pagination and leaves the rest of the
 * page — and the caret in the search box — alone.
 */
export default function ProjectShow({ project, issues, pagination, filters, options }: Props) {
  const feed = useIssueFeed(issues, pagination, filters);
  const active =
    Boolean(filters.q) ||
    Boolean(filters.status) ||
    Boolean(filters.priority) ||
    Boolean(filters.assignee);

  return (
    <>
      <Head title={project.name} />

      <div className="space-y-6">
        <div>
          <nav aria-label={__("Breadcrumb")} className="mb-2 text-xs text-muted-foreground">
            <Link href={route("projects")} className="transition-colors hover:text-foreground">
              {__("Projects")}
            </Link>
            <span aria-hidden="true" className="px-1.5">
              /
            </span>
            <span className="text-foreground">{project.name}</span>
          </nav>

          <PageHeader
            title={project.name}
            {...(project.description ? { description: project.description } : {})}
            actions={
              <>
                <ButtonLink
                  href={route("projects.board.show", { project: project.slug })}
                  variant="secondary"
                >
                  {__("Board")}
                </ButtonLink>
                <ButtonLink href={route("projects.issues.new.show", { project: project.slug })}>
                  {__("New issue")}
                </ButtonLink>
              </>
            }
          />
        </div>

        <div className="rounded-xl border border-border bg-card">
          <FilterBar filters={filters} options={options} active={active} />

          {feed.items.length === 0 ? (
            // Two different nothings. Which one decides what the reader should do
            // next, so they do not share a sentence.
            active ? (
              <EmptyState
                title={__("No issues match these filters")}
                description={__("Nothing here fits the current search and filters. Clearing them will show the whole project.")}
                action={
                  <Link
                    href={route("projects.show", { project: project.slug })}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {__("Clear filters")}
                  </Link>
                }
              />
            ) : (
              <EmptyState
                title={__("No issues yet")}
                description={__("This project has nothing tracked against it. The first issue is usually the one you just thought of.")}
                action={
                  <ButtonLink href={route("projects.issues.new.show", { project: project.slug })}>
                    {__("Create issue")}
                  </ButtonLink>
                }
              />
            )
          ) : (
            <>
              <ul className="divide-y divide-border">
                {feed.items.map((issue) => (
                  <li key={issue.id}>
                    <Link
                      href={route("projects.issues.show", {
                        project: project.slug,
                        issue: issue.id,
                      })}
                      className="flex items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-muted/60"
                    >
                      <span className="w-11 shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums">
                        #{issue.id}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {issue.title}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          {issue.author && <span>{issue.author.name}</span>}
                          {issue.labels.map((label) => (
                            <LabelChip key={label.name} {...label} />
                          ))}
                        </span>
                      </span>

                      <span className="hidden shrink-0 items-center gap-2 sm:flex">
                        <PriorityBadge priority={issue.priority} />
                        <StatusBadge status={issue.status} />
                      </span>

                      <span className="hidden w-28 shrink-0 truncate text-right text-xs text-muted-foreground lg:block">
                        {issue.assignee?.name ?? __("Unassigned")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>

              <FeedFooter
                shown={feed.items.length}
                total={pagination.total}
                hasMore={feed.hasMore}
                loading={feed.loading}
                onLoadMore={feed.loadMore}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Search, filters and sort — all of which are URL writes.
 *
 * The search box debounces because every keystroke would otherwise be a request;
 * the selects do not, because a dropdown change is already a deliberate act.
 */
function FilterBar({
  filters,
  options,
  active,
}: {
  filters: Filters;
  options: Props["options"];
  active: boolean;
}) {
  const [q, setQ] = useState(filters.q);
  const first = useRef(true);

  // A filter change resets to page 1: staying on page 3 of a narrower result set
  // is how a list ends up showing "no issues" for a filter that has plenty.
  const go = (next: Partial<Record<string, string>>): void => {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(next)) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    url.searchParams.delete("page");
    router.get(
      `${url.pathname}${url.search}`,
      {},
      {
        preserveState: true,
        preserveScroll: true,
        replace: true,
        only: ["issues", "pagination", "filters"],
      },
    );
  };

  useEffect(() => {
    // Skip the mount: the value came from the URL, so re-submitting it would be
    // a request that changes nothing and replaces the history entry.
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => go({ q }), 300);
    return () => clearTimeout(timer);
    // `go` is intentionally not a dependency: it closes over `window.location`,
    // which is current at call time, and adding it would re-arm the timer on
    // every render. This repo carries no react-hooks plugin to say so in a
    // disable comment, hence the note.
  }, [q]);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
      <label className="sr-only" htmlFor="issue-search">
        {__("Search issues")}
      </label>
      <input
        id="issue-search"
        type="search"
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder={__("Search issues…")}
        className={controlClass("min-w-0 flex-1 sm:min-w-64")}
      />

      <select
        aria-label={__("Status")}
        value={filters.status ?? ""}
        onChange={(event) => go({ status: event.target.value })}
        className={controlClass()}
      >
        <option value="">{__("All statuses")}</option>
        {options.statuses.map((status) => (
          <option key={status} value={status}>
            {status.replace("_", " ")}
          </option>
        ))}
      </select>

      <select
        aria-label={__("Priority")}
        value={filters.priority ?? ""}
        onChange={(event) => go({ priority: event.target.value })}
        className={controlClass()}
      >
        <option value="">{__("All priorities")}</option>
        {options.priorities.map((priority) => (
          <option key={priority} value={priority}>
            {priority}
          </option>
        ))}
      </select>

      <select
        aria-label={__("Assignee")}
        value={filters.assignee ? String(filters.assignee) : ""}
        onChange={(event) => go({ assignee: event.target.value })}
        className={controlClass()}
      >
        <option value="">{__("Anyone")}</option>
        {options.assignees.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>

      <select
        aria-label={__("Sort")}
        value={filters.sort}
        onChange={(event) => go({ sort: event.target.value })}
        className={controlClass()}
      >
        <option value="newest">{__("Newest")}</option>
        <option value="oldest">{__("Oldest")}</option>
        <option value="priority">{__("Priority")}</option>
        <option value="title">{__("Title")}</option>
      </select>

      {active && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            go({ q: "", status: "", priority: "", assignee: "" });
          }}
          className={cn(
            "h-9 rounded-md px-2.5 text-sm text-muted-foreground",
            "transition-colors duration-150 hover:bg-muted hover:text-foreground",
          )}
        >
          {__("Clear")}
        </button>
      )}
    </div>
  );
}

/**
 * The issue feed — pages accumulated as the reader scrolls.
 *
 * The list is rendered from local state rather than straight from the prop,
 * because a page of results is now an *addition* to what is on screen rather
 * than a replacement for it. Two things can change that state and they mean
 * opposite things:
 *
 *   a filter changed  → this is a different list. Replace.
 *   a page loaded     → this is more of the same list. Append.
 *
 * The signature is every filter *except* `page`, which is exactly that
 * distinction expressed as a value.
 *
 * `preserveUrl` keeps the address bar on the filters. Pagination is how the list
 * is fetched, not what the reader is looking at, so putting `page=4` in the URL
 * would make a reload return the fourth page alone — the middle of a list with
 * no way back to its start. Filters stay the URL's truth; the page counter does
 * not belong there.
 *
 * Arrivals are deduplicated by id: an issue created while someone is scrolling
 * shifts every later row down a page, and the naive append shows the row that
 * straddles the boundary twice.
 */
function useIssueFeed(served: IssueRow[], meta: PageMeta, filters: Filters) {
  const signature = [
    filters.q,
    filters.status,
    filters.priority,
    filters.assignee,
    filters.sort,
  ].join("\u0000");

  const [items, setItems] = useState(served);
  const [page, setPage] = useState(meta.page);
  const [loading, setLoading] = useState(false);
  const currentSignature = useRef(signature);

  useEffect(() => {
    if (currentSignature.current === signature) return;
    currentSignature.current = signature;
    setItems(served);
    setPage(meta.page);
  }, [signature, served, meta.page]);

  const hasMore = page < meta.lastPage;

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    setLoading(true);

    const url = new URL(window.location.href);
    url.searchParams.set("page", String(page + 1));

    router.get(
      `${url.pathname}${url.search}`,
      {},
      {
        preserveState: true,
        preserveScroll: true,
        preserveUrl: true,
        only: ["issues", "pagination"],
        onSuccess: (visit) => {
          const next = (visit.props as unknown as { issues?: IssueRow[] }).issues ?? [];
          setItems((previous) => {
            const seen = new Set(previous.map((issue) => issue.id));
            return [...previous, ...next.filter((issue) => !seen.has(issue.id))];
          });
          setPage((n) => n + 1);
        },
        onFinish: () => setLoading(false),
      },
    );
  }, [loading, hasMore, page]);

  return { items, hasMore, loading, loadMore };
}

/**
 * The end of the list: a sentinel, a button, and a count.
 *
 * The button is not a fallback — it is the control. An `IntersectionObserver`
 * presses it when the end of the list comes into view, which is what makes the
 * scrolling feel infinite, but a reader who cannot scroll a mouse wheel still
 * has a real, focusable, labelled control to reach with Tab. Infinite scroll
 * built only from the observer is a list that keyboard users cannot finish.
 *
 * The count is a live region because otherwise the page grows silently: nothing
 * announces that twenty more rows arrived under a screen reader.
 */
function FeedFooter({
  shown,
  total,
  hasMore,
  loading,
  onLoadMore,
}: {
  shown: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = sentinel.current;
    // No sentinel to watch, nothing left to fetch, or a fetch already running —
    // observing in any of those cases just re-fires the request that is in flight.
    if (!node || !hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      // Start fetching before the reader reaches the bottom, so the next rows are
      // usually there by the time they would have noticed their absence.
      { rootMargin: "400px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  return (
    <div className="flex flex-col items-center gap-3 border-t border-border px-4 py-5">
      <div ref={sentinel} aria-hidden="true" className="h-px w-full" />

      <p aria-live="polite" className="text-xs text-muted-foreground tabular-nums">
        {hasMore ? __("Showing {shown} of {total}", { shown, total }) : __("All {total} loaded", { total })}
      </p>

      {hasMore && (
        <Button variant="secondary" onClick={onLoadMore} disabled={loading}>
          {loading ? __("Loading…") : __("Load more")}
        </Button>
      )}
    </div>
  );
}

ProjectShow.layout = (page: ReactNode) => <AppShell>{page}</AppShell>;
