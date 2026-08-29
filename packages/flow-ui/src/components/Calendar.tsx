/** @jsxImportSource @zerotal/flow */
// ── <Calendar> ──────────────────────────────────────────────────────────────
//
// A month grid. Two jobs, deliberately in one component: picking a date, and
// laying records out across a month. They share every hard part — which days a
// month starts and ends on, where the week boundaries fall, which cell is today —
// so splitting them would mean writing that twice.
//
// The two jobs split on where the work belongs:
//
// **Picking** is pure interaction — paging months and choosing a day are
// arithmetic the browser can already do — so `bind` gives you a client-driven
// calendar. Nothing crosses the network until a day is chosen, and paging
// through the year never touches the server at all.
//
// **Laying records out** needs the records, so `events` renders on the server.
// Paging there is a real navigation, because the next month means different
// rows and only the server has them.
//
// Use `bind` for a date picker, `events` for a planner.
//
// Dates are handled as `YYYY-MM-DD` strings rather than Date objects. A Date is a
// timestamp, and a calendar cell is a calendar day: crossing that boundary is
// what puts an event on the wrong day for anyone east or west of the server.
//
//   <Calendar value={this.due} onSelect={this.pick} />
//   <Calendar month="2026-07" events={[{ date: "2026-07-14", label: "Launch" }]} />

import type { HtmlNode } from "@zerotal/flow";
import { Calendar as HeadlessCalendar } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface CalendarEvent {
  /** `YYYY-MM-DD`. */
  date: string;
  label: unknown;
  href?: string | undefined;
  /** Tailwind classes for the chip. */
  class?: string | undefined;
}

export interface CalendarProps {
  /**
   * Bound @expose `YYYY-MM-DD`, for a picker.
   *
   * With this set the calendar runs on the client: months page instantly and a
   * chosen day syncs once. Prefer it to `onSelect` for anything that is picking
   * rather than browsing.
   */
  bind?: unknown;
  name?: string;
  /** Month to show, `YYYY-MM`. Defaults to the month of `value`, else today. */
  month?: string | undefined;
  /** Selected day, `YYYY-MM-DD`. */
  value?: string | undefined;
  /** Server action receiving the clicked `YYYY-MM-DD`. Only for a server-driven grid. */
  onSelect?: unknown;
  /** Records to lay out across the month. */
  events?: CalendarEvent[];
  /** Days before this are not selectable. `YYYY-MM-DD`. */
  min?: string | undefined;
  max?: string | undefined;
  /** Start weeks on Sunday instead of Monday. */
  sundayFirst?: boolean;
  /** Build the href for the previous/next month links. Omit for a static grid. */
  monthHref?: ((month: string) => string) | undefined;
  class?: string;
  [key: string]: unknown;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * `YYYY-MM-DD` for a local date, avoiding the UTC shift `toISOString` applies.
 *
 * @internal
 */
export function isoDay(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/**
 * Step a `YYYY-MM` by whole months, wrapping the year.
 *
 * @internal
 */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1 + by, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The cells of a month grid, including the neighbouring days that fill the first
 * and last weeks.
 *
 * Those trailing days are rendered rather than left blank: a month that starts
 * mid-week reads as a grid with a hole in it otherwise, and seeing the last days
 * of the previous month is how people orient themselves.
 *
 * @internal
 */
export function monthGrid(month: string, sundayFirst = false): { day: string; inMonth: boolean }[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y ?? 1970, (m ?? 1) - 1, 1);

  // JS weeks start on Sunday; a Monday-first grid shifts by one.
  const weekday = sundayFirst ? first.getDay() : (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - weekday);

  const cells: { day: string; inMonth: boolean }[] = [];
  // Six weeks always, so the grid does not change height between months — a
  // calendar that resizes as you page through it is unpleasant to use.
  for (let i = 0; i < 42; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    cells.push({ day: isoDay(date), inMonth: date.getMonth() === (m ?? 1) - 1 });
  }
  return cells;
}

export function Calendar(props: CalendarProps): HtmlNode {
  const {
    bind,
    name,
    month: monthProp,
    value,
    onSelect,
    events = [],
    min,
    max,
    sundayFirst,
    monthHref,
    class: cls,
    ...rest
  } = props;

  // A bound calendar is a picker, and pickers belong to the client.
  if (bind !== undefined || name) {
    return (
      <HeadlessCalendar
        {...rest}
        {...(bind !== undefined ? { bind } : {})}
        {...(name ? { name } : {})}
        {...(monthProp ? { month: monthProp } : {})}
        {...(sundayFirst ? { sundayFirst } : {})}
        {...(min ? { min } : {})}
        {...(max ? { max } : {})}
        class={cn("rounded-lg border border-border bg-card p-3", cls)}
        headerClass="mb-2 flex items-center justify-between px-1 text-sm font-medium"
        navClass="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        gridClass="grid grid-cols-7 gap-px"
        weekdayClass="pb-1 text-center text-[11px] font-medium text-muted-foreground"
        // Every state the day cell can be in is a data attribute the headless
        // layer sets, so all of this is CSS with no second source of truth.
        dayClass={cn(
          "flex h-9 items-center justify-center rounded-md text-sm transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          "data-outside:text-muted-foreground/40",
          "data-today:ring-1 data-today:ring-ring",
          "data-selected:bg-primary data-selected:text-primary-foreground",
          "disabled:pointer-events-none disabled:opacity-40",
        )}
      />
    );
  }

  const month = monthProp ?? (value ? value.slice(0, 7) : isoDay(new Date()).slice(0, 7));
  const [year, monthNumber] = month.split("-").map(Number);
  const cells = monthGrid(month, sundayFirst);
  const today = isoDay(new Date());
  const weekdays = sundayFirst ? ["Sun", ...WEEKDAYS.slice(0, 6)] : WEEKDAYS;

  // Grouped once, so a month with many events does not scan the list per cell.
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    byDay.set(event.date, [...(byDay.get(event.date) ?? []), event]);
  }
  const hasEvents = events.length > 0;

  return (
    <div class={cn("rounded-lg border border-border bg-card p-3", cls)} {...rest}>
      <div class="mb-2 flex items-center justify-between px-1">
        {monthHref ? (
          <a
            href={monthHref(shiftMonth(month, -1))}
            navigate
            aria-label="Previous month"
            class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            ‹
          </a>
        ) : (
          <span class="w-7" />
        )}
        <p class="text-sm font-medium">
          {MONTHS[(monthNumber ?? 1) - 1]} {String(year)}
        </p>
        {monthHref ? (
          <a
            href={monthHref(shiftMonth(month, 1))}
            navigate
            aria-label="Next month"
            class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            ›
          </a>
        ) : (
          <span class="w-7" />
        )}
      </div>

      <div class="grid grid-cols-7 gap-px">
        {weekdays.map((d) => (
          <div class="pb-1 text-center text-[11px] font-medium text-muted-foreground">{d}</div>
        ))}

        {cells.map(({ day, inMonth }) => {
          const dayEvents = byDay.get(day) ?? [];
          const selected = value === day;
          const isToday = day === today;
          const disabled = (min && day < min) || (max && day > max);
          const label = String(Number(day.slice(-2)));

          const cellClass = cn(
            hasEvents ? "min-h-20 items-start p-1 text-left" : "h-9 items-center justify-center",
            "flex flex-col rounded-md text-sm transition-colors",
            !inMonth && "text-muted-foreground/40",
            selected && "bg-primary text-primary-foreground",
            !selected && isToday && "ring-1 ring-ring",
            !selected &&
              !disabled &&
              Boolean(onSelect) &&
              "hover:bg-accent hover:text-accent-foreground",
            Boolean(disabled) && "cursor-not-allowed opacity-40",
          );

          const contents = (
            <>
              <span class={cn(hasEvents && "px-1 text-xs font-medium")}>{label}</span>
              {dayEvents.length > 0 ? (
                <div class="mt-0.5 w-full space-y-0.5">
                  {dayEvents.slice(0, 3).map((event) =>
                    event.href ? (
                      <a
                        href={event.href}
                        navigate
                        class={cn(
                          "block truncate rounded bg-primary/10 px-1 py-0.5 text-[11px] text-primary hover:bg-primary/20",
                          event.class,
                        )}
                      >
                        {event.label}
                      </a>
                    ) : (
                      <span
                        class={cn(
                          "block truncate rounded bg-primary/10 px-1 py-0.5 text-[11px] text-primary",
                          event.class,
                        )}
                      >
                        {event.label}
                      </span>
                    ),
                  )}
                  {/* A day with a dozen events must not stretch the row. */}
                  {dayEvents.length > 3 ? (
                    <span class="block px-1 text-[10px] text-muted-foreground">
                      +{String(dayEvents.length - 3)} more
                    </span>
                  ) : null}
                </div>
              ) : null}
            </>
          );

          return onSelect && !disabled ? (
            <button
              type="button"
              onClick={onSelect}
              data-args={JSON.stringify([day])}
              aria-pressed={selected ? "true" : "false"}
              aria-label={day}
              class={cellClass}
            >
              {contents}
            </button>
          ) : (
            <div class={cellClass}>{contents}</div>
          );
        })}
      </div>
    </div>
  );
}
