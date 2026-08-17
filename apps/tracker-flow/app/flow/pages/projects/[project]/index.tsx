import {
  Component,
  Head,
  InfiniteScroll,
  Link,
  computed,
  expose,
  locked,
  url,
} from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { AuthMiddleware } from "zerotal/auth";
import type { Project } from "@app/models/Project.ts";
import {
  Issue,
  ISSUE_PRIORITIES,
  ISSUE_SORTS,
  ISSUE_STATUSES,
  type IssuePriority,
  type IssueSort,
  type IssueStatus,
} from "@app/models/Issue.ts";
import { User } from "@app/models/User.ts";
import { filtersActive, issueRow } from "@app/support/issues.ts";
import type { IssueFilters } from "@app/support/issues.ts";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";
import { AppLayout } from "../../../layouts/app.tsx";
import {
  BADGE,
  FIELD,
  GHOST,
  PRIMARY,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  SECONDARY,
  SELECT,
  SORT_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
} from "../../../ui.ts";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

const PER_PAGE = 10;

/** The `@url` fields a change to should send the reader back to page one. */
const FILTERS = ["q", "status", "priority", "assignee", "sort"];

/**
 * GET /projects/:project — the issue list, and the page this app is judged on.
 *
 * Every filter lives in the query string and nowhere else, exactly as in the
 * other two builds, so a hand-edited URL behaves identically in all three and
 * the same link can be pasted between them.
 *
 * What differs is what happens *between* those URLs. The view build submits a
 * GET form and the page comes back. The Inertia build debounces a partial reload
 * that patches two props. Here the search box is bound `live`: each keystroke
 * writes `this.q` on the server, the render re-runs the query, and the patch
 * comes back over the socket that is already open. The URL is rewritten to match
 * because `@url` syncs both ways — so the address bar stays shareable without a
 * single line of code that touches it.
 *
 * `live` is per-keystroke with no debounce, which is a real trade rather than an
 * oversight: the round trip is a socket frame and a `LIKE` against an indexed
 * column, and the alternative — waiting 300ms to find out if the reader is still
 * typing — is 300ms of staleness on every search. On a slow link the frames
 * queue and the last one wins, which is the correct answer either way.
 *
 * The list grows by scrolling rather than by paging, which is the second place
 * the three builds diverge — the view build's docblock names infinite scroll as
 * the thing it will not do, because appending on scroll needs a listener and a
 * link does not.
 *
 * How far you have scrolled is **not** in the URL. It is component state, so the
 * address bar carries the filters and nothing else — `?q=telemetry` describes a
 * result set, which is the thing worth pasting to somebody. The cost is the one
 * every infinite list pays: reloading, or coming Back from an issue, returns you
 * to the top rather than to row sixty. Depth *was* URL-synced, and that made Back
 * land correctly, but it also meant a `?page=` that promised pagination this page
 * does not have.
 *
 * ## `down`, not `hover`, on the rows
 *
 * `<Link hover>` prefetches after ~60ms of hover, and on a handful of stable
 * links — the navigation rail — that is free speed. On a dense list it is the
 * opposite: the pointer crosses every row between where it is and where it is
 * going, so scrolling a hundred issues asks the server for a hundred pages
 * nobody chose. `down` prefetches on pointer-down instead: once, on the link the
 * reader has committed to, and still ahead of the click by however long the
 * button is held.
 *
 * ## The leading number is a row number, not an id
 *
 * It counts 1, 2, 3 down the page and follows whatever sort is applied, so it is
 * positional and deliberately **not** a handle for the issue — filter to Urgent
 * and the third row is still numbered 3. The stable identifier is in the URL the
 * row links to. Showing the primary key here instead read as counting backwards,
 * because the newest issue has the highest one and the list opens newest-first.
 */
export class ProjectIssuesPage extends Component {
  static layout = AppLayout;
  static title = "Issues";

  /** `:project` — the record, resolved by slug on the model and already loaded. */
  @locked project!: Project;

  // Strings rather than the narrow unions, because a query string is a string
  // and `""` is how `@url` says "absent" — a value of `""`, `null` or `undefined`
  // drops the parameter from the URL entirely. The unions are recovered in
  // `render()` by checking each value against the list it came from, so a
  // hand-typed `?status=nonsense` narrows to `null` rather than reaching a query.
  @url q = "";
  @url status = "";
  @url priority = "";
  @url assignee = "";
  // `""` rather than `"newest"`, and that is the whole reason it is a string:
  // `@url` drops a param whose value is `""`, so the default sort leaves no
  // trace in the address bar. Writing `?sort=newest` for a list that is already
  // sorted that way is noise in a URL people paste to each other. A hand-typed
  // `?sort=newest` still works — `filters()` narrows it the same way.
  @url sort = "";

  /** Who has issues in this project — the assignee filter's options. */
  @locked assignees: { id: number; name: string }[] = [];

  override async onMount(): Promise<void> {
    // Loaded once on mount rather than per render: the set of people with issues
    // in a project does not change while somebody types in the search box, and
    // this is a second query on every keystroke if it lives in `render()`.
    const assigned = (await Issue.query()
      .where("project_id", this.project.id)
      .whereNotNull("assignee_id")
      .distinct()
      .pluck("assignee_id")) as unknown as number[];

    const people = assigned.length
      ? await User.query().whereIn("id", assigned).orderBy("name").get()
      : [];

    this.assignees = people.map((person) => ({ id: person.id, name: person.name }));
  }

  /**
   * How many pages' worth are on screen. Ordinary state, never in the URL.
   *
   * `@expose` rather than `@locked` because the client writes it — the sentinel
   * and the button both call `loadMore`, and the value has to survive the
   * round-trip that follows.
   */
  @expose depth = 1;

  /**
   * A filter changed — go back to the top.
   *
   * The generic hook rather than five `onUpdated<Prop>` methods, branching on the
   * name: `depth` is a client-writable property too, and a hook that reset it on
   * *every* write would make the list impossible to grow — `loadMore` would set
   * the depth and immediately unset it.
   */
  override async onUpdated(prop: string): Promise<void> {
    if (FILTERS.includes(prop)) this.depth = 1;
  }

  /**
   * Show one more page's worth — the sentinel's action, and the button's.
   *
   * `this.depth` counts **how many pages are loaded**, not which page is being
   * viewed, and `render()` asks for `PER_PAGE * depth` rows starting at the top.
   * That reframing is what makes infinite scroll cost almost nothing here:
   *
   *   - Nothing accumulates. There is no `@locked rows` array to append to, so
   *     there is no way for it to fall out of step with the filters — the bug
   *     every hand-rolled infinite list eventually has, where changing a filter
   *     leaves the old rows underneath the new ones.
   *   - It is still one query. `LIMIT 30` is not three round trips.
   *   - Depth is derivable from one number, so nothing has to be reconciled when
   *     a filter changes — `depth = 1` and the next render is correct.
   *
   * The cost is re-reading rows already on screen on every round-trip: at depth
   * ten that is a hundred rows re-queried to append ten. For a project issue list
   * that is the right side of the trade; for a feed with no ceiling it would not
   * be, and the accumulating `@locked` version in docs/flow/pagination.md is.
   *
   * No guard against running past the end. Overshooting asks for more rows than
   * exist, gets all of them, and `hasMore` is then false — so a double-fire from
   * the observer and the button racing each other settles itself.
   */
  @expose loadMore(): void {
    this.depth++;
  }

  @expose clearFilters(): void {
    this.q = "";
    this.status = "";
    this.priority = "";
    this.assignee = "";
    this.sort = "";
    this.depth = 1;
  }

  /**
   * The five `@url` strings, narrowed to what the query understands.
   *
   * Returns the *shared* `IssueFilters` shape rather than a private one, so
   * `filtersActive()` in `app/support/issues.ts` — the same function the other
   * two builds call — decides what "a filter is on" means here too. The only
   * thing this build does differently is where the strings came from.
   *
   * Anything unrecognised narrows to `null` and is dropped, so a hand-typed
   * `?status=nonsense` shows the unfiltered list rather than reaching the query
   * builder.
   */
  private filters(): IssueFilters {
    const oneOf = <T extends string>(value: string, allowed: readonly T[]): T | null =>
      value && (allowed as readonly string[]).includes(value) ? (value as T) : null;

    return {
      q: this.q.trim().slice(0, 120),
      status: oneOf<IssueStatus>(this.status, ISSUE_STATUSES),
      priority: oneOf<IssuePriority>(this.priority, ISSUE_PRIORITIES),
      assignee: /^\d+$/.test(this.assignee) ? Number(this.assignee) : null,
      sort: oneOf<IssueSort>(this.sort, ISSUE_SORTS) ?? "newest",
      page: this.depth,
    };
  }

  @computed get anyFilterOn(): boolean {
    return filtersActive(this.filters());
  }

  async render(): Promise<HtmlNode> {
    const base = `/projects/${this.project.slug}`;
    const filters = this.filters();

    // One page of `PER_PAGE * depth`, not page N of PER_PAGE — see the note on
    // `loadMore`. So the query stays a single LIMIT/OFFSET and the render stays a
    // pure function of (filters, depth), with no list held between round-trips.
    const paginated = await Issue.query()
      .where("project_id", this.project.id)
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
      .paginate(PER_PAGE * this.depth, 1);

    const issues = paginated.data.map(issueRow);
    const loaded = issues.length;
    const hasMore = loaded < paginated.total;

    return (
      <div class="space-y-6">
        <Head>
          <title>{`${this.project.name} — Tracker`}</title>
        </Head>

        <div>
          <nav aria-label={__("Breadcrumb")} class="mb-2 text-xs text-muted-foreground">
            <Link href="/projects" hover class="hover:text-foreground">
              {__("Projects")}
            </Link>
            <span aria-hidden="true" class="px-1.5">
              /
            </span>
            <span class="text-foreground">{this.project.name}</span>
          </nav>

          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 class="text-xl font-semibold tracking-tight">{this.project.name}</h1>
              {this.project.description ? (
                <p class="mt-1 text-sm text-muted-foreground">{this.project.description}</p>
              ) : null}
            </div>
            <div class="flex items-center gap-2">
              <Link href={`${base}/board`} hover class={SECONDARY}>
                {__("Board")}
              </Link>
              <Link href={`${base}/issues/new`} hover class={PRIMARY}>
                {__("New issue")}
              </Link>
            </div>
          </div>
        </div>

        <div class="rounded-xl border border-border bg-card">
          {/* Not a `<form>`. There is nothing to submit: each control writes its
              own property on the server, and the list re-renders from it. The
              view build needs a form because the browser has to build the query
              string; here `@url` writes the address bar directly. */}
          <div class="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <label class="sr-only" for="q">
              {__("Search issues")}
            </label>
            <input
              id="q"
              type="search"
              value={this.q}
              live
              placeholder={__("Search issues…")}
              class={`${FIELD} h-9 min-w-0 flex-1 sm:min-w-64`}
            />

            <select value={this.status} live aria-label={__("Status")} class={SELECT}>
              <option value="">{__("All statuses")}</option>
              {ISSUE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {__(STATUS_LABEL[s] ?? s)}
                </option>
              ))}
            </select>

            <select value={this.priority} live aria-label={__("Priority")} class={SELECT}>
              <option value="">{__("All priorities")}</option>
              {ISSUE_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {__(PRIORITY_LABEL[p] ?? p)}
                </option>
              ))}
            </select>

            <select value={this.assignee} live aria-label={__("Assignee")} class={SELECT}>
              <option value="">{__("Anyone")}</option>
              {this.assignees.map((person) => (
                <option key={String(person.id)} value={String(person.id)}>
                  {person.name}
                </option>
              ))}
            </select>

            <select value={this.sort} live aria-label={__("Sort")} class={SELECT}>
              {ISSUE_SORTS.map((s) => (
                // The default sorts under the empty value, so choosing it
                // removes the parameter rather than spelling out the default.
                <option key={s} value={s === "newest" ? "" : s}>
                  {__(SORT_LABEL[s] ?? s)}
                </option>
              ))}
            </select>

            {this.anyFilterOn ? (
              <button onClick={this.clearFilters} class={GHOST}>
                {__("Clear")}
              </button>
            ) : null}
          </div>

          {issues.length === 0 ? (
            <div class="p-10 text-center">
              {this.anyFilterOn ? (
                <>
                  <h2 class="text-sm font-medium text-foreground">
                    {__("No issues match these filters")}
                  </h2>
                  <p class="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
                    {__(
                      "Nothing here fits the current search and filters. Clearing them will show the whole project.",
                    )}
                  </p>
                  <button
                    onClick={this.clearFilters}
                    class="mt-4 text-sm font-medium text-primary hover:underline"
                  >
                    {__("Clear filters")}
                  </button>
                </>
              ) : (
                <>
                  <h2 class="text-sm font-medium text-foreground">{__("No issues yet")}</h2>
                  <p class="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
                    {__(
                      "This project has nothing tracked against it. The first issue is usually the one you just thought of.",
                    )}
                  </p>
                  <Link href={`${base}/issues/new`} hover class={`${PRIMARY} mt-4`}>
                    {__("Create issue")}
                  </Link>
                </>
              )}
            </div>
          ) : (
            <>
              <ul class="divide-y divide-border">
                {issues.map((issue, index) => (
                  <li key={String(issue.id)}>
                    <Link
                      href={`${base}/issues/${issue.id}`}
                      down
                      class="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
                    >
                      {/* Position in the list, and only that — see the class note.
                          `aria-hidden`, because "3" read aloud before the title
                          is noise to somebody who cannot see the column it lines
                          up in, and the row is already a link with a name. */}
                      <span
                        aria-hidden="true"
                        class="w-11 shrink-0 pt-0.5 text-right text-xs text-muted-foreground tabular-nums"
                      >
                        {index + 1}
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
                        <span class={`${BADGE} ${PRIORITY_TONE[issue.priority] ?? ""}`}>
                          {__(PRIORITY_LABEL[issue.priority] ?? issue.priority)}
                        </span>
                        <span class={`${BADGE} ${STATUS_TONE[issue.status] ?? ""}`}>
                          {__(STATUS_LABEL[issue.status] ?? issue.status)}
                        </span>
                      </span>
                      <span class="hidden w-28 shrink-0 truncate text-right text-xs text-muted-foreground lg:block">
                        {issue.assignee?.name ?? __("Unassigned")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>

              <div class="flex flex-col items-center gap-3 border-t border-border px-4 py-3">
                {/* `aria-live` because the count is the only thing that tells a
                    screen-reader user the list grew. Rows appended below the
                    viewport announce nothing on their own, which is the part of
                    infinite scroll that is usually just missing. */}
                <p
                  aria-live="polite"
                  class="text-xs text-muted-foreground tabular-nums"
                >
                  {__("Showing {shown} of {total}", {
                    shown: loaded,
                    total: paginated.total,
                  })}
                </p>

                {/* The sentinel renders nothing once `show` is false, so reaching
                    the end removes the trigger rather than leaving it firing.

                    The button inside it is not decoration: the intersection
                    observer only fires for someone who scrolls, and "scroll until
                    more appears" is not an affordance a keyboard or screen-reader
                    user can discover. Both paths call the same action, and if the
                    observer and a click both fire the list simply advances two
                    pages — harmless, because depth past the end clamps to the
                    total on the next render. */}
                {/* `intersectMargin` fires the observer 300px before the sentinel
                    is actually on screen, so the next ten rows are already there
                    when the reader arrives. Without it the trigger is the bottom
                    of the list, which means every reader sees the end of the page
                    and then waits — the round trip becomes visible exactly when
                    the point of this was that it should not be. */}
                <InfiniteScroll
                  onMore={this.loadMore}
                  show={hasMore}
                  intersectMargin="300px"
                  class="flex w-full items-center justify-center"
                >
                  <button onClick={this.loadMore} hideOnLoading class={SECONDARY}>
                    {__("Load more")}
                  </button>
                  <span showOnLoading class="text-sm text-muted-foreground">
                    {__("Loading…")}
                  </span>
                </InfiniteScroll>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }
}
