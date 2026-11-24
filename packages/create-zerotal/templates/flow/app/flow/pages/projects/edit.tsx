import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { Gate } from "zerotal/auth";
import type { Project } from "@app/models/Project";
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
    if (!project) return <div />;

    return (
      <div class="max-w-2xl">
        <PageHeader title={project.name} back={{ href: route("projects"), label: "Projects" }} />
        <ProjectForm
          project={project}
          values={{
            name: project.name,
            description: project.description ?? "",
            status: project.status,
          }}
          errors={(field) => this.error(field)}
        />
      </div>
    );
  }
}
