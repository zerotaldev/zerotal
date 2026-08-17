import { view } from "zerotal";
import type { HttpContext } from "zerotal";
import { Auth, AuthMiddleware } from "zerotal/auth";
import type { Project } from "@app/models/Project.ts";
import { Issue, ISSUE_PRIORITIES, ISSUE_STATUSES } from "@app/models/Issue.ts";
import { User } from "@app/models/User.ts";
import { StoreIssueRequest } from "@app/requests/StoreIssueRequest.ts";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";
import { AppLayout } from "../../../../../resources/views/layouts/AppLayout.tsx";
import { Card, PageHeader } from "../../../../../resources/views/components/Ui.tsx";
import { IssueForm } from "../../../../../resources/views/components/IssueForm.tsx";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

/** GET /projects/:project/issues/new — the empty form. */
export const GET = async (http: HttpContext) => {
  const project = http.params.project as unknown as Project;
  const errors = http.session?.get<Record<string, string>>("errors") ?? {};
  const old = http.session?.get<Record<string, string>>("old") ?? {};
  const people = await User.query().orderBy("name").get();
  const user = Auth.userOrNull();

  view(
    <AppLayout
      title={__("New issue")}
      active="projects"
      user={user ? { name: user.name, email: user.email } : null}
      flash={{ error: http.session?.get<string>("error") ?? null }}
    >
      <div class="max-w-2xl space-y-6">
        <PageHeader
          title={__("New issue")}
          description={__("Describe what is wrong, and who should pick it up.")}
        />

        <Card class="p-5">
          <IssueForm
            action={route("projects.issues.new.store", { project: project.slug })}
            cancelHref={route("projects.show", { project: project.slug })}
            submitLabel={__("Create issue")}
            values={{
              title: old["title"] ?? "",
              body: old["body"] ?? "",
              status: old["status"] ?? "backlog",
              priority: old["priority"] ?? "medium",
              assigneeId: old["assigneeId"] ? Number(old["assigneeId"]) : null,
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
 * POST /projects/:project/issues/new — the same rules as the other build.
 *
 * `StoreIssueRequest` is shared byte-for-byte, which is feature 4's whole claim:
 * three render layers, one set of rules.
 */
export async function POST(http: HttpContext): Promise<void> {
  const project = http.params.project as unknown as Project;
  const input = await StoreIssueRequest.validate();

  // Assigned rather than filled: `projectId` and `authorId` are not
  // mass-assignable and must not be — they are the two fields a crafted form
  // post would most like to set. They come from the URL and the session.
  const issue = new Issue();
  issue.fillValidated(input);
  issue.projectId = project.id;
  issue.authorId = Auth.user()!.id;
  await issue.save();

  http.flash("success", __("Issue created."));
  http.redirect(
    route("projects.issues.show", { project: project.slug, issue: String(issue.id) }),
    303,
  );
}
