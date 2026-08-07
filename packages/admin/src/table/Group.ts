/**
 * Row grouping for the list table. A resource lists
 * the groupings it supports via `static groups()`; the list page offers a
 * "Group by" menu and renders a header row before each group's rows.
 *
 *   static groups() {
 *     return [
 *       group("status"),
 *       group("created_at").label("Joined").getTitleUsing((r) => formatMonth(r.created_at)),
 *     ];
 *   }
 *   static defaultGroup = "status";
 */
export class Group {
  /** @internal */ _column: string;
  /** @internal */ _label?: string;
  /** @internal */ _getTitle?: (row: Record<string, unknown>) => string;
  /** @internal */ _collapsible = false;

  constructor(column: string) {
    this._column = column;
  }

  static make(column: string): Group {
    return new Group(column);
  }

  /** Heading label for the grouping (defaults to a title-cased column). */
  label(label: string): this {
    this._label = label;
    return this;
  }

  /** Derive each group's title from a row (e.g. bucket a date into a month). */
  getTitleUsing(fn: (row: Record<string, unknown>) => string): this {
    this._getTitle = fn;
    return this;
  }

  collapsible(value = true): this {
    this._collapsible = value;
    return this;
  }

  /** The grouping's column key (also its stable identifier). */
  getColumn(): string {
    return this._column;
  }

  getLabel(): string {
    return this._label ?? titleCase(this._column);
  }

  /** The group title for a given row. */
  titleFor(row: Record<string, unknown>): string {
    if (this._getTitle) return this._getTitle(row);
    const v = row[this._column];
    return v === null || v === undefined || v === "" ? "—" : String(v);
  }
}

/** Group the list's rows under a column's value. */
export function group(column: string): Group {
  return new Group(column);
}

function titleCase(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
