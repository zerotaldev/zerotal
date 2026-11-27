import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { ProjectForm } from "../../components/ProjectForm";
import { AppLayout } from "../../layouts/AppLayout";
import { Page, titled } from "../../lib/page";
import { PAGE_HEADER, PAGE_HEADER_BACK, PAGE_HEADER_ROW, PAGE_TITLE, icon } from "../../lib/ui";

/** GET /projects/create. The form posts to app/routes/(auth)/(verified)/projects/index.ts. */
export class CreateProjectPage extends Page {
  static override title = titled("New project");

  override layout(page: HtmlNode): HtmlNode {
    return <AppLayout shell={this.shell()}>{page}</AppLayout>;
  }

  override async render(): Promise<HtmlNode> {
    const values = {
      name: this.old("name"),
      description: this.old("description"),
      status: this.old("status", "planning"),
    };
    const errors = {
      name: this.error("name"),
      description: this.error("description"),
      status: this.error("status"),
    };

    return (
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
              <h1 class={PAGE_TITLE}>New project</h1>
            </div>
          </div>
        </header>
        <ProjectForm
          action={route("projects.store")}
          values={values}
          errors={errors}
          submit="Create project"
        />
      </div>
    );
  }
}
