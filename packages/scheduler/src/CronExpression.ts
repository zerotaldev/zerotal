/**
 * Cron expression utility — builder, validator, human-readable describer and
 * next-run calculator. Supports standard 5-field cron (m h dom mon dow) and
 * tolerates an optional leading seconds field (6-field) for validation.
 *
 * Field syntax: star, n, a-b, a-b with step, star with step, and
 * comma-separated lists of any of those (e.g. `1,15,30` or `1-5`).
 */
/**
 * The same instant, shifted so a `Date`'s **local** getters read `timeZone`'s wall
 * clock.
 *
 * Cron is a wall-clock spec: `0 3 * * *` means three in the morning where the
 * business is, not three UTC. Every matcher below reads `getHours()`,
 * `getMinutes()` and friends, which answer in the *process's* zone — so evaluating
 * a schedule in another zone is a question of which Date you hand them.
 *
 * The returned Date is a lie about the instant and true about the clock face: its
 * epoch value is wrong by the zone offset, and it is only ever passed to the field
 * matchers, never returned to a caller or compared against a real time.
 *
 * @param date - The instant to read.
 * @param timeZone - An IANA zone name, e.g. `"Africa/Johannesburg"`.
 * @returns A Date whose local fields are that zone's wall clock at `date`.
 * @throws {@link RangeError} When `timeZone` is not a zone this runtime knows.
 */
export function wallClockIn(date: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const field = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };

  return new Date(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second"),
    0,
  );
}

/**
 * Whether this runtime knows `timeZone`.
 *
 * Worth checking separately from using it: a typo in a schedule's zone would
 * otherwise surface as a `RangeError` thrown once a minute from inside a cron
 * tick, with nothing naming the task it came from.
 *
 * @param timeZone - An IANA zone name.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Minutes in a day, for the day-skip in the next-run scans. */
const MINUTES_PER_DAY = 24 * 60;

export class CronExpression {
  private fields: [string, string, string, string, string];

  private static readonly RANGES: Record<number, [number, number]> = {
    0: [0, 59],
    1: [0, 23],
    2: [1, 31],
    3: [1, 12],
    4: [0, 7],
  };

  private static readonly DOW = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  private static readonly MONTHS = [
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

  constructor(expression?: string) {
    if (expression) {
      const parts = expression.trim().split(/\s+/);
      const five = parts.length === 6 ? parts.slice(1) : parts;
      this.fields = [
        five[0] ?? "*",
        five[1] ?? "*",
        five[2] ?? "*",
        five[3] ?? "*",
        five[4] ?? "*",
      ];
    } else {
      this.fields = ["*", "*", "*", "*", "*"];
    }
  }

  minute(v: number | string): this {
    this.fields[0] = String(v);
    return this;
  }
  hour(v: number | string): this {
    this.fields[1] = String(v);
    return this;
  }
  dayOfMonth(v: number | string): this {
    this.fields[2] = String(v);
    return this;
  }
  month(v: number | string): this {
    this.fields[3] = String(v);
    return this;
  }
  weekday(v: number | string): this {
    this.fields[4] = String(v);
    return this;
  }

  toString(): string {
    return this.fields.join(" ");
  }

  /**
   * Whether `value` satisfies one cron field.
   *
   * @param pattern - The field text (`*`, `5`, `1-5`, `* /3`, `1,15`, or a comma list).
   * @param value - The value to test.
   * @param min - The field's smallest legal value: 0 for minute, hour and day-of-week,
   *   **1** for day-of-month and month. A `* /N` step counts from this, not from zero —
   *   `0 0 * /7 * *` fires on the 1st, 8th, 15th…, and `0 0 * * /3 *` in January, April,
   *   July and October. Anchoring at 0 regardless put the day-of-month step a day early
   *   and the month step two months out.
   */
  private static _matchField(pattern: string, value: number, min = 0): boolean {
    if (pattern === "*") return true;
    for (const token of pattern.split(",")) {
      let range = token;
      let step = 1;
      if (token.includes("/")) {
        const [r, s] = token.split("/");
        range = r || "*";
        step = parseInt(s || "1", 10) || 1;
      }
      let start: number;
      let end: number;
      if (range === "*") {
        start = -Infinity;
        end = Infinity;
      } else if (range.includes("-")) {
        const [a, b] = range.split("-");
        start = parseInt(a || "0", 10);
        end = parseInt(b || "0", 10);
      } else {
        start = end = parseInt(range, 10);
      }
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      if (value < start || value > end) continue;
      const base = range === "*" ? min : start;
      if ((value - base) % step === 0) return true;
    }
    return false;
  }

  matches(date: Date = new Date()): boolean {
    const [mi, h, dom, mo, dow] = this.fields;
    const day = date.getDay();
    const dowMatch =
      CronExpression._matchField(dow, day) || (day === 0 && CronExpression._matchField(dow, 7));
    const domMatch = CronExpression._matchField(dom, date.getDate(), 1);

    // vixie-cron day semantics: when BOTH day-of-month and day-of-week are
    // restricted (neither is `*`), the day matches if EITHER matches (OR). When
    // only one is restricted, the `*` side is trivially true, so the AND below
    // reduces to the restricted one. This matches croner (the real firing path);
    // the previous unconditional AND made matches()/nextRunAfter() disagree with
    // actual firing for expressions like `0 0 1 * 1`.
    const domRestricted = dom !== "*";
    const dowRestricted = dow !== "*";
    const dayMatch = domRestricted && dowRestricted ? domMatch || dowMatch : domMatch && dowMatch;

    return (
      CronExpression._matchField(mi, date.getMinutes()) &&
      CronExpression._matchField(h, date.getHours()) &&
      dayMatch &&
      CronExpression._matchField(mo, date.getMonth() + 1, 1)
    );
  }

  /**
   * Whether the expression matches `date` **as read in `timeZone`**.
   *
   * @param date - The instant to test.
   * @param timeZone - An IANA zone name the expression is written against.
   * @throws {@link RangeError} When `timeZone` is not a zone this runtime knows.
   */
  matchesIn(date: Date, timeZone: string): boolean {
    return this.matches(wallClockIn(date, timeZone));
  }

  nextRun(from: Date = new Date()): Date | null {
    return CronExpression.nextRunAfter(this.toString(), from);
  }

  static isValid(expression: string): boolean {
    if (typeof expression !== "string") return false;
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5 && parts.length !== 6) return false;
    const five = parts.length === 6 ? parts.slice(1) : parts;
    for (let i = 0; i < 5; i++) {
      if (!CronExpression._isValidField(five[i]!, CronExpression.RANGES[i]!)) return false;
    }
    return true;
  }

  private static _isValidField(field: string, [lo, hi]: [number, number]): boolean {
    if (field === "*") return true;
    for (const token of field.split(",")) {
      if (token === "") return false;
      let range = token;
      if (token.includes("/")) {
        const [r, s] = token.split("/");
        const stepNum = Number(s);
        if (!s || !Number.isInteger(stepNum) || stepNum < 1) return false;
        range = r || "*";
        if (range === "*") continue;
      }
      if (range.includes("-")) {
        const [a, b] = range.split("-");
        const an = Number(a);
        const bn = Number(b);
        if (!Number.isInteger(an) || !Number.isInteger(bn)) return false;
        if (an < lo || bn > hi || an > bn) return false;
      } else {
        const n = Number(range);
        if (!Number.isInteger(n) || n < lo || n > hi) return false;
      }
    }
    return true;
  }

  /**
   * The first time at or after `from` that `expression` fires, or `null` when it never does
   * within the search horizon.
   *
   * The scan steps by minute, but skips a whole day at a time once the day itself cannot
   * match — a day-scoped expression like `0 0 29 2 *` would otherwise mean 533,000 minute
   * probes to reach the next leap year, which is why a 370-day horizon reported "never
   * runs" for a perfectly valid expression while burning ~320 ms of blocking CPU per call.
   *
   * @param expression - A 5- or 6-field cron expression.
   * @param from - Search start; the result is strictly after this minute.
   * @returns The next firing time, or `null` for an invalid expression or one with no
   *   occurrence in the next {@link SEARCH_HORIZON_DAYS} days.
   */
  static nextRunAfter(expression: string, from: Date = new Date()): Date | null {
    if (!CronExpression.isValid(expression)) return null;
    const cron = new CronExpression(expression);
    const cursor = new Date(from);
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1);

    const deadline = new Date(from);
    deadline.setDate(deadline.getDate() + CronExpression.SEARCH_HORIZON_DAYS);

    while (cursor <= deadline) {
      if (cron._dayMatches(cursor)) {
        if (cron.matches(cursor)) return new Date(cursor);
        cursor.setMinutes(cursor.getMinutes() + 1);
      } else {
        // Nothing today can match — jump to 00:00 tomorrow rather than probing 1,440 minutes.
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(0, 0, 0, 0);
      }
    }
    return null;
  }

  /**
   * The first instant at or after `from` that `expression` fires, reading the clock
   * in `timeZone`.
   *
   * The returned Date is a real instant, not a shifted one — the shifting happens
   * inside the scan, where the expression is compared against the zone's wall clock
   * a minute at a time. That is what keeps it right across a DST change: nothing
   * here computes an offset once and adds it.
   *
   * @param expression - A 5- or 6-field cron expression.
   * @param from - Search start; the result is strictly after this minute.
   * @param timeZone - An IANA zone name the expression is written against.
   * @returns The next firing instant, or `null` for an invalid expression, an unknown
   *   zone, or no occurrence within {@link SEARCH_HORIZON_DAYS}.
   */
  static nextRunAfterIn(expression: string, from: Date, timeZone: string): Date | null {
    if (!CronExpression.isValid(expression)) return null;
    if (!isValidTimeZone(timeZone)) return null;

    const cron = new CronExpression(expression);
    const cursor = new Date(from);
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1);

    const deadline = new Date(from);
    deadline.setDate(deadline.getDate() + CronExpression.SEARCH_HORIZON_DAYS);

    while (cursor <= deadline) {
      const local = wallClockIn(cursor, timeZone);
      if (cron._dayMatches(local)) {
        if (cron.matches(local)) return new Date(cursor);
        cursor.setMinutes(cursor.getMinutes() + 1);
      } else {
        // Nothing on this local day can match — jump to the zone's next midnight
        // rather than probing 1,440 minutes. Zone offsets are whole minutes, so
        // this lands on it exactly; a DST change costs an hour of extra probes and
        // nothing else.
        const elapsed = local.getHours() * 60 + local.getMinutes();
        cursor.setMinutes(cursor.getMinutes() + (MINUTES_PER_DAY - elapsed));
      }
    }
    return null;
  }

  /**
   * How far ahead {@link nextRunAfter} looks. Four years and change, so a Feb-29 expression
   * resolves to the next leap day instead of reporting that it never runs.
   */
  static readonly SEARCH_HORIZON_DAYS = 366 * 4 + 1;

  /** Whether the date part of `date` satisfies the day-of-month / month / day-of-week fields. */
  private _dayMatches(date: Date): boolean {
    const [, , dom, mo, dow] = this.fields;
    if (!CronExpression._matchField(mo, date.getMonth() + 1, 1)) return false;

    const day = date.getDay();
    const dowMatch =
      CronExpression._matchField(dow, day) || (day === 0 && CronExpression._matchField(dow, 7));
    const domMatch = CronExpression._matchField(dom, date.getDate(), 1);
    return dom !== "*" && dow !== "*" ? domMatch || dowMatch : domMatch && dowMatch;
  }

  static describe(expression: string): string {
    if (!CronExpression.isValid(expression)) return "Invalid cron expression";
    const parts = expression.trim().split(/\s+/);
    const [mi, h, dom, mo, dow] = parts.length === 6 ? parts.slice(1) : parts;

    if (mi === "*" && h === "*" && dom === "*" && mo === "*" && dow === "*") return "Every minute";
    const stepMin = mi!.match(/^\*\/(\d+)$/);
    if (stepMin && h === "*" && dom === "*" && mo === "*" && dow === "*")
      return `Every ${stepMin[1]} minutes`;
    if (mi === "0" && h === "*" && dom === "*" && mo === "*" && dow === "*") return "Every hour";

    const segments: string[] = [];
    if (/^\d+$/.test(mi!) && /^\d+$/.test(h!)) {
      segments.push(`At ${CronExpression._formatTime(Number(h), Number(mi))}`);
    } else {
      if (mi !== "*") segments.push(`At minute ${mi}`);
      if (h !== "*") segments.push(`past hour ${h}`);
    }
    if (dom !== "*") segments.push(`on day-of-month ${dom}`);
    if (mo !== "*") segments.push(`in ${CronExpression._describeMonth(mo!)}`);
    if (dow !== "*") segments.push(CronExpression._describeDow(dow!));
    return segments.join(", ");
  }

  private static _formatTime(hour: number, minute: number): string {
    const period = hour < 12 ? "AM" : "PM";
    let hr = hour % 12;
    if (hr === 0) hr = 12;
    return `${String(hr).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${period}`;
  }

  private static _dowName(n: number): string {
    return CronExpression.DOW[n === 7 ? 0 : n] ?? String(n);
  }

  private static _describeDow(dow: string): string {
    if (/^\d+$/.test(dow)) return CronExpression._dowName(Number(dow));
    const range = dow.match(/^(\d+)-(\d+)$/);
    if (range)
      return `${CronExpression._dowName(Number(range[1]))} through ${CronExpression._dowName(Number(range[2]))}`;
    if (dow.includes(",")) {
      const names = dow.split(",").map((d) => CronExpression._dowName(Number(d)));
      if (names.length === 2) return `${names[0]} and ${names[1]}`;
      return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    }
    return `on ${dow}`;
  }

  private static _describeMonth(mo: string): string {
    if (/^\d+$/.test(mo)) return CronExpression.MONTHS[Number(mo) - 1] ?? mo;
    if (mo.includes(","))
      return mo
        .split(",")
        .map((m) => CronExpression.MONTHS[Number(m) - 1] ?? m)
        .join(", ");
    return mo;
  }
}
