import type { FC } from "zerotal/view";
import { Field, buttonClass } from "./Ui.tsx";
import { PRIORITY_LABEL, STATUS_LABEL } from "./Ui.tsx";

export interface IssueFormValues {
  title: string;
  body: string;
  status: string;
  priority: string;
  assigneeId: number | null;
}

interface IssueFormProps extends Record<string, unknown> {
  action: string;
  cancelHref: string;
  submitLabel: string;
  values: IssueFormValues;
  errors: Record<string, string>;
  statuses: readonly string[];
  priorities: readonly string[];
  assignees: { id: number; name: string }[];
}

const SELECT =
  "h-10 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground focus:border-ring focus:ring-2 focus:ring-ring/15 focus:outline-none";

/**
 * The create and edit forms, which are one form.
 *
 * Same split as the Inertia build, where both routes render `issues/form.tsx` —
 * two screens that drift apart is how a field ends up editable but not settable.
 * What differs here is only the transport: a plain `<form method="post">` whose
 * `action` the caller supplies, so the same markup posts to `new` or to `edit`.
 *
 * Errors and previous input come from the session rather than from component
 * state. A rejected submit redirects back, and `old` repopulates the fields —
 * which is why nothing here needs a script to survive a validation failure.
 */
export const IssueForm: FC<IssueFormProps> = ({
  action,
  cancelHref,
  submitLabel,
  values,
  errors,
  statuses,
  priorities,
  assignees,
}) => (
  <form method="post" action={action} class="space-y-5">
    <Field
      label={__("Title")}
      name="title"
      value={values.title}
      error={errors["title"]}
      hint={__("Short and actionable — what is wrong, in one line.")}
      required
    />

    <div class="space-y-1.5">
      <label for="body" class="block text-sm font-medium text-foreground">
        {__("Description")}
      </label>
      <textarea
        id="body"
        name="body"
        rows="8"
        aria-invalid={errors["body"] ? "true" : undefined}
        class={`w-full rounded-md border bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:ring-2 focus:ring-ring/15 focus:outline-none ${
          errors["body"] ? "border-destructive" : "border-input"
        }`}
      >
        {values.body}
      </textarea>
      {errors["body"] ? (
        <p role="alert" class="text-sm text-destructive">
          {errors["body"]}
        </p>
      ) : (
        <p class="text-xs text-muted-foreground">
          {__("Markdown. What happens, and what you expected instead.")}
        </p>
      )}
    </div>

    <div class="grid gap-4 sm:grid-cols-3">
      <div class="space-y-1.5">
        <label for="status" class="block text-sm font-medium text-foreground">
          {__("Status")}
        </label>
        <select id="status" name="status" class={SELECT}>
          {statuses.map((status) => (
            <option value={status} selected={values.status === status}>
              {__(STATUS_LABEL[status] ?? status)}
            </option>
          ))}
        </select>
      </div>

      <div class="space-y-1.5">
        <label for="priority" class="block text-sm font-medium text-foreground">
          {__("Priority")}
        </label>
        <select id="priority" name="priority" class={SELECT}>
          {priorities.map((priority) => (
            <option value={priority} selected={values.priority === priority}>
              {__(PRIORITY_LABEL[priority] ?? priority)}
            </option>
          ))}
        </select>
      </div>

      <div class="space-y-1.5">
        <label for="assigneeId" class="block text-sm font-medium text-foreground">
          {__("Assignee")}
        </label>
        {/* An empty value posts `""`, which `StoreIssueRequest` accepts as
            nullable — the rule is written for exactly this, because an
            unselected `<select>` has no other way to say "nobody". */}
        <select id="assigneeId" name="assigneeId" class={SELECT}>
          <option value="" selected={values.assigneeId === null}>
            {__("Unassigned")}
          </option>
          {assignees.map((person) => (
            <option value={String(person.id)} selected={values.assigneeId === person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <button type="submit" class={buttonClass("primary")}>
        {submitLabel}
      </button>
      <a href={cancelHref} class={buttonClass("secondary")}>
        {__("Cancel")}
      </a>
    </div>
  </form>
);
