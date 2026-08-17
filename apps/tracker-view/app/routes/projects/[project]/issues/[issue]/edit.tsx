import { view } from "zerotal";
import type { HttpContext } from "zerotal";
import { Auth, AuthMiddleware, Gate } from "zerotal/auth";
import { Notify } from "@zerotal/notifications";
import type { Project } from "@app/models/Project.ts";
import { Issue, ISSUE_PRIORITIES, ISSUE_STATUSES } from "@app/models/Issue.ts";
import { User } from "@app/models/User.ts";
import { IssueAssignedNotification } from "@app/notifications/IssueAssignedNotification.ts";
import { UpdateIssueRequest } from "@app/requests/UpdateIssueRequest.ts";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";
import { AppLayout } from "../../../../../../resources/views/layouts/AppLayout.tsx";
import { Card, PageHeader } from "../../../../../../resources/views/components/Ui.tsx";
import { IssueForm } from "../../../../../../resources/views/components/IssueForm.tsx";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

/**
 * GET /projects/:project/issues/:issue/edit — feature 5's gate.
 *
 * `Gate.authorize` throws when the policy denies, which the exception handler
 * turns into a 403. Checked on the *form* as well as the submit, because a form
 * you can open and not submit is a worse experience than one you were never
 * shown — and because the two must agree, which is easiest when they call the
 * same policy.
 */
export const GET = async (http: HttpContext) => {
  const project = http.params.project as unknown as Project;
  const issue = http.params.issue as unknown as Issue;
  Gate.authorize("update", issue);

  const errors = http.session?.get<Record<string, string>>("errors") ?? {};
  const old = http.session?.get<Record<string, string>>("old") ?? {};
  const people = await User.query().orderBy("name").get();
  const user = Auth.userOrNull();

  view(
    <AppLayout
      title={__("Edit issue")}
      active="projects"
      user={user ? { name: user.name, email: user.email } : null}
      flash={{ error: http.session?.get<string>("error") ?? null }}
    >
      <div class="max-w-2xl space-y-6">
        <PageHeader title={__("Edit issue")} description={__("Change the details and save.")} />

        <Card class="p-5">
          <IssueForm
            action={route("projects.issues.edit.store", {
              project: project.slug,
              issue: String(issue.id),
            })}
            cancelHref={route("projects.issues.show", {
              project: project.slug,
              issue: String(issue.id),
            })}
            submitLabel={__("Save changes")}
            values={{
              title: old["title"] ?? issue.title,
              body: old["body"] ?? issue.body ?? "",
              status: old["status"] ?? issue.status,
              priority: old["priority"] ?? issue.priority,
              assigneeId: old["assigneeId"]
                ? Number(old["assigneeId"])
                : (issue.assigneeId ?? null),
            }}
            errors={errors}
            statuses={ISSUE_STATUSES}
            priorities={ISSUE_PRIORITIES}
            assignees={people.map((person) => ({ id: person.id, name: person.name }))}
          />
        </Card>
      </div>
    </AppLayout>,
  );
};

/**
 * `POST` rather than `PATCH`, and this build is the reason.
 *
 * A plain `<form>` can send `GET` or `POST` and nothing else without
 * JavaScript. Inertia could happily `PATCH` here; using the verb all three
 * builds can reach is what keeps the route table — and therefore the recipe —
 * identical between them.
 */
export async function POST(http: HttpContext): Promise<void> {
  const project = http.params.project as unknown as Project;
  const issue = http.params.issue as unknown as Issue;
  // No `Gate.authorize` here: `UpdateIssueRequest.authorize()` runs the same
  // policy before it parses the body, so the check and the rules travel
  // together and cannot drift apart.
  const input = await UpdateIssueRequest.validate();

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
      // `queue`, not `send`: the mail leaves the request entirely and runs in a
      // worker with no HTTP context, no session and no authenticated user.
      await Notify.queue(recipient, new IssueAssignedNotification(issue, project.slug, actor.name));
    }
  }

  http.flash("success", __("Issue updated."));
  http.redirect(
    route("projects.issues.show", { project: project.slug, issue: String(issue.id) }),
    303,
  );
}
