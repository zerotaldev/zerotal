import { route } from "zerotal";
import { Gate } from "zerotal/auth";
import type { HtmlNode } from "@zerotal/flow";
import type { Project } from "@app/models/Project";
import { ProjectForm } from "../../components/ProjectForm";
import { AppLayout } from "../../layouts/AppLayout";
import { Page } from "../../lib/page";
import { appName } from "../../lib/site";
import { PAGE_HEADER, PAGE_HEADER_BACK, PAGE_HEADER_ROW, PAGE_TITLE, icon } from "../../lib/ui";

/**
 * GET /projects/:project/edit — `:project` arrives as the loaded model (a 404 if there is
 * no such project), and the policy turns anyone but its owner away with a 403. The form
 * PUTs to app/routes/(auth)/(verified)/projects/[project]/index.ts.
 */
export class EditProjectPage extends Page {
  static override title = (page: EditProjectPage): string =>
    [page.project ? `Edit ${page.project.name}` : "Edit project", appName()]
      .filter(Boolean)
      .join(" — ");

  project: Project | null = null;

  override async onMount(): Promise<void> {
    // `:project`, already loaded by the router — or, in a test, set on the page directly.
    const project =
      (this.http?.params as { project?: Project } | undefined)?.project ?? this.project;
    if (!project) return;
    Gate.authorize("update", project);
    this.project = project;
  }

  override layout(page: HtmlNode): HtmlNode {
    return <AppLayout shell={this.shell()}>{page}</AppLayout>;
  }

  override async render(): Promise<HtmlNode> {
    const project = this.project;
    // Editing shows the saved values: a failed save is answered in place, without a reload.
    const values = {
      name: project?.name ?? "",
      description: project?.description ?? "",
      status: project?.status ?? "planning",
    };
    const errors = {
      name: this.error("name"),
      description: this.error("description"),
      status: this.error("status"),
    };

    return (
      <>
        {project ? (
          <div class="max-w-2xl">
            <header class={PAGE_HEADER}>
              <a href={route("projects")} class={PAGE_HEADER_BACK}>
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  class="size-4"
                  dangerouslySetInnerHTML={icon("chevron-left")}
                />
                Projects
              </a>
              <div class={PAGE_HEADER_ROW}>
                <div class="min-w-0">
                  <h1 class={PAGE_TITLE}>{project.name}</h1>
                </div>
              </div>
            </header>
            <ProjectForm
              action={route("projects.update", { project: project.id })}
              method="put"
              values={values}
              errors={errors}
              submit="Save changes"
            />
          </div>
        ) : (
          <div />
        )}
      </>
    );
  }
}
