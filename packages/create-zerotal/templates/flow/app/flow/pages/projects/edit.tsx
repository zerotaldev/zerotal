import { route } from "zerotal";
import { Gate } from "zerotal/auth";
import type { HtmlNode } from "@zerotal/flow";
import type { Project } from "@app/models/Project";
import { AppLayout } from "../../layouts/AppLayout";
import { buttonClass } from "../../lib/button";
import { STATUS_OPTIONS } from "../../lib/projects";
import { Page } from "../../lib/page";
import { appName } from "../../lib/site";
import {
  CARD,
  CARD_BODY,
  CARD_FOOTER,
  FIELD,
  FIELD_ERROR,
  FIELD_HINT,
  FIELD_LABEL_ROW,
  INPUT,
  LABEL,
  PAGE_DESCRIPTION,
  PAGE_HEADER,
  PAGE_HEADER_BACK,
  PAGE_HEADER_ROW,
  PAGE_TITLE,
  SELECT,
  SELECT_CHEVRON,
  TEXTAREA,
  icon,
} from "../../lib/ui";

/*
 * The form is written out here and in edit.tsx rather than shared as a component. Flow compiles
 * a page ahead of time only when its render() is plain HTML elements; a component such as a
 * shared <ProjectForm /> would send the page through the runtime fallback, which `cspSafe`
 * refuses. Change one form, change the other.
 */
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
    const nameError = this.error("name");
    const descriptionError = this.error("description");
    const statusError = this.error("status");

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
            <div class={CARD}>
              <form
                method="post"
                action={route("projects.update", { project: project.id })}
                data-method="put"
              >
                <div class={`${CARD_BODY} space-y-5`}>
                  <div class={FIELD}>
                    <div class={FIELD_LABEL_ROW}>
                      <label for="field-name" class={LABEL}>
                        Name
                      </label>
                    </div>
                    <input
                      class={INPUT}
                      autofocus
                      value={values.name}
                      required
                      id="field-name"
                      name="name"
                      aria-invalid={nameError ? "true" : undefined}
                      aria-describedby={nameError ? "field-name-error" : undefined}
                    />
                    <p
                      id="field-name-error"
                      data-error-for="name"
                      class={FIELD_ERROR}
                      hidden={!nameError}
                    >
                      {nameError}
                    </p>
                  </div>
                  <div class={FIELD}>
                    <div class={FIELD_LABEL_ROW}>
                      <label for="field-description" class={LABEL}>
                        Description
                      </label>
                    </div>
                    <textarea
                      class={TEXTAREA}
                      rows="4"
                      id="field-description"
                      name="description"
                      aria-invalid={descriptionError ? "true" : undefined}
                      aria-describedby={
                        descriptionError ? "field-description-error" : "field-description-hint"
                      }
                    >
                      {values.description}
                    </textarea>
                    <p
                      id="field-description-error"
                      data-error-for="description"
                      class={FIELD_ERROR}
                      hidden={!descriptionError}
                    >
                      {descriptionError}
                    </p>
                    <p
                      id="field-description-hint"
                      data-hint-for="description"
                      class={FIELD_HINT}
                      hidden={Boolean(descriptionError)}
                    >
                      Optional. What it is, and what done looks like.
                    </p>
                  </div>
                  <div class={FIELD}>
                    <div class={FIELD_LABEL_ROW}>
                      <label for="field-status" class={LABEL}>
                        Status
                      </label>
                    </div>
                    <div class="relative">
                      <select
                        class={SELECT}
                        id="field-status"
                        name="status"
                        aria-invalid={statusError ? "true" : undefined}
                        aria-describedby={statusError ? "field-status-error" : undefined}
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option value={option.value} selected={option.value === values.status}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        class={SELECT_CHEVRON}
                        dangerouslySetInnerHTML={icon("chevron-down")}
                      />
                    </div>
                    <p
                      id="field-status-error"
                      data-error-for="status"
                      class={FIELD_ERROR}
                      hidden={!statusError}
                    >
                      {statusError}
                    </p>
                  </div>
                </div>
                <div class={CARD_FOOTER}>
                  <a
                    href={route("projects")}
                    class="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </a>
                  <button
                    type="submit"
                    class={buttonClass("primary", "md")}
                    data-loading-text="Saving…"
                  >
                    Save changes
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : (
          <div />
        )}
      </>
    );
  }
}
