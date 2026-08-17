import { Head, expose, locked } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import type { HttpContext } from "zerotal";
import { Auth, AuthMiddleware, Gate } from "zerotal/auth";
import { Notify } from "@zerotal/notifications";
import type { Project } from "@app/models/Project.ts";
import { Issue } from "@app/models/Issue.ts";
import { User } from "@app/models/User.ts";
import { IssueAssignedNotification } from "@app/notifications/IssueAssignedNotification.ts";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";
import { AppLayout } from "../../../../../layouts/app.tsx";
import { IssueFormPage } from "../../../../../forms/issue-form.tsx";
import { CARD } from "../../../../../ui.ts";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

/**
 * GET /projects/:project/issues/:issue/edit — feature 5's gate, and feature 6's trigger.
 *
 * `Gate.authorize` runs in `onMount()`, which is the Flow equivalent of the
 * other builds refusing before they render: it throws, the exception handler
 * turns that into a 403, and no form is drawn for somebody who may not submit
 * it. The same call guards `update()` — the check has to be on the *action*, not
 * only on the page, because an action is reachable over the socket by anyone who
 * has the page open, and "had it open" is not the same as "still allowed".
 *
 * The other two builds get that second check for free from
 * `UpdateIssueRequest.authorize()`, which runs before the body is parsed. That
 * class is not usable from here — it validates a request body and a socket frame
 * has none — so the policy is consulted directly, and it is the same policy.
 */
export class EditIssuePage extends IssueFormPage {
  static layout = AppLayout;
  static title = "Edit issue";

  @locked project!: Project;
  @locked issue!: Issue;

  /**
   * Both segments read off the request rather than left to be seeded by name.
   *
   * See the long note in `new.tsx`: a page extending a decorated base has its
   * field decorators registered by a lazy, order-dependent drain, and this page
   * is the one that actually broke — `/dashboard` followed by `/…/edit` is a 500
   * on `this.project.slug`, while `/…/edit` first is a 200. Reading the params
   * here removes the dependency entirely.
   */
  override async onMount(ctx?: HttpContext): Promise<void> {
    // Guarded for the same reason as `new.tsx`: `ctx.params` is empty on a socket
    // round-trip, and writing `undefined` over a hydrated model would break the
    // page the moment anything called `refresh()`.
    const boundProject = ctx?.params?.["project"] as Project | undefined;
    const boundIssue = ctx?.params?.["issue"] as Issue | undefined;
    if (boundProject) this.project = boundProject;
    if (boundIssue) this.issue = boundIssue;

    Gate.authorize("update", this.issue);

    await this.loadPeople();

    this.title_ = this.issue.title;
    this.body = this.issue.body ?? "";
    this.status = this.issue.status;
    this.priority = this.issue.priority;
    this.assigneeId = this.issue.assigneeId ?? null;
  }

  protected override cancelHref(): string {
    return `/projects/${this.project.slug}/issues/${this.issue.id}`;
  }

  protected override submitLabel(): string {
    return __("Save changes");
  }

  @expose async update(): Promise<void> {
    // Re-checked on the action, not trusted from the mount. See the class note.
    Gate.authorize("update", this.issue);

    const input = await this.validateShared();

    // Re-queried rather than using the snapshot's copy: the bound instance was
    // serialised into the client's snapshot when the page mounted, and this is
    // a form somebody can leave open. The row is read fresh, so a save writes
    // over the current record rather than over a picture of an older one.
    const issue = await Issue.findOrFail(this.issue.id);

    // Read before the write: "who was this assigned to a moment ago" is not a
    // question the row can answer once it has been filled.
    const previousAssignee = issue.assigneeId ?? null;

    issue.fillValidated(input);
    await issue.save();

    // Feature 6. Only on a *change* to somebody, and never to yourself — nobody
    // wants mail telling them they did the thing they just did.
    const nextAssignee = issue.assigneeId ?? null;
    const actor = Auth.user()!;
    if (nextAssignee && nextAssignee !== previousAssignee && nextAssignee !== actor.id) {
      const recipient = await User.find(nextAssignee);
      if (recipient) {
        // `queue`, not `send`: the mail leaves the request entirely and runs in
        // a worker with no HTTP context, no session and no authenticated user.
        await Notify.queue(
          recipient,
          new IssueAssignedNotification(issue, this.project.slug, actor.name),
        );
      }
    }

    this.redirect(`/projects/${this.project.slug}/issues/${issue.id}`).withSuccess(
      __("Issue updated."),
    );
  }

  async render(): Promise<HtmlNode> {
    return (
      <div class="max-w-2xl space-y-6">
        <Head>
          <title>{`${__("Edit")} · ${this.issue.title} — Tracker`}</title>
        </Head>

        <div>
          <h1 class="text-xl font-semibold tracking-tight">{__("Edit issue")}</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            {__("Opened by {author}", {
              author: this.people.find((p) => p.id === this.issue.authorId)?.name ?? "—",
            })}
          </p>
        </div>

        <div class={`${CARD} p-5`}>{this.renderForm(this.update)}</div>
      </div>
    );
  }
}
