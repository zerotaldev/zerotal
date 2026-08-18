import { Head, expose, locked } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Auth, AuthMiddleware } from "zerotal/auth";
import type { Project } from "@app/models/Project.ts";
import { Issue } from "@app/models/Issue.ts";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";
import { AppLayout } from "../../../../layouts/app.tsx";
import { IssueFormPage } from "../../../../forms/issue-form.tsx";
import { CARD } from "../../../../ui.ts";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

/**
 * GET /projects/:project/issues/new — the empty form.
 *
 * There is no POST twin. The other two builds need one because a form has to be
 * submitted somewhere; here `create()` is a method on this class and the browser
 * calls it over the socket, so the route that renders the form and the code that
 * saves it are the same object. That is the whole shape difference — the rules,
 * the fields and the redirect are the other builds' line for line.
 */
export class NewIssuePage extends IssueFormPage {
  static layout = AppLayout;
  static title = "New issue";

  @locked project!: Project;

  override async onMount(): Promise<void> {
    await this.loadPeople();
  }

  protected override cancelHref(): string {
    return `/projects/${this.project.slug}`;
  }

  protected override submitLabel(): string {
    return __("Create issue");
  }

  @expose async create(): Promise<void> {
    const input = await this.validateShared();

    // Assigned rather than filled: `projectId` and `authorId` are not
    // mass-assignable and must not be — they are the two fields a crafted
    // request would most like to set. They come from the URL and the session.
    const issue = new Issue();
    issue.fillValidated(input);
    issue.projectId = this.project.id;
    issue.authorId = Auth.user()!.id;
    await issue.save();

    this.redirect(`/projects/${this.project.slug}/issues/${issue.id}`).withSuccess(
      __("Issue created."),
    );
  }

  async render(): Promise<HtmlNode> {
    return (
      <div class="max-w-2xl space-y-6">
        <Head>
          <title>{__("New issue")} — Tracker</title>
        </Head>

        <div>
          <h1 class="text-xl font-semibold tracking-tight">{__("New issue")}</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            {__("Describe what is wrong, and who should pick it up.")}
          </p>
        </div>

        <div class={`${CARD} p-5`}>{this.renderForm(this.create)}</div>
      </div>
    );
  }
}
