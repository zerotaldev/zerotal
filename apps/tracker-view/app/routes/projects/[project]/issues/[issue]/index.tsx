import { view } from "zerotal";
import type { HttpContext } from "zerotal";
import { Auth, AuthMiddleware, Gate } from "zerotal/auth";
import type { Project } from "@app/models/Project.ts";
import { Issue } from "@app/models/Issue.ts";
import { Comment } from "@app/models/Comment.ts";
import { Attachment } from "@app/models/Attachment.ts";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";
import { AppLayout } from "../../../../../../resources/views/layouts/AppLayout.tsx";
import {
  Card,
  EmptyState,
  LabelChip,
  PRIORITY_LABEL,
  PageHeader,
  PriorityBadge,
  STATUS_LABEL,
  StatusBadge,
  buttonClass,
} from "../../../../../../resources/views/components/Ui.tsx";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

/** Bytes → something a person reads. */
function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * GET /projects/:project/issues/:issue — one issue, its labels and its thread.
 *
 * The Inertia build's version of this page is live: a websocket pushes new
 * comments into the thread as they are posted. There is no socket here and no
 * script to hold one, so the thread is what it was when the page was rendered —
 * posting a comment reloads it. That is the honest server-rendered version, and
 * the "Live"/"Offline" badge the other build shows is deliberately absent
 * rather than shown permanently reading "Offline".
 */
export const GET = async (http: HttpContext) => {
  const project = http.params.project as unknown as Project;
  const bound = http.params.issue as unknown as Issue;

  // Re-queried with its relations rather than using the bound instance: route
  // binding resolves the row, not the graph, and reading `issue.author.name`
  // off an unloaded relation is how a detail page becomes four queries.
  const issue = await Issue.query()
    .where("id", bound.id)
    .with("author")
    .with("assignee")
    .with("labels")
    .firstOrFail();

  const comments = await Comment.query()
    .where("issue_id", bound.id)
    .with("author")
    .orderBy("created_at", "asc")
    .get();

  const attachments = await Attachment.query()
    .where("issue_id", bound.id)
    .with("uploader")
    .orderBy("created_at", "asc")
    .get();

  const canUpdate = Gate.allows("update", issue);
  const user = Auth.userOrNull();
  const errors = http.session?.get<Record<string, string>>("errors") ?? {};
  const issueHref = { project: project.slug, issue: String(issue.id) };

  view(
    <AppLayout
      title={issue.title}
      active="projects"
      user={user ? { name: user.name, email: user.email } : null}
      flash={{
        success: http.session?.get<string>("success") ?? null,
        error: http.session?.get<string>("error") ?? null,
      }}
    >
      <div class="max-w-3xl space-y-6">
        <nav aria-label={__("Breadcrumb")} class="text-xs text-muted-foreground">
          <a href={route("projects")} class="hover:text-foreground">
            {__("Projects")}
          </a>
          <span aria-hidden="true" class="px-1.5">
            /
          </span>
          <a
            href={route("projects.show", { project: project.slug })}
            class="hover:text-foreground"
          >
            {project.name}
          </a>
        </nav>

        <PageHeader
          title={issue.title}
          description={__("#{id} · opened by {author}", {
            id: issue.id,
            author: issue.author?.name ?? "—",
          })}
          actions={
            canUpdate ? (
              <a href={route("projects.issues.edit.show", issueHref)} class={buttonClass("secondary")}>
                {__("Edit")}
              </a>
            ) : null
          }
        />

        <Card class="p-5">
          <div class="flex flex-wrap items-center gap-2">
            <StatusBadge status={issue.status} label={__(STATUS_LABEL[issue.status] ?? issue.status)} />
            <PriorityBadge
              priority={issue.priority}
              label={__(PRIORITY_LABEL[issue.priority] ?? issue.priority)}
            />
            {(issue.labels ?? []).map((label) => (
              <LabelChip name={label.name} colour={label.colour} />
            ))}
          </div>

          <dl class="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt class="text-xs text-muted-foreground">{__("Assignee")}</dt>
              <dd class="mt-1 text-sm">{issue.assignee?.name ?? __("Unassigned")}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">{__("Status")}</dt>
              <dd class="mt-1 text-sm">{__(STATUS_LABEL[issue.status] ?? issue.status)}</dd>
            </div>
          </dl>

          <div class="mt-5 border-t border-border pt-5">
            <h2 class="text-xs font-medium text-muted-foreground">{__("Description")}</h2>
            {/* `white-space: pre-wrap` rather than a Markdown renderer: the other
                build ships one in its bundle, and pulling a parser into the
                server render to match it would be a bigger claim than this page
                needs. The text is shown as written, and never as HTML. */}
            <p class="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
              {issue.body?.trim() ? issue.body : __("No description was given.")}
            </p>
          </div>
        </Card>

        <section>
          <h2 class="text-[0.9375rem] font-semibold">
            {comments.length === 1
              ? __("1 comment")
              : __("{count} comments", { count: comments.length })}
          </h2>

          {comments.length === 0 ? (
            <Card class="mt-3">
              <EmptyState
                title={__("No comments yet")}
                description={__("Nobody has replied to this issue.")}
              />
            </Card>
          ) : (
            <ul class="mt-3 space-y-2">
              {comments.map((comment) => (
                <li class="rounded-xl border border-border bg-card p-4">
                  <p class="text-sm font-medium text-foreground">
                    {comment.author?.name ?? __("The system")}
                  </p>
                  <p class="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                    {comment.body}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <Card class="mt-3 p-5">
            <h3 class="text-sm font-medium">{__("Add a comment")}</h3>
            <form
              method="post"
              action={route("projects.issues.comments.store", issueHref)}
              class="mt-3 space-y-3"
            >
              <textarea
                name="body"
                rows="4"
                required
                aria-label={__("Add a comment")}
                aria-invalid={errors["body"] ? "true" : undefined}
                class={`w-full rounded-md border bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:ring-2 focus:ring-ring/15 focus:outline-none ${
                  errors["body"] ? "border-destructive" : "border-input"
                }`}
              ></textarea>
              {errors["body"] ? (
                <p role="alert" class="text-sm text-destructive">
                  {errors["body"]}
                </p>
              ) : null}
              <button type="submit" class={buttonClass("primary")}>
                {__("Comment")}
              </button>
            </form>
          </Card>
        </section>

        <section>
          <h2 class="text-[0.9375rem] font-semibold">
            {attachments.length === 1
              ? __("1 attachment")
              : __("{count} attachments", { count: attachments.length })}
          </h2>

          {attachments.length > 0 ? (
            <ul class="mt-3 space-y-2">
              {attachments.map((attachment) => (
                <li class="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-foreground">
                      {attachment.originalName}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {fileSize(attachment.size)} · {attachment.uploader?.name ?? "—"}
                    </p>
                  </div>
                  <a
                    href={route("projects.issues.attachments.show", {
                      ...issueHref,
                      attachment: String(attachment.id),
                    })}
                    class={buttonClass("secondary")}
                  >
                    {__("Download")}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}

          <Card class="mt-3 p-5">
            <h3 class="text-sm font-medium">{__("Attach a file")}</h3>
            <p class="mt-1 text-xs text-muted-foreground">
              {__("Images, PDF, or plain text. Up to 8 MB.")}
            </p>
            {/* `enctype` is what makes this a real upload — without it the
                browser sends the filename as a string and the bytes nowhere. */}
            <form
              method="post"
              action={route("projects.issues.attachments.store", issueHref)}
              enctype="multipart/form-data"
              class="mt-3 flex flex-wrap items-center gap-2"
            >
              <input
                type="file"
                name="file"
                required
                aria-label={__("Attach a file")}
                class="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-sm file:text-foreground"
              />
              <button type="submit" class={buttonClass("primary")}>
                {__("Attach")}
              </button>
            </form>
            {errors["file"] ? (
              <p role="alert" class="mt-2 text-sm text-destructive">
                {errors["file"]}
              </p>
            ) : null}
          </Card>
        </section>
      </div>
    </AppLayout>,
  );
};
