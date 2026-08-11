/**
 * Dashboard widgets — stat rows, charts and small tables whose values are
 * computed on the server each time the dashboard renders. A widget is a *data
 * provider*: the dashboard page owns the markup, so widgets stay
 * framework-light and easy to test.
 *
 *   Panel.widgets(
 *     statsWidget(async () => [
 *       stat("Users", await User.count()).icon("users").tone("primary"),
 *       stat("Posts", await Post.count()).description("Published").icon("document"),
 *     ]).poll("30s"),
 *   );
 *
 * A widget that polls re-renders itself on an interval, so an ops dashboard left
 * open on a wall display stays current without anyone reloading it.
 */
import type { BadgeTone } from "../table/Column.ts";

export type WidgetTone = BadgeTone;

/**
 * Re-render interval shared by every widget kind.
 *
 * Kept as the caller's own string ("30s", "5s") because that is what the poll
 * directive takes; an unset interval means the widget renders once per page load.
 */
abstract class PollableWidget {
  /** @internal */ _poll?: string;
  /** @internal Stable identity, for a persisted dashboard layout. */ _key?: string;

  /**
   * Re-render this widget every `interval` — `"10s"`, `"1m"`. Costs a query per
   * tick per viewer, so reach for it on dashboards that are watched, not on
   * every widget by habit.
   */
  poll(interval: string): this {
    this._poll = interval;
    return this;
  }

  /**
   * Name this widget, so a saved dashboard layout can refer to it.
   *
   * Worth setting on any widget whose title might change: a layout keyed by
   * title silently resets the moment somebody rewords a heading, whereas an
   * explicit key survives it.
   */
  key(key: string): this {
    this._key = key;
    return this;
  }

  /** The identity a layout stores. Falls back to the title, then the position. */
  widgetKey(index: number): string {
    if (this._key) return this._key;
    const title = (this as { _title?: string })._title;
    return title
      ? title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
      : `widget-${index}`;
  }
}

export class Stat {
  /** @internal */ _label: string;
  /** @internal */ _value: string | number;
  /** @internal */ _description?: string;
  /** @internal */ _icon?: string;
  /** @internal */ _tone: WidgetTone = "default";

  constructor(label: string, value: string | number) {
    this._label = label;
    this._value = value;
  }

  description(text: string): this {
    this._description = text;
    return this;
  }

  icon(name: string): this {
    this._icon = name;
    return this;
  }

  tone(tone: WidgetTone): this {
    this._tone = tone;
    return this;
  }
}

/** Build a single stat card. */
export function stat(label: string, value: string | number): Stat {
  return new Stat(label, value);
}

export type StatsResolver = () => Promise<Stat[]> | Stat[];

export class StatsWidget extends PollableWidget {
  /** @internal */ _resolver: StatsResolver;
  /** @internal */ _columns = 4;

  constructor(resolver: StatsResolver) {
    super();
    this._resolver = resolver;
  }

  /** Number of cards per row (responsive; 1–4). */
  columns(n: number): this {
    this._columns = Math.min(4, Math.max(1, n));
    return this;
  }

  /** Resolve the stats for this render. */
  async stats(): Promise<Stat[]> {
    return this._resolver();
  }
}

/** A row of stat cards. */
export function statsWidget(resolver: StatsResolver): StatsWidget {
  return new StatsWidget(resolver);
}

// ── Chart widget ─────────────────────────────────────────────────────────────

export type ChartType = "line" | "bar" | "doughnut" | "pie";

export interface ChartDataset {
  label?: string;
  data: number[];
  /** CSS color; defaults to the panel's primary token. */
  color?: string;
}

export interface ChartData {
  type: ChartType;
  labels: string[];
  datasets: ChartDataset[];
}

export type ChartResolver = () => Promise<ChartData> | ChartData;

export class ChartWidget extends PollableWidget {
  /** @internal */ _title: string;
  /** @internal */ _resolver: ChartResolver;
  /** @internal */ _columns = 2;
  /** @internal */ _height = 220;

  constructor(title: string, resolver: ChartResolver) {
    super();
    this._title = title;
    this._resolver = resolver;
  }

  /** Grid span on the dashboard (1–4). */
  columns(n: number): this {
    this._columns = Math.min(4, Math.max(1, n));
    return this;
  }

  /** Canvas height in pixels. */
  height(px: number): this {
    this._height = px;
    return this;
  }

  async data(): Promise<ChartData> {
    return this._resolver();
  }
}

/** A chart, drawn with Chart.js on the dashboard. */
export function chartWidget(title: string, resolver: ChartResolver): ChartWidget {
  return new ChartWidget(title, resolver);
}

// ── Table widget ─────────────────────────────────────────────────────────────

export interface TableWidgetColumn {
  key: string;
  label: string;
}

export type TableRowsResolver = () =>
  Promise<Record<string, unknown>[]> | Record<string, unknown>[];

export class TableWidget extends PollableWidget {
  /** @internal */ _title: string;
  /** @internal */ _columns: TableWidgetColumn[];
  /** @internal */ _resolver: TableRowsResolver;
  /** @internal */ _wide = true;

  constructor(title: string, columns: TableWidgetColumn[], resolver: TableRowsResolver) {
    super();
    this._title = title;
    this._columns = columns;
    this._resolver = resolver;
  }

  /** Span the full dashboard width (default) or a single column. */
  wide(value = true): this {
    this._wide = value;
    return this;
  }

  async rows(): Promise<Record<string, unknown>[]> {
    return this._resolver();
  }
}

/** A small data table on the dashboard. */
export function tableWidget(
  title: string,
  columns: TableWidgetColumn[],
  resolver: TableRowsResolver,
): TableWidget {
  return new TableWidget(title, columns, resolver);
}

/** A dashboard widget — stats overview, chart, or table. */
export type DashboardWidget = StatsWidget | ChartWidget | TableWidget;

/**
 * The shortest poll interval among these widgets, or `undefined` when none
 * polls. The dashboard polls as one unit, so the keenest widget sets the pace.
 *
 * @internal
 */
export function widgetPollInterval(widgets: DashboardWidget[]): string | undefined {
  const intervals = widgets.map((w) => w._poll).filter((i): i is string => Boolean(i));
  if (intervals.length === 0) return undefined;
  return intervals.reduce((a, b) => (pollMs(b) < pollMs(a) ? b : a));
}

/** Parse a poll interval to milliseconds; an unparseable one sorts last. */
function pollMs(interval: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(interval.trim());
  if (!match) return Number.MAX_SAFE_INTEGER;
  const n = Number(match[1]);
  switch (match[2]) {
    case "ms":
      return n;
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    default:
      return n * 1000;
  }
}
