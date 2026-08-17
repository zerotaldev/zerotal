import type { FC } from "zerotal/view";

/**
 * The UI vocabulary, in this build's idiom.
 *
 * The same names and the same classes as the Inertia build's components, because
 * the visual contract is shared even though the code cannot be — one returns
 * React elements, this returns an HTML string. Keeping the class strings
 * identical is what makes a screenshot comparison between the two meaningful.
 */

export const PageHeader: FC<{ title: string; description?: string | undefined; actions?: unknown }> = ({
  title,
  description,
  actions,
}) => (
  <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
    <div class="min-w-0">
      <h1 class="text-2xl font-semibold tracking-tight text-balance text-foreground">{title}</h1>
      {description ? <p class="mt-1 text-sm text-muted-foreground">{description}</p> : null}
    </div>
    {actions ? <div class="flex shrink-0 items-center gap-2">{actions}</div> : null}
  </div>
);

const BUTTON =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium whitespace-nowrap transition-colors";

export const buttonClass = (variant: "primary" | "secondary" = "primary"): string =>
  `${BUTTON} ${
    variant === "primary"
      ? "bg-primary text-primary-foreground hover:bg-primary-hover"
      : "border border-input bg-card text-foreground hover:bg-muted"
  }`;

export const Card: FC<{ class?: string | undefined; children?: unknown }> = ({ class: cls, children }) => (
  <div class={`rounded-xl border border-border bg-card ${cls ?? ""}`}>{children}</div>
);

export const EmptyState: FC<{ title: string; description: string; action?: unknown }> = ({
  title,
  description,
  action,
}) => (
  <div class="flex flex-col items-center justify-center px-6 py-14 text-center">
    <h3 class="text-sm font-semibold text-foreground">{title}</h3>
    <p class="mt-1 max-w-sm text-sm text-pretty text-muted-foreground">{description}</p>
    {action ? <div class="mt-5">{action}</div> : null}
  </div>
);

const STATUS: Record<string, string> = {
  backlog: "bg-muted text-muted-foreground",
  todo: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  in_progress: "bg-primary/12 text-primary",
  done: "bg-success/15 text-success",
  cancelled: "bg-muted text-muted-foreground line-through",
};

const PRIORITY: Record<string, string> = {
  urgent: "bg-destructive/12 text-destructive",
  high: "bg-orange-500/12 text-orange-700 dark:text-orange-300",
  medium: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  low: "bg-muted text-muted-foreground",
};

/**
 * Stored value → the English word for it.
 *
 * `in_progress` is a database enum, not a sentence, so it cannot be handed to
 * `__()` directly. These are the step before translation — schema to English —
 * and callers translate the result. An unknown value falls through to itself, so
 * a status added server-side still renders.
 */
export const STATUS_LABEL: Record<string, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

export const PRIORITY_LABEL: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const SORT_LABEL: Record<string, string> = {
  newest: "Newest",
  oldest: "Oldest",
  priority: "Priority",
  title: "Title",
};

const BADGE =
  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export const StatusBadge: FC<{ status: string; label: string }> = ({ status, label }) => (
  <span class={`${BADGE} ${STATUS[status] ?? STATUS["backlog"]}`}>{label}</span>
);

export const PriorityBadge: FC<{ priority: string; label: string }> = ({ priority, label }) => (
  <span class={`${BADGE} ${PRIORITY[priority] ?? PRIORITY["low"]}`}>
    {priority === "urgent" || priority === "high" ? (
      <span aria-hidden="true" class="size-1.5 rounded-full bg-current" />
    ) : null}
    {label}
  </span>
);

/** A label chip. `colour` is a token name from the seed, never a hex. */
const LABEL_COLOURS: Record<string, string> = {
  sky: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  violet: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  amber: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  emerald: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  rose: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
  zinc: "bg-muted text-muted-foreground",
};

export const LabelChip: FC<{ name: string; colour: string }> = ({ name, colour }) => (
  <span class={`${BADGE} ${LABEL_COLOURS[colour] ?? LABEL_COLOURS["zinc"]}`}>{name}</span>
);

/** A labelled input, with the error and hint plumbing the Inertia build's Field does. */
export const Field: FC<{
  label: string;
  name: string;
  type?: string | undefined;
  value?: string | undefined;
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean | undefined;
  autocomplete?: string | undefined;
}> = ({ label, name, type = "text", value, error, hint, required, autocomplete }) => (
  <div class="space-y-1.5">
    <label for={name} class="block text-sm font-medium text-foreground">
      {label}
    </label>
    <input
      id={name}
      name={name}
      type={type}
      value={value ?? ""}
      required={required}
      autocomplete={autocomplete}
      aria-invalid={error ? "true" : undefined}
      aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
      class={`h-10 w-full rounded-md border bg-card px-3 text-sm text-foreground transition-[border-color,box-shadow] focus:border-ring focus:ring-2 focus:ring-ring/15 focus:outline-none ${
        error ? "border-destructive" : "border-input"
      }`}
    />
    {error ? (
      <p id={`${name}-error`} role="alert" class="text-sm text-destructive">
        {error}
      </p>
    ) : hint ? (
      <p id={`${name}-hint`} class="text-xs text-muted-foreground">
        {hint}
      </p>
    ) : null}
  </div>
);
