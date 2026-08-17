import { Component, InfiniteScroll, expose } from "@zerotal/flow";
import { Link } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { AuthMiddleware } from "zerotal/auth";
import { Project } from "@app/models/Project.ts";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";
import { AppLayout } from "../../layouts/app.tsx";
import { CARD, SECONDARY } from "../../ui.ts";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

/** A grid three cards wide at the widest breakpoint, so a multiple of six. */
const PER_PAGE = 24;

/**
 * GET /projects — the same query the other two builds run, one screen at a time.
 *
 * Queried in `render()` rather than loaded into a `@locked` field in `onMount()`,
 * and that is the choice worth naming: a `@locked` field is **dehydrated into the
 * signed snapshot and sent to the browser**. Holding `Project` models there would
 * ship every column of every row — including the owner's email, which this page
 * displays a *name* from — to a client that only ever renders four fields.
 *
 * The docs recommend `@locked` + `onMount()` for expensive queries. That advice
 * does not apply here even now that the page has an action: `loadMore` changes
 * one number, and re-running one indexed query is cheaper than carrying every
 * loaded project in the snapshot between round-trips.
 *
 * The grid grows by scrolling, on the same terms as the issue list — `depth`
 * counts pages *loaded* and `render()` asks for `PER_PAGE * depth` from the top,
 * held as component state rather than in the URL. Until it did, an install with a
 * hundred projects rendered a hundred cards on first paint, which is a slow page
 * and an unreadable one.
 */
export class ProjectsPage extends Component {
  static layout = AppLayout;
  static title = "Projects";

  /** How many pages' worth are on screen. Not URL-synced — see the issue list. */
  @expose depth = 1;

  /** See the note on the issue list's `loadMore` — same shape, same reasoning. */
  @expose loadMore(): void {
    this.depth++;
  }

  async render(): Promise<HtmlNode> {
    // `withCount` rather than loading each project's issues — one query, not one
    // per project. Identical to the other builds, because it is the same seam.
    const paginated = await Project.query()
      .with("owner")
      .withCount("issues")
      .orderBy("name")
      .paginate(PER_PAGE * this.depth, 1);

    const projects = paginated.data;
    const hasMore = projects.length < paginated.total;

    return (
      <div class="space-y-6">
        <div>
          <h1 class="text-xl font-semibold tracking-tight">{__("Projects")}</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            {__("Manage and track your projects.")}
          </p>
        </div>

        {projects.length === 0 ? (
          <div class={`${CARD} p-10 text-center`}>
            <h2 class="text-sm font-medium text-foreground">{__("No projects yet")}</h2>
            <p class="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
              {__(
                "Projects hold issues. Once one exists, it will show up here with everything tracked against it.",
              )}
            </p>
          </div>
        ) : (
          <ul class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => {
              const count = Number(
                (project as unknown as { issuesCount?: number }).issuesCount ?? 0,
              );
              return (
                <li key={String(project.id)}>
                  <Link
                    href={`/projects/${project.slug}`}
                    down
                    class="flex h-full flex-col rounded-xl border border-border bg-card p-5 transition-[border-color,box-shadow] hover:border-muted-foreground/30 hover:shadow-sm"
                  >
                    <h2 class="truncate text-[0.9375rem] font-semibold text-card-foreground">
                      {project.name}
                    </h2>
                    <p class="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {project.description ?? "—"}
                    </p>
                    <p class="mt-4 text-sm tabular-nums">
                      <span class="font-medium text-foreground">{String(count)}</span>{" "}
                      <span class="text-muted-foreground">{__("Issues")}</span>
                    </p>
                    {project.owner ? (
                      <div class="mt-auto border-t border-border pt-4">
                        <span class="truncate text-xs text-muted-foreground">
                          {project.owner.name}
                        </span>
                      </div>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {projects.length > 0 ? (
          <div class="flex flex-col items-center gap-3">
            {/* `aria-live`, because cards appended below the fold announce
                nothing on their own — the count is the only signal the grid grew. */}
            <p aria-live="polite" class="text-xs text-muted-foreground tabular-nums">
              {__("Showing {shown} of {total}", {
                shown: projects.length,
                total: paginated.total,
              })}
            </p>

            {/* Same shape as the issue list: the observer fires 300px early so
                the next row of cards is already there, and the button inside is
                what a keyboard or screen-reader user can actually reach. */}
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
        ) : null}
      </div>
    );
  }
}
