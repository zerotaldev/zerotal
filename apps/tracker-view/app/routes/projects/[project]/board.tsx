import { view } from "zerotal";
import type { HttpContext } from "zerotal";
import { Auth, AuthMiddleware } from "zerotal/auth";
import type { Project } from "@app/models/Project.ts";
import { Issue, ISSUE_STATUSES } from "@app/models/Issue.ts";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";
import { AppLayout } from "../../../../resources/views/layouts/AppLayout.tsx";
import {
  PRIORITY_LABEL,
  PageHeader,
  PriorityBadge,
  STATUS_LABEL,
  buttonClass,
} from "../../../../resources/views/components/Ui.tsx";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

/**
 * GET /projects/:project/board — feature 9, read-only in this build.
 *
 * One query for every issue in the project, grouped in memory. Grouping here
 * rather than five status-scoped queries is the difference between one round
 * trip and five, and the board is the page where that is most visible in a
 * trace. That part is identical to the Inertia build.
 *
 * **The cards do not move here, and this is the recipe saying so.**
 *
 * Two separate things stop it, and only one of them is "no JavaScript":
 *
 *   1. Dragging needs a script. Expected — the other build's keyboard fallback
 *      (focus a card, Shift+arrows) needs one too.
 *   2. `POST /projects/:project/board` takes the destination column *in full*:
 *      `{ status, issueIds: number[] }`. A plain `<form>` cannot encode an
 *      array — repeated fields collapse to the last value when the body is
 *      flattened, and the validator's `array` rule does not coerce a delimited
 *      string. So even with a button per card, this build cannot reach the
 *      endpoint the other one uses.
 *
 * Rather than invent a second contract for one build — which would break the
 * cookbook's claim that all three share a route table — moving a card is done
 * where it already works without a script: open the issue and change its status
 * on the edit form. Each card links there.
 *
 * The alternative, if this board must be interactive: teach the body parser to
 * collect repeated form fields into arrays. That is a framework change with a
 * blast radius well beyond this page, so it is named here rather than smuggled
 * in behind a demo.
 */
export const GET = async (http: HttpContext) => {
  const project = http.params.project as unknown as Project;

  const issues = await Issue.query()
    .where("project_id", project.id)
    .with("assignee")
    .orderBy("position", "asc")
    .orderBy("id", "asc")
    .get();

  const columns = ISSUE_STATUSES.map((status) => ({
    status,
    issues: issues.filter((issue) => issue.status === status),
  }));

  const user = Auth.userOrNull();

  view(
    <AppLayout
      title={__("Board")}
      active="projects"
      user={user ? { name: user.name, email: user.email } : null}
      flash={{
        success: http.session?.get<string>("success") ?? null,
        error: http.session?.get<string>("error") ?? null,
      }}
    >
      <div class="space-y-6">
        <nav aria-label={__("Breadcrumb")} class="text-xs text-muted-foreground">
          <a href={route("projects")} class="hover:text-foreground">
            {__("Projects")}
          </a>
          <span aria-hidden="true" class="px-1.5">
            /
          </span>
          <a href={route("projects.show", { project: project.slug })} class="hover:text-foreground">
            {project.name}
          </a>
        </nav>

        <PageHeader
          title={__("Board")}
          description={__("Open an issue to change its status.")}
          actions={
            <a href={route("projects.show", { project: project.slug })} class={buttonClass("secondary")}>
              {__("List view")}
            </a>
          }
        />

        {/* Horizontal scroll rather than a wrapping grid: five columns that
            reflow into two rows stop reading as a pipeline. */}
        <div class="flex gap-4 overflow-x-auto pb-2">
          {columns.map((column) => (
            <section class="w-72 shrink-0">
              <h2 class="flex items-center justify-between gap-2 px-1 pb-2">
                <span class="text-sm font-medium">
                  {__(STATUS_LABEL[column.status] ?? column.status)}
                </span>
                <span class="text-xs text-muted-foreground tabular-nums">
                  {String(column.issues.length)}
                </span>
              </h2>

              <ul class="space-y-2">
                {column.issues.map((issue) => (
                  <li>
                    <a
                      href={route("projects.issues.show", {
                        project: project.slug,
                        issue: String(issue.id),
                      })}
                      class="block rounded-xl border border-border bg-card p-3 transition-[border-color,box-shadow] hover:border-muted-foreground/30 hover:shadow-sm"
                    >
                      <p class="text-sm font-medium text-card-foreground">{issue.title}</p>
                      <div class="mt-2 flex items-center justify-between gap-2">
                        <PriorityBadge
                          priority={issue.priority}
                          label={__(PRIORITY_LABEL[issue.priority] ?? issue.priority)}
                        />
                        <span class="truncate text-xs text-muted-foreground">
                          {issue.assignee?.name ?? __("Unassigned")}
                        </span>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>

              {column.issues.length === 0 ? (
                <p class="rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                  {__("Nothing here")}
                </p>
              ) : null}
            </section>
          ))}
        </div>
      </div>
    </AppLayout>,
  );
};
