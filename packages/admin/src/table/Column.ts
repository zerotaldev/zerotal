import type { HtmlNode } from "@zerotal/flow";

/**
 * Fluent table-column builder.
 *
 *   text("name").label("Full name").sortable().searchable()
 *   text("status").badge((v) => v === "active" ? "success" : "muted")
 *   text("created_at").since()
 *
 * A `Column` is a declarative description; the list page turns it into a
 * `@zerotal/flow-ui` `TableColumn` (with a cell renderer) at render time.
 */

export type CellAlign = "start" | "center" | "end";
export type BadgeTone = "default" | "primary" | "success" | "muted" | "destructive";
/** Display style: text, inline toggle/select/text-input, image, color swatch, boolean icon. */
export type ColumnKind = "text" | "toggle" | "select" | "input" | "image" | "color" | "icon";

export interface ColumnOption {
  value: string;
  label: string;
}

/** A column summary aggregate — a footer total, average, count or range. */
export type SummaryKind = "sum" | "avg" | "count" | "min" | "max" | "range";

export interface ColumnSummary {
  kind: SummaryKind;
  label?: string | undefined;
  /** Format a numeric result (e.g. currency). */
  format?: ((value: number) => string) | undefined;
}

/** A computed summary line, ready to render. */
export interface SummaryResult {
  label: string;
  text: string;
}

export interface RenderableCell {
  /** Pre-escaped/plain text, or a badge descriptor. */
  text: string;
  badge?: BadgeTone | undefined;
}

export class Column {
  /** @internal */ _key: string;
  /** @internal Database column for query ops (search/sort); defaults to `_key`. */
  _column?: string;
  /** @internal */ _label?: string;
  /** @internal */ _kind: ColumnKind = "text";
  /** @internal */ _sortable = false;
  /** @internal */ _searchable = false;
  /** @internal Offers a filter box in the table header. */ _filterable = false;
  /** @internal */ _copyable = false;
  /** @internal Included in CSV exports unless switched off. */ _exportable = true;
  /** @internal */ _circular = false;
  /** @internal */ _options?: ColumnOption[];
  /** @internal */ _inputType = "text";
  /** @internal */ _align: CellAlign = "start";
  /** @internal */ _format?: (value: unknown, row: Record<string, unknown>) => string;
  /** @internal A custom renderer, replacing every built-in cell kind. */
  _render?: (value: unknown, row: Record<string, unknown>) => HtmlNode | string;
  /** @internal */ _badge?: (value: unknown, row: Record<string, unknown>) => BadgeTone | null;
  /** @internal */ _summaries: ColumnSummary[] = [];

  constructor(key: string) {
    this._key = key;
  }

  static make(key: string): Column {
    return new Column(key);
  }

  /** Human label for the header. Defaults to a title-cased key. */
  label(label: string): this {
    this._label = label;
    return this;
  }

  /**
   * The database column to query for search / sort / inline-edit, when it differs
   * from the cell key. Use when the model exposes a camelCase accessor over a
   * snake_case column: `text("authorName").column("author_name")`. The cell still
   * reads `row[key]` (the accessor); only the SQL uses this column.
   */
  column(name: string): this {
    this._column = name;
    return this;
  }

  /** The database column for query operations (defaults to the cell key). */
  getColumn(): string {
    return this._column ?? this._key;
  }

  /** Allow clicking the header to sort by this column (URL-driven). */
  sortable(value = true): this {
    this._sortable = value;
    return this;
  }

  /** Include this column in the list page's search. */
  searchable(value = true): this {
    this._searchable = value;
    return this;
  }

  /**
   * Give this column its own filter box in the table header.
   *
   * The list page derives the control from the column's kind — a text box for
   * text, a yes/no switch for a toggle, the declared choices for a select — so
   * a column usually needs nothing beyond this call. Header filters write into
   * the same `?filters=` parameter as declared filters and compose with tabs,
   * search, sorting and pagination the same way.
   */
  filterable(value = true): this {
    this._filterable = value;
    return this;
  }

  /** Horizontal alignment of the cell content. */
  align(align: CellAlign): this {
    this._align = align;
    return this;
  }

  /** Custom value formatter (e.g. dates, currency). */
  format(fn: (value: unknown, row: Record<string, unknown>) => string): this {
    this._format = fn;
    return this;
  }

  /** Render the value as a colored badge; return `null` to fall back to text. */
  badge(fn: (value: unknown, row: Record<string, unknown>) => BadgeTone | null): this {
    this._badge = fn;
    return this;
  }

  /** Inline boolean toggle — flips the column on the record when clicked. */
  toggle(): this {
    this._kind = "toggle";
    return this;
  }

  /** Render the value as an image (avatar / thumbnail). */
  image(): this {
    this._kind = "image";
    return this;
  }

  /** Round image (avatar style). */
  circular(value = true): this {
    this._circular = value;
    return this;
  }

  /** Render the value as a color swatch + hex. */
  color(): this {
    this._kind = "color";
    return this;
  }

  /** Render a boolean as a check / cross icon. */
  icon(): this {
    this._kind = "icon";
    return this;
  }

  /** Inline single-choice select — saves the chosen value on change. */
  editSelect(options: Record<string, string> | ColumnOption[]): this {
    this._kind = "select";
    this._options = Array.isArray(options)
      ? options
      : Object.entries(options).map(([value, label]) => ({ value, label }));
    return this;
  }

  /** Inline text input — saves on change/blur. */
  editText(type = "text"): this {
    this._kind = "input";
    this._inputType = type;
    return this;
  }

  /** Show a copy-to-clipboard affordance on the cell. */
  copyable(value = true): this {
    this._copyable = value;
    return this;
  }

  // ── Summaries ───────────────────────────────────────────────────────────────

  /** Attach one or more summary aggregates, shown in the table/group footer. */
  summarize(summary: ColumnSummary | ColumnSummary[]): this {
    this._summaries = Array.isArray(summary) ? summary : [summary];
    return this;
  }

  /** Sum the column (shorthand for `summarize({ kind: "sum" })`). */
  sum(label?: string, format?: (n: number) => string): this {
    this._summaries.push({ kind: "sum", label, format });
    return this;
  }

  /** Average the column. */
  avg(label?: string, format?: (n: number) => string): this {
    this._summaries.push({ kind: "avg", label, format });
    return this;
  }

  /** Count the rows. */
  count(label?: string): this {
    this._summaries.push({ kind: "count", label });
    return this;
  }

  /** Min–max range of the column. */
  range(label?: string, format?: (n: number) => string): this {
    this._summaries.push({ kind: "range", label, format });
    return this;
  }

  /** Whether this column has any summary aggregates. */
  hasSummary(): boolean {
    return this._summaries.length > 0;
  }

  /** Compute this column's summaries over a set of rows. */
  computeSummaries(rows: Record<string, unknown>[]): SummaryResult[] {
    return this._summaries.map((s) => {
      const nums = rows.map((r) => Number(r[this._key])).filter((n) => Number.isFinite(n));
      const fmt = s.format ?? ((n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2)));
      switch (s.kind) {
        case "count":
          return { label: s.label ?? "Count", text: String(rows.length) };
        case "sum":
          return { label: s.label ?? "Sum", text: fmt(nums.reduce((a, b) => a + b, 0)) };
        case "avg":
          return {
            label: s.label ?? "Average",
            text: fmt(nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0),
          };
        case "min":
          return { label: s.label ?? "Min", text: fmt(nums.length ? Math.min(...nums) : 0) };
        case "max":
          return { label: s.label ?? "Max", text: fmt(nums.length ? Math.max(...nums) : 0) };
        case "range": {
          const lo = nums.length ? Math.min(...nums) : 0;
          const hi = nums.length ? Math.max(...nums) : 0;
          return { label: s.label ?? "Range", text: `${fmt(lo)} – ${fmt(hi)}` };
        }
      }
    });
  }

  /** Resolved header label. */
  getLabel(): string {
    return this._label ?? titleCase(this._key);
  }

  /** The raw cell value (for non-text column kinds the page renders itself). */
  /**
   * Whether this column may leave the panel in an export. Turn it off for
   * anything that shouldn't land in a spreadsheet on someone's laptop.
   */
  exportable(value = true): this {
    this._exportable = value;
    return this;
  }

  /**
   * Render this cell yourself, when no built-in kind fits — a sparkline, a
   * progress bar, a stack of avatars.
   *
   *   text("health").render((v) => <HealthBar value={Number(v)} />)
   *
   * The renderer replaces the cell entirely, so `.format()` and `.badge()` no
   * longer apply. Everything else about the column — its label, whether it
   * sorts, whether it exports — still works, because those are the table's
   * concerns rather than the cell's.
   */
  render(fn: (value: unknown, row: Record<string, unknown>) => HtmlNode | string): this {
    this._render = fn;
    return this;
  }

  raw(row: Record<string, unknown>): unknown {
    return row[this._key];
  }

  /** Compute the display cell for a row. */
  cell(row: Record<string, unknown>): RenderableCell {
    const value = row[this._key];
    const text = this._format ? this._format(value, row) : stringify(value);
    const badge = this._badge ? (this._badge(value, row) ?? undefined) : undefined;
    return { text, badge };
  }
}

/** A text column — the one most columns are. */
export function text(key: string): Column {
  return Column.make(key);
}

/** Toggle column, editable in place without opening the record. */
export function toggleColumn(key: string): Column {
  return Column.make(key).toggle();
}

/** Image column — renders the value as a thumbnail. */
export function imageColumn(key: string): Column {
  return Column.make(key).image();
}

/** Color-swatch column. */
export function colorColumn(key: string): Column {
  return Column.make(key).color();
}

/** Boolean icon column — a tick or a cross rather than "true"/"false". */
export function iconColumn(key: string): Column {
  return Column.make(key).icon();
}

/** Select column, editable in place without opening the record. */
export function selectColumn(
  key: string,
  options: Record<string, string> | ColumnOption[],
): Column {
  return Column.make(key).editSelect(options);
}

/** Text column, editable in place without opening the record. */
export function textInputColumn(key: string): Column {
  return Column.make(key).editText();
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function titleCase(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
