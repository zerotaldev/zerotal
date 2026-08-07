/** @jsxImportSource @zerotal/flow */
// ── <DatePicker> ────────────────────────────────────────────────────────────
//
// A calendar in a popover, behind a button showing the chosen date. Composed
// from <Popover> and <Calendar> rather than reimplementing either.
//
// Worth having alongside the native `<input type="date">`, which is genuinely
// fine for a date of birth: the native control cannot show which days already
// have bookings, cannot mark a range as unavailable, and looks different in every
// browser. When any of that matters, this does not.
//
//   <DatePicker bind={this.due} />
//   <DatePicker bind={this.from} min={today} label="Start date" />

import type { HtmlNode } from "@zerotal/flow";
import { _resolveReactiveName, _injectedBindKey } from "@zerotal/flow/jsx-runtime";
import { Popover } from "./Popover.tsx";
import { Calendar } from "./Calendar.tsx";
import type { CalendarEvent } from "./Calendar.tsx";
import { cn } from "../utils/cn.ts";

export interface DatePickerProps {
  /**
   * Bound @expose `YYYY-MM-DD`.
   *
   * The whole interaction — opening, paging months, choosing a day — then runs
   * on the client, and the bound prop is written once. That is the point of a
   * picker: nothing about browsing to March needs the server.
   */
  bind?: unknown;
  name?: string;
  /** Selected day, `YYYY-MM-DD`. Use `bind` unless the grid is server-driven. */
  value?: string | undefined;
  /** Server action receiving the clicked `YYYY-MM-DD`. */
  onSelect?: unknown;
  /** Shown on the button when nothing is chosen. */
  placeholder?: string;
  min?: string | undefined;
  max?: string | undefined;
  /** Days to mark in the grid — booked dates, deadlines. */
  events?: CalendarEvent[];
  /** Accessible name for the button. */
  label?: string;
  disabled?: boolean;
  class?: string;
  [key: string]: unknown;
}

/** `2026-07-29` → `29 Jul 2026`, which is unambiguous in every locale. */
export function formatDay(day: string): string {
  const [y, m, d] = day.split("-");
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const name = months[Number(m) - 1];
  return name ? `${Number(d)} ${name} ${y}` : day;
}

export function DatePicker(props: DatePickerProps): HtmlNode {
  const {
    bind,
    name,
    value,
    onSelect,
    placeholder = "Pick a date",
    min,
    max,
    events,
    label,
    disabled,
    class: cls,
    ...rest
  } = props;

  // The trigger sits outside the calendar's Alpine scope, so it reads the bound
  // prop from `$flow` rather than the calendar's local state. `$flow` is written
  // optimistically on select, so the label still updates on the click.
  const bound = name ?? _injectedBindKey(props, "bind") ?? _resolveReactiveName(bind);

  const trigger = (
    <span
      class={cn(
        "inline-flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-sm",
        "transition-colors hover:bg-accent hover:text-accent-foreground",
        disabled && "pointer-events-none opacity-50",
        !value && !bind && "text-muted-foreground",
        cls,
      )}
      {...(label ? { "aria-label": label } : {})}
    >
      <svg
        class="h-4 w-4 shrink-0 text-muted-foreground"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
      {/* The label follows the client-side selection, so the button updates the
          moment a day is clicked rather than after the sync lands. */}
      <span
        {...(bound
          ? {
              "x-text": `$flow.${bound} ? new Date($flow.${bound} + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ${JSON.stringify(placeholder)}`,
            }
          : {})}
      >
        {(typeof bind === "string" ? bind : value) ? formatDay(String(bind ?? value)) : placeholder}
      </span>
    </span>
  );

  return (
    <Popover trigger={trigger} class="p-0" {...rest}>
      <Calendar
        {...(bind !== undefined ? { bind } : {})}
        {...(name ? { name } : {})}
        {...(value ? { value } : {})}
        {...(onSelect ? { onSelect } : {})}
        {...(min ? { min } : {})}
        {...(max ? { max } : {})}
        {...(events ? { events } : {})}
        class="border-0"
      />
    </Popover>
  );
}
