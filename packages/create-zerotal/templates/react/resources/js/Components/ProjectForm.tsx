import type { FormEvent } from "react";
import { Link, useForm } from "@inertiajs/react";
import { Button } from "./Button";
import { Card, CardBody, CardFooter } from "./Card";
import { SelectField, TextAreaField, TextField } from "./Field";
import type { Project } from "../types";

export const STATUS_OPTIONS = [
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
] as const;

/**
 * The create and edit form, which differ only in where they send the data and what
 * the button says. Part of the example resource.
 */
export function ProjectForm({ project }: { project?: Project | undefined }) {
  const form = useForm({
    name: project?.name ?? "",
    description: project?.description ?? "",
    status: project?.status ?? "planning",
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (project) form.put(route("projects.update", { project: project.id }));
    else form.post(route("projects.store"));
  }

  return (
    <Card>
      <form onSubmit={submit}>
        <CardBody className="space-y-5">
          <TextField
            label="Name"
            autoFocus
            value={form.data.name}
            error={form.errors.name}
            onChange={(e) => form.setData("name", e.target.value)}
            required
          />
          <TextAreaField
            label="Description"
            hint="Optional. What it is, and what done looks like."
            rows={4}
            value={form.data.description}
            error={form.errors.description}
            onChange={(e) => form.setData("description", e.target.value)}
          />
          <SelectField
            label="Status"
            options={STATUS_OPTIONS}
            value={form.data.status}
            error={form.errors.status}
            onChange={(e) => form.setData("status", e.target.value as typeof form.data.status)}
          />
        </CardBody>
        <CardFooter>
          <Link
            href={route("projects")}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={form.processing}>
            {form.processing ? "Saving…" : project ? "Save changes" : "Create project"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
