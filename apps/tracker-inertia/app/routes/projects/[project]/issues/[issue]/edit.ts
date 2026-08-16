import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { AuthMiddleware, Gate } from "zerotal/auth";
import type { Project } from "@app/models/Project.ts";
import { Issue, ISSUE_PRIORITIES, ISSUE_STATUSES } from "@app/models/Issue.ts";
import { User } from "@app/models/User.ts";
import { UpdateIssueRequest } from "@app/requests/UpdateIssueRequest.ts";

export const middleware = [AuthMiddleware];

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

  const people = await User.query().orderBy("name").get();

  return Inertia.render("issues/form", {
    project: { name: project.name, slug: project.slug },
    issue: {
      id: issue.id,
      title: issue.title,
      body: issue.body ?? "",
      status: issue.status,
      priority: issue.priority,
      assigneeId: issue.assigneeId ?? null,
    },
    options: {
      statuses: ISSUE_STATUSES,
      priorities: ISSUE_PRIORITIES,
      assignees: people.map((user) => ({ id: user.id, name: user.name })),
    },
  });
};

/**
 * `POST` rather than `PATCH`, and the reason is the cookbook.
 *
 * The `view` build has to reach this from a plain `<form>`, and a form can send
 * `GET` or `POST` and nothing else without JavaScript. Inertia could happily
 * `PATCH` here; using the verb all three builds can reach is what keeps the
 * route table — and therefore the recipe — identical between them.
 */
export async function POST(http: HttpContext): Promise<void> {
  const project = http.params.project as unknown as Project;
  const issue = http.params.issue as unknown as Issue;
  // No `Gate.authorize` here: `UpdateIssueRequest.authorize()` runs the same
  // policy before it parses the body, so the check and the rules travel
  // together and cannot drift apart.
  const input = await UpdateIssueRequest.validate();

  issue.fillValidated(input);
  await issue.save();

  http.flash("success", "Issue updated.");
  http.redirect(`/projects/${project.slug}/issues/${issue.id}`, 303);
}
