import { cn } from "../lib/cn";

/**
 * Status and priority, as the one place their colours are decided.
 *
 * Colour here is signal, not decoration: it is the only thing that lets you scan
 * a list of twenty issues and find the urgent one. Every other surface in the app
 * stays neutral so these keep meaning something.
 *
 * The maps are keyed by the exact values `ISSUE_STATUSES` / `ISSUE_PRIORITIES`
 * ship, so a status the server has never heard of cannot render — it falls
 * through to the neutral style rather than inventing a colour.
 */

const BASE =
  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const STATUS: Record<string, string> = {
  backlog: "bg-muted text-muted-foreground",
  todo: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  in_progress: "bg-primary/12 text-primary",
  done: "bg-success/15 text-success",
  cancelled: "bg-muted text-muted-foreground line-through",
};

/**
 * Stored value → the English word for it.
 *
 * `in_progress` is a database enum, not a sentence, so it cannot be handed to
 * `__()` directly. These maps are the one translation step that has to happen
 * before translation: schema to English, then English to whatever the reader
 * speaks. An unknown value falls through to itself, so a status added
 * server-side renders as its raw name rather than vanishing.
 *
 * This replaces a `label === key` probe that used to ask the catalog whether it
 * had heard of `status.done`. There is nothing left to probe: an untranslated
 * string comes back as the English it started as.
 */
export const STATUS_LABEL: Record<string, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

const PRIORITY: Record<string, string> = {
  urgent: "bg-destructive/12 text-destructive",
  high: "bg-orange-500/12 text-orange-700 dark:text-orange-300",
  medium: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  low: "bg-muted text-muted-foreground",
};

const PRIORITY_LABEL: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn(BASE, STATUS[status] ?? STATUS["backlog"])}>
      {__(STATUS_LABEL[status] ?? status)}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  // Urgent and high get a dot as well as a colour — colour alone is not a signal
  // for everyone, and these are the two rows you are meant to notice.
  const loud = priority === "urgent" || priority === "high";

  return (
    <span className={cn(BASE, PRIORITY[priority] ?? PRIORITY["low"])}>
      {loud && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      {__(PRIORITY_LABEL[priority] ?? priority)}
    </span>
  );
}

/** A label chip. `colour` is a token name from the seed, never a hex. */
const LABEL_COLOURS: Record<string, string> = {
  sky: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  violet: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  amber: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  emerald: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  rose: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
  zinc: "bg-muted text-muted-foreground",
};

export function LabelChip({ name, colour }: { name: string; colour: string }) {
  return <span className={cn(BASE, LABEL_COLOURS[colour] ?? LABEL_COLOURS["zinc"])}>{name}</span>;
}
