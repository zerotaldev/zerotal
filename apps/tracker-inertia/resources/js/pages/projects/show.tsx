import { useEffect, useRef, useState } from "react";
import { Head, Link, router } from "@inertiajs/react";
import TrackerLayout from "../../Layouts/TrackerLayout";
import EmptyState from "../../Components/EmptyState";
import Pagination, { type PageMeta } from "../../Components/Pagination";
import { LabelChip, PriorityBadge, StatusBadge } from "../../Components/Badge";
import { ButtonLink } from "../../Components/Button";
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
  const active =
    Boolean(filters.q) ||
    Boolean(filters.status) ||
    Boolean(filters.priority) ||
    Boolean(filters.assignee);

  return (
    <>
      <Head title={project.name} />

      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/projects" className="hover:text-foreground">
          Projects
        </Link>
        <span aria-hidden="true" className="px-1.5">
          /
        </span>
        <span className="text-foreground">{project.name}</span>
      </nav>

      <div className="mt-2 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          {project.description && (
            <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
          )}
        </div>
        <ButtonLink href={`/projects/${project.slug}/issues/new`} size="sm">
          New issue
        </ButtonLink>
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card">
        <FilterBar filters={filters} options={options} active={active} />

        {issues.length === 0 ? (
          // Two different nothings. Which one decides what the reader should do
          // next, so they do not share a sentence.
          active ? (
            <EmptyState
              title="No issues match these filters"
              description="Nothing here fits the current search and filters. Clearing them will show the whole project."
              action={
                <Link
                  href={`/projects/${project.slug}`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Clear filters
                </Link>
              }
            />
          ) : (
            <EmptyState
              title="No issues yet"
              description="This project has nothing tracked against it. The first issue is usually the one you just thought of."
              action={
                <ButtonLink href={`/projects/${project.slug}/issues/new`}>Create issue</ButtonLink>
              }
            />
          )
        ) : (
          <>
            <ul className="divide-y divide-border">
              {issues.map((issue) => (
                <li key={issue.id}>
                  <Link
                    href={`/projects/${project.slug}/issues/${issue.id}`}
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span className="w-12 shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums">
                      #{issue.id}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{issue.title}</span>
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
                      {issue.assignee?.name ?? "Unassigned"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="border-t border-border">
              <Pagination meta={pagination} />
            </div>
          </>
        )}
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

  const select =
    "h-8 rounded-md border border-input bg-card px-2 text-sm text-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 focus:outline-none";

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
      <label className="sr-only" htmlFor="issue-search">
        Search issues
      </label>
      <input
        id="issue-search"
        type="search"
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder="Search issues…"
        className={cn(select, "min-w-0 flex-1 sm:min-w-64")}
      />

      <select
        aria-label="Status"
        value={filters.status ?? ""}
        onChange={(event) => go({ status: event.target.value })}
        className={select}
      >
        <option value="">All statuses</option>
        {options.statuses.map((status) => (
          <option key={status} value={status}>
            {status.replace("_", " ")}
          </option>
        ))}
      </select>

      <select
        aria-label="Priority"
        value={filters.priority ?? ""}
        onChange={(event) => go({ priority: event.target.value })}
        className={select}
      >
        <option value="">All priorities</option>
        {options.priorities.map((priority) => (
          <option key={priority} value={priority}>
            {priority}
          </option>
        ))}
      </select>

      <select
        aria-label="Assignee"
        value={filters.assignee ? String(filters.assignee) : ""}
        onChange={(event) => go({ assignee: event.target.value })}
        className={select}
      >
        <option value="">Anyone</option>
        {options.assignees.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>

      <select
        aria-label="Sort"
        value={filters.sort}
        onChange={(event) => go({ sort: event.target.value })}
        className={select}
      >
        <option value="newest">Newest</option>
        <option value="oldest">Oldest</option>
        <option value="priority">Priority</option>
        <option value="title">Title</option>
      </select>

      {active && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            go({ q: "", status: "", priority: "", assignee: "" });
          }}
          className="h-8 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Clear
        </button>
      )}
    </div>
  );
}

ProjectShow.layout = (page: React.ReactNode) => <TrackerLayout>{page}</TrackerLayout>;
