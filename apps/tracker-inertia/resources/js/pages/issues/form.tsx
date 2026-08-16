import { Head, Link, useForm } from "@inertiajs/react";
import TrackerLayout from "../../Layouts/TrackerLayout";
import { SelectField, TextAreaField, TextField } from "../../Components/Field";
import { Button } from "../../Components/Button";

interface Props {
  project: { name: string; slug: string };
  issue: {
    id: number;
    title: string;
    body: string;
    status: string;
    priority: string;
    assigneeId: number | null;
  } | null;
  options: {
    statuses: readonly string[];
    priorities: readonly string[];
    assignees: { id: number; name: string }[];
  };
}

/**
 * Create and edit, one component — feature 4.
 *
 * The two differ only in where they post and what they start from, and keeping
 * them together is what stops "the edit form validates but the create form does
 * not" from ever being true.
 *
 * `useForm` holds the values and reads `errors` from Inertia's shared error bag,
 * which the server fills by throwing out of `validate()`. That is the whole
 * mechanism: no client-side rules to keep in step with the server's, so the two
 * cannot disagree. The cost is a round trip per attempt, which is the trade the
 * `flow` build will not have to make — and the difference the recipe is about.
 */
export default function IssueForm({ project, issue, options }: Props) {
  const editing = issue !== null;

  const form = useForm({
    title: issue?.title ?? "",
    body: issue?.body ?? "",
    status: issue?.status ?? "backlog",
    priority: issue?.priority ?? "medium",
    assigneeId: issue?.assigneeId ?? "",
  });

  const action = editing
    ? `/projects/${project.slug}/issues/${issue.id}/edit`
    : `/projects/${project.slug}/issues/new`;

  return (
    <>
      <Head title={editing ? `Edit #${issue.id}` : "New issue"} />

      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/projects" className="hover:text-foreground">
          Projects
        </Link>
        <span aria-hidden="true" className="px-1.5">
          /
        </span>
        <Link href={`/projects/${project.slug}`} className="hover:text-foreground">
          {project.name}
        </Link>
        <span aria-hidden="true" className="px-1.5">
          /
        </span>
        <span className="text-foreground">{editing ? `#${issue.id}` : "New issue"}</span>
      </nav>

      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {editing ? "Edit issue" : "New issue"}
      </h1>

      <form
        // `post` for both, because the `view` build reaches this from a plain
        // <form>, and a form without JavaScript can send GET or POST and nothing
        // else. Using the verb all three builds can reach keeps one route table.
        onSubmit={(event) => {
          event.preventDefault();
          // An unselected <select> sends "", and "" is not a number — the rule
          // rejects it and the reader gets "must be a number" on a field they
          // never touched. Normalised to null, which is what "unassigned" means.
          //
          // Idempotent on purpose. A transform stays registered, so after a
          // failed submit the retry runs it over data it has already converted:
          // the first pass turned "" into null, and a second `Number(null)`
          // would be 0 — an assignee id that belongs to nobody. Every retry
          // after a validation error hit that.
          form.transform((data) => ({
            ...data,
            assigneeId:
              data.assigneeId === "" || data.assigneeId == null ? null : Number(data.assigneeId),
          }));
          form.post(action, { preserveScroll: true });
        }}
        className="mt-6 max-w-2xl space-y-5 rounded-xl border border-border bg-card p-5"
      >
        <TextField
          label="Title"
          name="title"
          value={form.data.title}
          error={form.errors.title}
          hint="Short and actionable — what is wrong, in one line."
          onChange={(event) => form.setData("title", event.target.value)}
          autoFocus
        />

        <TextAreaField
          label="Description"
          name="body"
          value={form.data.body}
          error={form.errors.body}
          hint="Markdown. What happens, and what you expected instead."
          onChange={(event) => form.setData("body", event.target.value)}
        />

        <div className="grid gap-5 sm:grid-cols-3">
          <SelectField
            label="Status"
            name="status"
            value={form.data.status}
            error={form.errors.status}
            onChange={(event) => form.setData("status", event.target.value)}
          >
            {options.statuses.map((status) => (
              <option key={status} value={status}>
                {status.replace("_", " ")}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Priority"
            name="priority"
            value={form.data.priority}
            error={form.errors.priority}
            onChange={(event) => form.setData("priority", event.target.value)}
          >
            {options.priorities.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Assignee"
            name="assigneeId"
            value={String(form.data.assigneeId ?? "")}
            error={form.errors.assigneeId}
            onChange={(event) => form.setData("assigneeId", event.target.value)}
          >
            <option value="">Unassigned</option>
            {options.assignees.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="flex items-center gap-3 border-t border-border pt-5">
          <Button type="submit" disabled={form.processing}>
            {form.processing ? "Saving…" : editing ? "Save changes" : "Create issue"}
          </Button>
          <Link
            href={
              editing ? `/projects/${project.slug}/issues/${issue.id}` : `/projects/${project.slug}`
            }
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}

IssueForm.layout = (page: React.ReactNode) => <TrackerLayout>{page}</TrackerLayout>;
