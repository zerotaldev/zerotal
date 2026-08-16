import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { Auth, AuthMiddleware } from "zerotal/auth";
import type { Project } from "@app/models/Project.ts";
import { Issue, ISSUE_PRIORITIES, ISSUE_STATUSES } from "@app/models/Issue.ts";
import { User } from "@app/models/User.ts";
import { StoreIssueRequest } from "@app/requests/StoreIssueRequest.ts";

export const middleware = [AuthMiddleware];

export const GET = async (http: HttpContext) => {
  const project = http.params.project as unknown as Project;
  return Inertia.render("issues/form", {
    project: { name: project.name, slug: project.slug },
    issue: null,
    options: await formOptions(),
  });
};

export async function POST(http: HttpContext): Promise<void> {
  const project = http.params.project as unknown as Project;
  const input = await StoreIssueRequest.validate();

  // `forceCreate`, because projectId and authorId are not mass-assignable and
  // must not be: they are the two fields a crafted form post would most like to
  // set. They come from the URL and the session instead.
  // `forceCreate`-equivalent by hand: projectId and authorId are not
  // mass-assignable and must not be — they are the two fields a crafted form
  // post would most like to set. They come from the URL and the session.
  const issue = new Issue();
  issue.fillValidated(input);
  issue.projectId = project.id;
  issue.authorId = Auth.user()!.id;
  await issue.save();

  http.flash("success", "Issue created.");
  http.redirect(`/projects/${project.slug}/issues/${issue.id}`, 303);
}

/** The select lists both forms share. */
async function formOptions() {
  const people = await User.query().orderBy("name").get();
  return {
    statuses: ISSUE_STATUSES,
    priorities: ISSUE_PRIORITIES,
    assignees: people.map((user) => ({ id: user.id, name: user.name })),
  };
}
