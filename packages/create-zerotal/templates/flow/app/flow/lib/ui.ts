import { ICONS, type IconName } from "./icons";

/**
 * The class lists the app's markup is built from, in one place.
 *
 * The components in app/flow/components/ use them, and so do the pages. A page writes its
 * markup out element by element rather than calling those components, because Flow compiles a
 * page's render() ahead of time and a compiled render() cannot call one (see "Where things live"
 * in the README). Writing `class={CARD}` instead of `<Card>` keeps both looking the same.
 *
 * Keep each constant a plain string, built only from strings and the constants above it: the
 * compiler reads them out of this file, which it cannot do through a call or an import.
 */

// ── Cards ────────────────────────────────────────────────────────────────────

export const CARD = "surface rounded-xl";
export const CARD_INTERACTIVE =
  CARD +
  " transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/40";
export const CARD_ICON =
  "grid size-10 place-items-center rounded-lg border border-border bg-accent text-accent-foreground";
export const CARD_HEADER =
  "flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:pt-6";
export const CARD_TITLE = "text-base font-semibold text-card-foreground";
export const CARD_DESCRIPTION = "mt-1 text-sm text-muted-foreground";
export const CARD_ACTIONS = "flex shrink-0 items-center gap-2";
export const CARD_BODY = "px-5 py-5 sm:px-6";
export const CARD_FOOTER =
  "flex flex-wrap items-center justify-end gap-3 rounded-b-xl border-t border-border bg-muted/40 px-5 py-3 sm:px-6";

// ── Form fields ──────────────────────────────────────────────────────────────

export const FIELD = "space-y-1.5";
export const FIELD_LABEL_ROW = "flex items-baseline justify-between gap-3";
export const LABEL = "block text-sm font-medium text-foreground";
export const FIELD_ERROR = "text-sm text-destructive";
export const FIELD_HINT = "text-sm text-muted-foreground";

export const CONTROL =
  "w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground shadow-xs " +
  "transition-colors placeholder:text-muted-foreground focus:outline-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
  "disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive";
export const CONTROL_BORDER = "border-input";
export const INPUT = CONTROL + " " + CONTROL_BORDER;
export const TEXTAREA = INPUT + " resize-y";
export const SELECT = INPUT + " appearance-none pr-9";
export const SELECT_CHEVRON =
  "pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground";

export const CHECKBOX_ROW = "flex items-start gap-2.5";
export const CHECKBOX = "mt-0.5 size-4 shrink-0 rounded border-input accent-primary";
export const CHECKBOX_LABEL = "font-medium text-foreground";

// ── Page header, empty state, code ───────────────────────────────────────────

export const PAGE_HEADER = "mb-8";
export const PAGE_HEADER_BACK =
  "mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground";
export const PAGE_HEADER_ROW = "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between";
export const PAGE_TITLE = "text-2xl font-bold tracking-tight text-balance sm:text-3xl";
export const PAGE_DESCRIPTION = "mt-1.5 text-muted-foreground";
export const PAGE_ACTIONS = "flex shrink-0 flex-wrap gap-2";

export const EMPTY_STATE =
  "flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-12 text-center";
export const EMPTY_ICON =
  "grid size-12 place-items-center rounded-xl border border-border bg-accent text-accent-foreground";
export const EMPTY_TITLE = "mt-4 text-base font-semibold";
export const EMPTY_DESCRIPTION = "mt-1.5 max-w-sm text-sm text-pretty text-muted-foreground";

export const CODE =
  "rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground";
export const COMMAND =
  "flex items-center gap-3 rounded-lg border border-border bg-muted px-3.5 py-2.5 font-mono text-sm";

export const DIVIDER =
  "flex items-center gap-3 text-xs tracking-wide text-muted-foreground uppercase";
export const DIVIDER_LINE = "h-px flex-1 bg-border";

export const LINK = "font-medium text-primary hover:underline";

// ── Dialogs ──────────────────────────────────────────────────────────────────

export const MODAL =
  "m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-border bg-card p-0 text-card-foreground shadow-2xl " +
  "backdrop:bg-black/50 backdrop:backdrop-blur-[2px]";
export const MODAL_CLOSE =
  "-m-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
export const MODAL_FOOTER =
  "flex flex-col-reverse gap-2 rounded-b-2xl border-t border-border bg-muted/40 px-5 py-3 sm:flex-row sm:justify-end sm:px-6";
export const DIALOG_BUTTONS = "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end";

// ── Pagination ───────────────────────────────────────────────────────────────

export const PAGE_LINK =
  "inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium transition-colors";
export const PAGE_LINK_ON = PAGE_LINK + " bg-card hover:bg-muted";
export const PAGE_LINK_OFF = PAGE_LINK + " pointer-events-none opacity-50";

// ── Tones ────────────────────────────────────────────────────────────────────

export type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger";

const BADGE =
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  primary: "border-primary/25 bg-accent text-accent-foreground",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
};

/** A badge's classes: `<span class={badgeClass("success")}>Enabled</span>`. */
export function badgeClass(tone: BadgeTone = "neutral", extra?: string): string {
  return [BADGE, BADGE_TONES[tone], extra].filter(Boolean).join(" ");
}

export type AlertTone = "info" | "success" | "warning" | "danger";

const ALERT_TONES: Record<AlertTone, string> = {
  info: "border-border bg-muted/50 text-foreground",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
};

/** The icon an alert of each tone shows. */
export const ALERT_ICON: Record<AlertTone, IconName> = {
  info: "info",
  success: "check",
  warning: "alert",
  danger: "alert",
};

/** An alert box's classes. */
export function alertClass(tone: AlertTone, extra?: string): string {
  return ["flex gap-3 rounded-xl border p-4", ALERT_TONES[tone], extra].filter(Boolean).join(" ");
}

/** Danger and warning alerts are announced; the others are read in turn. */
export function alertRole(tone: AlertTone): "alert" | undefined {
  return tone === "danger" || tone === "warning" ? "alert" : undefined;
}

export const ALERT_ICON_CLASS = "mt-0.5 size-5 shrink-0";
export const ALERT_BODY = "min-w-0 flex-1 text-sm";
export const ALERT_TITLE = "font-semibold";
export const ALERT_TEXT = "text-foreground/80";
export const ALERT_TEXT_UNDER_TITLE = "mt-1 text-foreground/80";

// ── Icons ────────────────────────────────────────────────────────────────────

/**
 * An icon's markup, for `<svg viewBox="0 0 24 24" aria-hidden="true" class="size-4"
 * dangerouslySetInnerHTML={icon("plus")} />`. Outline icons are stroked with `currentColor`,
 * the brand marks filled with it; the group carries that, so the `<svg>` around it needs nothing
 * but its size. The markup is lib/icons.ts's own, never user input.
 */
export function icon(name: IconName): { __html: string } {
  const { brand, body } = ICONS[name];
  return {
    __html: brand
      ? `<g fill="currentColor">${body}</g>`
      : `<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</g>`,
  };
}
