import type { ReactNode } from "react";
import { Head, Link, useForm } from "@inertiajs/react";
import AppShell from "../../Layouts/AppShell";
import PageHeader from "../../Components/PageHeader";
import { SelectField, TextAreaField, TextField } from "../../Components/Field";
import { Button } from "../../Components/Button";
import { endpoint } from "../../lib/endpoint";
import { usePrecognition } from "../../lib/precognition";

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

  const target = editing
    ? endpoint("projects.issues.edit.store", { project: project.slug, issue: issue.id })
    : endpoint("projects.issues.new.store", { project: project.slug });

  const precog = usePrecognition(target.url, target.method);

  /**
   * The body both paths send.
   *
   * Precognition is only worth anything if it validates the *same* request the
   * submit will make. The `assigneeId` normalisation below is the one place the
   * two could drift — send `""` to the live check and it reports "must be a
   * number" on a field the reader left alone, for a submit that would have
   * succeeded.
   */
  const payload = () => ({
    ...form.data,
    assigneeId:
      form.data.assigneeId === "" || form.data.assigneeId == null
        ? null
        : Number(form.data.assigneeId),
  });

  /**
   * Check one field when the reader leaves it.
   *
   * On blur rather than on each keystroke, and that is a judgement rather than a
   * saving: the title rule is `min(3)`, so per-keystroke validation says "too
   * short" while somebody types the first two characters of a valid title. A
   * rule that is *going* to be satisfied should not be enforced mid-word. The
   * `flow` build binds its title `live` for the same reason it can afford to —
   * there the round trip is a frame on a socket that is already open.
   *
   * Skipped while a real submit is in flight: the submit's own errors are
   * authoritative and land in `form.errors` a moment later.
   */
  const check = (field: string) => {
    if (form.processing) return;
    void precog.validate(field, payload());
  };

  /** Whichever error is current — the submit's if there is one, else the live check's. */
  const errorFor = (field: keyof typeof form.errors) =>
    form.errors[field] ?? precog.errors[field as string];

  return (
    <>
      <Head title={editing ? `Edit #${issue.id}` : "New issue"} />

      <nav aria-label={__("Breadcrumb")} className="mb-2 text-xs text-muted-foreground">
        <Link href={route("projects")} className="transition-colors hover:text-foreground">
          {__("Projects")}
        </Link>
        <span aria-hidden="true" className="px-1.5">
          /
        </span>
        <Link
          href={route("projects.show", { project: project.slug })}
          className="transition-colors hover:text-foreground"
        >
          {project.name}
        </Link>
        <span aria-hidden="true" className="px-1.5">
          /
        </span>
        <span className="text-foreground">{editing ? `#${issue.id}` : __("New issue")}</span>
      </nav>

      <PageHeader
        title={editing ? __("Edit issue") : __("New issue")}
        description={editing ? __("Change the details and save.") : __("Describe what is wrong, and who should pick it up.")}
      />

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
          form.submit(target.method, target.url, { preserveScroll: true });
        }}
        className="mt-6 max-w-2xl space-y-5 rounded-xl border border-border bg-card p-5 sm:p-6"
      >
        <TextField
          label={__("Title")}
          name="title"
          value={form.data.title}
          error={errorFor("title")}
          hint={
            precog.validating === "title"
              ? __("Checking…")
              : __("Short and actionable — what is wrong, in one line.")
          }
          onChange={(event) => {
            form.setData("title", event.target.value);
            // Clear a stale live error as soon as the reader edits: leaving "too
            // short" on screen while they fix it is the complaint people have
            // about live validation, and it costs one call to avoid.
            precog.clear("title");
          }}
          onBlur={() => check("title")}
          autoFocus
        />

        <TextAreaField
          label={__("Description")}
          name="body"
          value={form.data.body}
          error={form.errors.body}
          hint={__("Markdown. What happens, and what you expected instead.")}
          onChange={(event) => form.setData("body", event.target.value)}
        />

        <div className="grid gap-5 sm:grid-cols-3">
          <SelectField
            label={__("Status")}
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
            label={__("Priority")}
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
            label={__("Assignee")}
            name="assigneeId"
            value={String(form.data.assigneeId ?? "")}
            error={form.errors.assigneeId}
            onChange={(event) => form.setData("assigneeId", event.target.value)}
          >
            <option value="">{__("Unassigned")}</option>
            {options.assignees.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="flex items-center gap-3 border-t border-border pt-5">
          <Button type="submit" disabled={form.processing}>
            {form.processing
              ? __("Saving…")
              : editing
                ? __("Save changes")
                : __("Create issue")}
          </Button>
          <Link
            href={
              editing
                ? route("projects.issues.show", { project: project.slug, issue: issue.id })
                : route("projects.show", { project: project.slug })
            }
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {__("Cancel")}
          </Link>
        </div>
      </form>
    </>
  );
}

IssueForm.layout = (page: ReactNode) => <AppShell>{page}</AppShell>;
