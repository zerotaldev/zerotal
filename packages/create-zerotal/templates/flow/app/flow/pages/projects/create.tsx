import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { PageHeader } from "../../components/PageHeader";
import { ProjectForm } from "../../components/ProjectForm";
import { AppLayout } from "../../layouts/AppLayout";
import { Page, titled } from "../../lib/page";

/** GET /projects/create. The form posts to app/routes/(auth)/(verified)/projects/index.ts. */
export class CreateProjectPage extends Page {
  static override title = titled("New project");

  override layout(page: HtmlNode): HtmlNode {
    return <AppLayout shell={this.shell()}>{page}</AppLayout>;
  }

  override async render(): Promise<HtmlNode> {
    // What was typed before a failed post, so nothing has to be typed twice.
    const values = {
      name: this.old("name"),
      description: this.old("description"),
      status: this.old("status", "planning"),
    };

    return (
      <div class="max-w-2xl">
        <PageHeader title="New project" back={{ href: route("projects"), label: "Projects" }} />
        <ProjectForm values={values} errors={(field) => this.error(field)} />
      </div>
    );
  }
}
