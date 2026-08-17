/**
 * The shared vocabulary, as class-name constants.
 *
 * The other two builds put these in components — `<Button>`, `<Card>`, `<Field>`.
 * Here they are strings, because a Flow page's `render()` is compiled ahead of
 * time and the cheapest thing to share between compiled templates is a class
 * list. The tokens are the same ones the other builds use (`bg-card`,
 * `text-muted-foreground`, `border-border`), so all three read as one product.
 */

export const CARD = "rounded-xl border border-border bg-card";

export const BUTTON =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium whitespace-nowrap transition-colors disabled:opacity-60";

export const PRIMARY = `${BUTTON} bg-primary text-primary-foreground hover:bg-primary-hover`;

export const SECONDARY = `${BUTTON} border border-input bg-card text-foreground hover:bg-muted`;

export const GHOST = `${BUTTON} text-muted-foreground hover:bg-muted hover:text-foreground`;

export const LABEL = "block text-sm font-medium text-foreground";

export const FIELD =
  "h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground transition-[border-color,box-shadow] focus:border-ring focus:ring-2 focus:ring-ring/15 focus:outline-none";

export const TEXTAREA =
  "w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:ring-2 focus:ring-ring/15 focus:outline-none";

export const SELECT =
  "h-9 rounded-md border border-input bg-card px-2 text-sm text-foreground focus:border-ring focus:ring-2 focus:ring-ring/15 focus:outline-none";

export const ERROR = "text-sm text-destructive";

export const BADGE =
  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap";

/**
 * Stored value → the English word for it.
 *
 * `in_progress` is a database enum, not a sentence, so it cannot be handed to
 * `__()` directly. This is the step before translation — schema to English — and
 * callers translate the result. Identical to the maps the other two builds keep,
 * because it is the same domain.
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

export const STATUS_TONE: Record<string, string> = {
  backlog: "bg-muted text-muted-foreground",
  todo: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  in_progress: "bg-primary/12 text-primary",
  done: "bg-success/15 text-success",
  cancelled: "bg-muted text-muted-foreground line-through",
};

export const PRIORITY_TONE: Record<string, string> = {
  urgent: "bg-destructive/12 text-destructive",
  high: "bg-orange-500/12 text-orange-700 dark:text-orange-300",
  medium: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  low: "bg-muted text-muted-foreground",
};

export const LABEL_TONE: Record<string, string> = {
  sky: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  violet: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  amber: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  emerald: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  rose: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
  zinc: "bg-muted text-muted-foreground",
};

/** Bytes → something a person reads. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
