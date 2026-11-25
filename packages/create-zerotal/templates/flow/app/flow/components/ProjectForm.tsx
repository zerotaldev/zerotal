import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import type { Project } from "@app/models/Project";
import { Button } from "./Button";
import { Card, CardBody, CardFooter } from "./Card";
import { SelectField, TextAreaField, TextField } from "./Field";

export const STATUS_OPTIONS = [
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
] as const;

/**
 * The create and edit form, which differ only in where they send the data and what the
 * button says. Part of the example resource.
 *
 * `values` is what to show in the fields: the project's own, or what was typed before a
 * failed post. `errors` is `this.error` from the page.
 */
export function ProjectForm({
  project,
  values,
  errors,
}: {
  project?: Project | undefined;
  values: { name: string; description: string; status: string };
  errors: (field: string) => string | undefined;
}): HtmlNode {
  // Creating posts; editing is a PUT, which a browser form can't send on its own, so
  // resources/js/lib/forms.ts sends it (see `data-method`).
  const action = project
    ? route("projects.update", { project: project.id })
    : route("projects.store");

  return (
    <Card>
      <form method="post" action={action} data-method={project ? "put" : undefined}>
        <CardBody class="space-y-5">
          <TextField
            label="Name"
            name="name"
            autofocus
            value={values.name}
            error={errors("name")}
            required
          />
          <TextAreaField
            label="Description"
            name="description"
            hint="Optional. What it is, and what done looks like."
            rows="4"
            value={values.description}
            error={errors("description")}
          />
          <SelectField
            label="Status"
            name="status"
            options={STATUS_OPTIONS}
            value={values.status}
            error={errors("status")}
          />
        </CardBody>
        <CardFooter>
          <a
            href={route("projects")}
            class="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </a>
          <Button type="submit" data-loading-text="Saving…">
            {project ? "Save changes" : "Create project"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
