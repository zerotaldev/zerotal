import { route } from "zerotal";
import { Gate } from "zerotal/auth";
import { locked, param, type HtmlNode } from "@zerotal/flow";
import { Project } from "@app/models/Project";
import { PageHeader } from "../../components/PageHeader";
import { ProjectForm } from "../../components/ProjectForm";
import { AppLayout } from "../../layouts/AppLayout";
import { Page } from "../../lib/page";
import { appName } from "../../lib/site";

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

  /** `:project`, already loaded by the router — or, in a test, set on the page directly. */
  @locked @param(Project) project: Project | null = null;

  override async onMount(): Promise<void> {
    if (!this.project) return;
    Gate.authorize("update", this.project);
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
            <PageHeader
              title={project.name}
              back={{ href: route("projects"), label: "Projects" }}
            />
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
