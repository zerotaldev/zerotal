import { route } from "zerotal";
import { CsrfMiddleware } from "zerotal/session";
import { url, type HtmlNode } from "@zerotal/flow";
import { Project, type ProjectData } from "@app/models/Project";
import type { PaginationData } from "../../components/Pagination";
import { PROJECT_STATUS } from "../../components/ProjectStatusBadge";
import { AppLayout } from "../../layouts/AppLayout";
import { buttonClass } from "../../lib/button";
import { timeAgo } from "../../lib/format";
import { Page, titled } from "../../lib/page";
import {
  CARD,
  EMPTY_DESCRIPTION,
  EMPTY_ICON,
  EMPTY_STATE,
  EMPTY_TITLE,
  INPUT,
  MODAL,
  MODAL_CLOSE,
  MODAL_FOOTER,
  PAGE_ACTIONS,
  PAGE_DESCRIPTION,
  PAGE_HEADER,
  PAGE_HEADER_ROW,
  PAGE_LINK_OFF,
  PAGE_LINK_ON,
  PAGE_TITLE,
  badgeClass,
  icon,
} from "../../lib/ui";

const PER_PAGE = 10;

/** /projects?search=…&page=…, leaving out what is empty. */
function listUrl(search: string, page = 1): string {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return route("projects") + (query ? `?${query}` : "");
}

/**
 * GET /projects?search=…&page=… — the signed-in user's projects, newest first.
 *
 * The one live page in the app. The search box is bound to `search`, which `@url` keeps
 * in the address bar: as the user types, Flow sends the new value over its WebSocket and
 * the list below re-renders on the server — no request handler, no JSON, no client code.
 * Everything else here is a link or a form, as on every other page.
 */
export class ProjectsPage extends Page {
  static override interactive = true;
  static override title = titled("Projects");

  @url search = "";
  @url page = 1;

  /** A new search starts from its first page. */
  async onUpdatedSearch(): Promise<void> {
    this.page = 1;
  }

  override layout(page: HtmlNode): HtmlNode {
    return <AppLayout shell={this.shell()}>{page}</AppLayout>;
  }

  /** One page of the list, read fresh on every render — the first, and each search. */
  private async load(): Promise<{ projects: ProjectData[]; pagination: PaginationData }> {
    const search = this.search.trim();
    let query = Project.query().where("user_id", this.user?.id ?? 0);
    if (search) {
      // Name or description, case-insensitively — LIKE is, on SQLite, for ASCII.
      query = query.where((q) =>
        q.whereLike("name", `%${search}%`).orWhereLike("description", `%${search}%`),
      );
    }
    const result = await query
      .orderBy("updated_at", "desc")
      .orderBy("id", "desc")
      .paginate(PER_PAGE, Math.max(1, Number(this.page) || 1));

    return {
      projects: result.data.map((project) => project.toPage()),
      pagination: {
        page: result.page,
        lastPage: result.lastPage,
        total: result.total,
        from: result.from,
        to: result.to,
      },
    };
  }

  override async render(): Promise<HtmlNode> {
    const { projects, pagination } = await this.load();
    const search = this.search.trim();
    const filtered = search !== "";
    const { page, lastPage, total, from, to } = pagination;
    const previous = listUrl(search, page - 1);
    const next = listUrl(search, page + 1);

    return (
      <div>
        <header class={PAGE_HEADER}>
          <div class={PAGE_HEADER_ROW}>
            <div class="min-w-0">
              <h1 class={PAGE_TITLE}>Projects</h1>
              <p class={PAGE_DESCRIPTION}>Everything you are working on, in one place.</p>
            </div>
            <div class={PAGE_ACTIONS}>
              <a href={route("projects.create")} class={buttonClass()}>
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  class="size-4"
                  dangerouslySetInnerHTML={icon("plus")}
                />
                New project
              </a>
            </div>
          </div>
        </header>

        {total === 0 && !filtered ? (
          <div class={EMPTY_STATE}>
            <div class={EMPTY_ICON}>
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                class="size-6"
                dangerouslySetInnerHTML={icon("folder")}
              />
            </div>
            <h3 class={EMPTY_TITLE}>No projects yet</h3>
            <p class={EMPTY_DESCRIPTION}>
              Projects are where your work lives. Create the first one to see how the list, the form
              and the policy fit together.
            </p>
            <div class="mt-6">
              <a href={route("projects.create")} class={buttonClass()}>
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  class="size-4"
                  dangerouslySetInnerHTML={icon("plus")}
                />
                Create a project
              </a>
            </div>
          </div>
        ) : (
          <div class="space-y-4">
            {/* A plain GET form too, so Enter (or no JavaScript at all) still searches. */}
            <form method="get" action={route("projects")} role="search" class="relative max-w-sm">
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                dangerouslySetInnerHTML={icon("search")}
              />
              <input
                type="search"
                name="search"
                aria-label="Search projects"
                placeholder="Search by name or description"
                value={this.search}
                live
                class={`${INPUT} pl-9`}
              />
            </form>

            {projects.length === 0 ? (
              <div class={EMPTY_STATE}>
                <div class={EMPTY_ICON}>
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    class="size-6"
                    dangerouslySetInnerHTML={icon("search")}
                  />
                </div>
                <h3 class={EMPTY_TITLE}>No matches</h3>
                <p class={EMPTY_DESCRIPTION}>{`Nothing matches “${search}”.`}</p>
                <div class="mt-6">
                  <button
                    type="button"
                    class={buttonClass("secondary")}
                    onClick={() => (this.search = "")}
                  >
                    Clear the search
                  </button>
                </div>
              </div>
            ) : (
              <div class={`${CARD} overflow-hidden`}>
                <ul aria-label="Projects" class="divide-y divide-border">
                  {projects.map((project) => {
                    const edit = route("projects.edit", { project: project.id });
                    const status = PROJECT_STATUS[project.status];
                    const updated = timeAgo(project.updatedAt);
                    return (
                      <li
                        key={String(project.id)}
                        class="flex items-center gap-4 px-4 py-4 sm:px-5"
                      >
                        <div class="min-w-0 flex-1">
                          <div class="flex flex-wrap items-center gap-2">
                            <a href={edit} class="truncate font-medium hover:underline">
                              {project.name}
                            </a>
                            <span class={badgeClass(status.tone)}>{status.label}</span>
                          </div>
                          {project.description ? (
                            <p class="mt-0.5 truncate text-sm text-muted-foreground">
                              {project.description}
                            </p>
                          ) : null}
                        </div>
                        <p class="hidden shrink-0 text-sm text-muted-foreground sm:block">
                          Updated {updated}
                        </p>
                        <div class="flex shrink-0 gap-1">
                          <a
                            href={edit}
                            class={buttonClass("ghost", "icon")}
                            aria-label={`Edit ${project.name}`}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                              class="size-4"
                              dangerouslySetInnerHTML={icon("pencil")}
                            />
                          </a>
                          <button
                            type="button"
                            class={buttonClass("ghost", "icon")}
                            aria-label={`Delete ${project.name}`}
                            data-open-modal={`delete-project-${project.id}`}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                              class="size-4"
                              dangerouslySetInnerHTML={icon("trash")}
                            />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {total > 0 ? (
              <nav aria-label="Pagination" class="flex items-center justify-between gap-4">
                <p class="text-sm text-muted-foreground">
                  Showing <span class="font-medium text-foreground">{from}</span>–
                  <span class="font-medium text-foreground">{to}</span> of{" "}
                  <span class="font-medium text-foreground">{total}</span> projects
                </p>
                {lastPage > 1 ? (
                  <div class="flex gap-2">
                    {page <= 1 ? (
                      <span aria-disabled="true" class={PAGE_LINK_OFF}>
                        <svg
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          class="size-4"
                          dangerouslySetInnerHTML={icon("chevron-left")}
                        />{" "}
                        Previous
                      </span>
                    ) : (
                      <a href={previous} class={PAGE_LINK_ON} rel="prev">
                        <svg
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          class="size-4"
                          dangerouslySetInnerHTML={icon("chevron-left")}
                        />{" "}
                        Previous
                      </a>
                    )}
                    {page >= lastPage ? (
                      <span aria-disabled="true" class={PAGE_LINK_OFF}>
                        Next{" "}
                        <svg
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          class="size-4"
                          dangerouslySetInnerHTML={icon("chevron-right")}
                        />
                      </span>
                    ) : (
                      <a href={next} class={PAGE_LINK_ON} rel="next">
                        Next{" "}
                        <svg
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          class="size-4"
                          dangerouslySetInnerHTML={icon("chevron-right")}
                        />
                      </a>
                    )}
                  </div>
                ) : null}
              </nav>
            ) : null}
          </div>
        )}

        {projects.map((project) => {
          const id = `delete-project-${project.id}`;
          return (
            <dialog
              id={id}
              data-modal=""
              aria-labelledby={`${id}-title`}
              aria-describedby={`${id}-description`}
              class={MODAL}
            >
              <div class="p-5 sm:p-6">
                <div class="flex items-start justify-between gap-4">
                  <h2
                    id={`${id}-title`}
                    class="text-lg font-semibold"
                  >{`Delete “${project.name}”?`}</h2>
                  <button type="button" data-close-modal="" aria-label="Close" class={MODAL_CLOSE}>
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      class="size-4.5"
                      dangerouslySetInnerHTML={icon("close")}
                    />
                  </button>
                </div>
                <p id={`${id}-description`} class="mt-1.5 text-sm text-muted-foreground">
                  The project is removed for good. This cannot be undone.
                </p>
              </div>
              <div class={MODAL_FOOTER}>
                <>
                  <button type="button" class={buttonClass("secondary", "md")} data-close-modal="">
                    Cancel
                  </button>
                  {/* DELETE, which a browser form can't send alone: see resources/js/lib/forms.ts. */}
                  <form
                    method="post"
                    action={route("projects.destroy", { project: project.id })}
                    data-method="delete"
                  >
                    {CsrfMiddleware.field()}
                    <button
                      type="submit"
                      class={buttonClass("danger", "md", "w-full")}
                      data-loading-text="Deleting…"
                    >
                      Delete project
                    </button>
                  </form>
                </>
              </div>
            </dialog>
          );
        })}
      </div>
    );
  }
}
