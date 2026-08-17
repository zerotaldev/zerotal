import { Head, expose, locked } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import type { HttpContext } from "zerotal";
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

  /**
   * `:project` is read off the request rather than left to be seeded by name.
   *
   * Flow normally fills a `@locked` field whose name matches a route segment, and
   * for a page that extends `Component` directly it does. For a page that extends
   * a *decorated base* — this one and the edit form both extend `IssueFormPage` —
   * it is order-dependent: the field decorators register lazily on first read
   * (`_drainFields` in the framework's decorators.ts), the drain works out which
   * fields a class declares itself by constructing it and subtracting its base's,
   * and whichever page is rendered first in the process drains first. Request the
   * edit form after any other page and `project` is simply never registered, so
   * the seeding loop skips it and `render()` dies on `undefined.slug`.
   *
   * Reproduced deterministically: a bare `/dashboard` before `/…/edit` is enough,
   * and constructing the class once beforehand makes it pass again. The
   * assignment below is the fix that does not depend on the framework being
   * fixed; the `@locked` declaration stays because it is what carries the value
   * across socket round-trips, where there is no URL left to read.
   */
  override async onMount(ctx?: HttpContext): Promise<void> {
    // Assigned only when the request actually carries the segment. `ctx.params`
    // is empty on a socket round-trip — the context is rebuilt from the stored
    // route *pattern*, and the value comes back from the snapshot instead — so an
    // unconditional write here would erase it the first time `refresh()` ran.
    const bound = ctx?.params?.["project"] as Project | undefined;
    if (bound) this.project = bound;

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
