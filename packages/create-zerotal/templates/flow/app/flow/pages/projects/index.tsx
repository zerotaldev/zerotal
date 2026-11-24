import { route } from "zerotal";
import { url, type HtmlNode } from "@zerotal/flow";
import { Project, type ProjectData } from "@app/models/Project";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { CONTROL, CONTROL_BORDER } from "../../components/Input";
import { Modal } from "../../components/Modal";
import { PageHeader } from "../../components/PageHeader";
import { Pagination, type PaginationData } from "../../components/Pagination";
import { ProjectStatusBadge } from "../../components/ProjectStatusBadge";
import { AppLayout } from "../../layouts/AppLayout";
import { cn } from "../../lib/cn";
import { timeAgo } from "../../lib/format";
import { Page, titled } from "../../lib/page";

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

    return (
      <div>
        <PageHeader
          title="Projects"
          description="Everything you are working on, in one place."
          actions={
            <Button href={route("projects.create")}>
              <Icon name="plus" class="size-4" />
              New project
            </Button>
          }
        />

        {pagination.total === 0 && !filtered ? (
          <EmptyState
            icon="folder"
            title="No projects yet"
            description="Projects are where your work lives. Create the first one to see how the list, the form and the policy fit together."
            action={
              <Button href={route("projects.create")}>
                <Icon name="plus" class="size-4" />
                Create a project
              </Button>
            }
          />
        ) : (
          <div class="space-y-4">
            {/* A plain GET form too, so Enter (or no JavaScript at all) still searches. */}
            <form method="get" action={route("projects")} role="search" class="relative max-w-sm">
              <Icon
                name="search"
                class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                name="search"
                aria-label="Search projects"
                placeholder="Search by name or description"
                value={this.search}
                live
                class={cn(CONTROL, CONTROL_BORDER, "pl-9")}
              />
            </form>

            {projects.length === 0 ? (
              <EmptyState
                icon="search"
                title="No matches"
                description={`Nothing matches “${search}”.`}
                action={
                  <Button variant="secondary" onClick={() => (this.search = "")}>
                    Clear the search
                  </Button>
                }
              />
            ) : (
              <Card class="overflow-hidden">
                <ul class="divide-y divide-border">
                  {projects.map((project) => (
                    <li
                      key={String(project.id)}
                      data-project={project.name}
                      class="flex items-center gap-4 px-4 py-4 sm:px-5"
                    >
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <a
                            href={route("projects.edit", { project: project.id })}
                            class="truncate font-medium hover:underline"
                          >
                            {project.name}
                          </a>
                          <ProjectStatusBadge status={project.status} />
                        </div>
                        {project.description ? (
                          <p class="mt-0.5 truncate text-sm text-muted-foreground">
                            {project.description}
                          </p>
                        ) : null}
                      </div>
                      <p class="hidden shrink-0 text-sm text-muted-foreground sm:block">
                        Updated {timeAgo(project.updatedAt)}
                      </p>
                      <div class="flex shrink-0 gap-1">
                        <Button
                          href={route("projects.edit", { project: project.id })}
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${project.name}`}
                        >
                          <Icon name="pencil" class="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${project.name}`}
                          data-open-modal={`delete-project-${project.id}`}
                        >
                          <Icon name="trash" class="size-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Pagination
              pagination={pagination}
              href={(page) => listUrl(search, page)}
              noun="projects"
            />
          </div>
        )}

        {projects.map((project) => (
          <Modal
            id={`delete-project-${project.id}`}
            title={`Delete “${project.name}”?`}
            description="The project is removed for good. This cannot be undone."
            footer={
              <>
                <Button variant="secondary" data-close-modal="">
                  Cancel
                </Button>
                {/* DELETE, which a browser form can't send alone: see resources/js/lib/forms.ts. */}
                <form
                  method="post"
                  action={route("projects.destroy", { project: project.id })}
                  data-method="delete"
                >
                  <Button
                    type="submit"
                    variant="danger"
                    class="w-full"
                    data-loading-text="Deleting…"
                  >
                    Delete project
                  </Button>
                </form>
              </>
            }
          />
        ))}
      </div>
    );
  }
}
