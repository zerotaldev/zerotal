import { Head, expose, locked } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Auth, AuthMiddleware, Gate } from "zerotal/auth";
import { Notify } from "@zerotal/notifications";
import { Project } from "@app/models/Project.ts";
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

  /**
   * Model props travel as `<name>:<id>` and are re-fetched on the way back.
   *
   * Without it the snapshot can carry a plain object instead, and then every
   * `Gate` call in an action denies: the policy is resolved from the model's
   * class, a bare `Object` has none, and the gate fails closed. Nothing reports
   * it — the page renders the control and the action quietly returns.
   *
   * It depends on what else the process has loaded, which is the worst part: a
   * single test file passes and the same test fails in the full suite. Declaring
   * the models is what makes it not depend on that.
   */
  static models = { Project, Issue };

  @locked project!: Project;
  @locked issue!: Issue;

  override async onMount(): Promise<void> {
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
