/**
 * Infolist entries — the read-only counterpart to form fields. An entry
 * describes how to pull a value off a record and present it (badge, icon,
 * copyable, date, money, image, colour swatch, …). The View page turns each
 * entry into markup via {@link Entry.display}.
 *
 *   textEntry("email").icon("mail").copyable()
 *   textEntry("created_at").label("Joined").dateTime()
 *   textEntry("role").badge().color((v) => (v === "admin" ? "primary" : "muted"))
 *   iconEntry("email_verified_at").label("Verified").boolean()
 *   imageEntry("avatar_url").circular()
 *   colorEntry("brand_color")
 *   codeEntry("payload").language("json")
 *   keyValueEntry("meta")
 */
import type { HtmlNode } from "@zerotal/flow";
import type { BadgeTone } from "../table/Column.ts";

export type EntryWeight = "normal" | "medium" | "semibold" | "bold";
export type EntrySize = "sm" | "base" | "lg";
export type EntryKind = "text" | "icon" | "image" | "color" | "code" | "keyValue" | "repeatable";

type Resolver<T> = (value: unknown, row: Record<string, unknown>) => T;

/** A fully-resolved entry, ready for the View page to render. */
export interface EntryDisplay {
  kind: EntryKind;
  label: string;
  /** Display text (already formatted/truncated). */
  text: string;
  /** True when the value was empty and the placeholder is shown. */
  isPlaceholder: boolean;
  badge: boolean;
  tone: BadgeTone | null;
  icon: string | null;
  /** When set, render an icon-only boolean state (IconEntry). */
  boolean: boolean | null;
  copyValue: string | null;
  href: string | null;
  html: boolean;
  weight: EntryWeight;
  size: EntrySize;
  tooltip: string | null;
  columnSpan: number;
  /** Render an image as a circle (avatars) rather than a rounded rectangle. */
  circular: boolean;
  /** Pixel height for an image entry. */
  imageHeight: number;
  /** Syntax hint shown beside a code entry. */
  language: string | null;
  /** Key/value pairs, for a keyValue entry. */
  pairs: { key: string; value: string }[];
  /** One nested entry set per item, for a repeatable entry. */
  items: EntryDisplay[][];
  /** A custom renderer supplied with `.render()`, when one was. */
  custom: ((value: unknown, row: Record<string, unknown>) => HtmlNode | string) | null;
  /** The raw value and row, so a custom renderer receives what it expects. */
  raw: unknown;
  row: Record<string, unknown>;
}

export class Entry {
  /** @internal */ _key: string;
  /** @internal */ _kind: EntryKind = "text";
  /** @internal */ _label?: string;
  /** @internal */ _state?: (row: Record<string, unknown>) => unknown;
  /** @internal */ _default?: unknown;
  /** @internal */ _placeholder = "—";
  /** @internal */ _format?: Resolver<string>;
  /** @internal */ _badge = false;
  /** @internal */ _color?: BadgeTone | Resolver<BadgeTone | null>;
  /** @internal */ _icon?: string | Resolver<string | null>;
  /** @internal */ _boolean = false;
  /** @internal */ _copyable = false;
  /** @internal */ _url?: Resolver<string | null>;
  /** @internal */ _html = false;
  /** @internal */ _weight: EntryWeight = "normal";
  /** @internal */ _size: EntrySize = "base";
  /** @internal */ _tooltip?: string;
  /** @internal */ _columnSpan = 1;
  /** @internal */ _limit?: number;
  /** @internal */ _date?: "date" | "datetime" | "since";
  /** @internal */ _money?: string;
  /** @internal */ _circular = false;
  /** @internal */ _imageHeight = 48;
  /** @internal */ _language?: string;
  /** @internal Nested schema, for a repeatable entry. */ _schema: Entry[] = [];
  /** @internal A custom renderer, replacing every built-in entry kind. */
  _render?: (value: unknown, row: Record<string, unknown>) => HtmlNode | string;

  constructor(key: string) {
    this._key = key;
  }

  static make(key: string): Entry {
    return new Entry(key);
  }

  // ── Value resolution ───────────────────────────────────────────────────────

  /** Human label for the entry. Defaults to a title-cased key. */
  label(label: string): this {
    this._label = label;
    return this;
  }

  /** Derive the value from the whole record instead of `record[key]`. */
  state(fn: (row: Record<string, unknown>) => unknown): this {
    this._state = fn;
    return this;
  }

  /** Value used when the record's value is null/undefined. */
  default(value: unknown): this {
    this._default = value;
    return this;
  }

  /** Text shown when the resolved value is empty. */
  placeholder(text: string): this {
    this._placeholder = text;
    return this;
  }

  /** Custom value formatter (runs last in the pipeline). */
  format(fn: Resolver<string>): this {
    this._format = fn;
    return this;
  }

  // ── Presentation ───────────────────────────────────────────────────────────

  /** Render the value inside a colored pill. */
  badge(value = true): this {
    this._badge = value;
    return this;
  }

  /** Badge/text tone — a fixed tone or a function of the value. */
  color(tone: BadgeTone | Resolver<BadgeTone | null>): this {
    this._color = tone;
    return this;
  }

  /** Leading icon (key from `ui/icons`), fixed or computed. */
  icon(name: string | Resolver<string | null>): this {
    this._icon = name;
    return this;
  }

  /** Render as a boolean check/cross icon (IconEntry). */
  boolean(value = true): this {
    this._boolean = value;
    this._kind = "icon";
    return this;
  }

  /** Add a click-to-copy button next to the value. */
  copyable(value = true): this {
    this._copyable = value;
    return this;
  }

  /** Turn the value into a link. */
  url(fn: Resolver<string | null>): this {
    this._url = fn;
    return this;
  }

  /** Treat the formatted value as trusted HTML (rendered as-is). */
  html(value = true): this {
    this._html = value;
    return this;
  }

  /** Font weight. */
  weight(weight: EntryWeight): this {
    this._weight = weight;
    return this;
  }

  /** Text size. */
  size(size: EntrySize): this {
    this._size = size;
    return this;
  }

  /** Hover tooltip. */
  tooltip(text: string): this {
    this._tooltip = text;
    return this;
  }

  /** How many grid columns this entry spans within its section. */
  columnSpan(span: number): this {
    this._columnSpan = Math.max(1, span);
    return this;
  }

  /** Truncate the formatted value to `n` characters (adds an ellipsis). */
  limit(n: number): this {
    this._limit = n;
    return this;
  }

  // ── Value casts ──────────────────────────────────────────────────────────

  /** Format the value as a localized date. */
  date(): this {
    this._date = "date";
    return this;
  }

  /** Format the value as a localized date + time. */
  dateTime(): this {
    this._date = "datetime";
    return this;
  }

  /** Format the value as a relative time ("3 days ago"). */
  since(): this {
    this._date = "since";
    return this;
  }

  /** Format the value as currency. */
  money(currency = "USD"): this {
    this._money = currency;
    return this;
  }

  // ── Resolution ─────────────────────────────────────────────────────────────

  getLabel(): string {
    return this._label ?? titleCase(this._key);
  }

  private _rawState(row: Record<string, unknown>): unknown {
    const raw = this._state ? this._state(row) : getByPath(row, this._key);
    return raw === null || raw === undefined || raw === "" ? (this._default ?? null) : raw;
  }

  /** Compute everything the page needs to render this entry for `row`. */
  /** Render an image entry as a circle — avatars and logos. */
  circular(value = true): this {
    this._circular = value;
    return this;
  }

  /** Pixel height for an image entry (width follows the aspect ratio). */
  height(px: number): this {
    this._imageHeight = px;
    return this;
  }

  /** Syntax label shown beside a code entry — `"json"`, `"sql"`, `"ts"`. */
  language(name: string): this {
    this._language = name;
    return this;
  }

  /**
   * Render this entry yourself, when no built-in kind fits — a map, a chart, a
   * rendered diff.
   *
   *   textEntry("route").render((v) => <RouteMap path={String(v)} />)
   *
   * The renderer replaces the value entirely; the label and column span still
   * come from the entry, because those belong to the section's grid rather than
   * to the value.
   */
  render(fn: (value: unknown, row: Record<string, unknown>) => HtmlNode | string): this {
    this._render = fn;
    return this;
  }

  /** Nested entries rendered once per item of an array-valued attribute. */
  schema(entries: Entry[]): this {
    this._schema = entries;
    return this;
  }

  display(row: Record<string, unknown>): EntryDisplay {
    const value = this._rawState(row);
    const tone =
      typeof this._color === "function" ? this._color(value, row) : (this._color ?? null);
    const icon = typeof this._icon === "function" ? this._icon(value, row) : (this._icon ?? null);
    const href = this._url ? this._url(value, row) : null;

    // A repeatable entry has no scalar value of its own — it renders its nested
    // schema once per item, so an empty array shows the placeholder instead.
    if (this._kind === "repeatable") {
      const list = Array.isArray(value) ? value : [];
      return {
        ...this._base(row, value),
        kind: "repeatable",
        text: list.length === 0 ? this._placeholder : "",
        isPlaceholder: list.length === 0,
        items: list.map((item) =>
          this._schema.map((entry) => entry.display((item ?? {}) as Record<string, unknown>)),
        ),
      };
    }

    if (this._kind === "keyValue") {
      const pairs = toPairs(value);
      return {
        ...this._base(row, value),
        kind: "keyValue",
        text: pairs.length === 0 ? this._placeholder : "",
        isPlaceholder: pairs.length === 0,
        pairs,
      };
    }

    if (this._boolean) {
      const truthy =
        value !== null && value !== undefined && value !== false && value !== 0 && value !== "";
      return {
        ...this._base(row, value),
        kind: "icon",
        text: truthy ? "Yes" : "No",
        tone: tone ?? (truthy ? "success" : "muted"),
        boolean: truthy,
      };
    }

    const isEmpty = value === null || value === undefined || value === "";
    const text = isEmpty ? this._placeholder : this._formatValue(value, row);

    return {
      ...this._base(row, value),
      // Image, colour and code entries carry their kind through so the View page
      // can pick a renderer; the resolved text is the URL, hex or source.
      kind: this._kind === "icon" ? "text" : this._kind,
      text,
      isPlaceholder: isEmpty,
      badge: this._badge && !isEmpty,
      tone,
      icon,
      copyValue: this._copyable && !isEmpty ? String(value) : null,
      href: isEmpty ? null : href,
      html: this._html && !isEmpty,
    };
  }

  /** The fields every kind shares, so each branch states only its differences. */
  private _base(row: Record<string, unknown> = {}, raw: unknown = undefined): EntryDisplay {
    return {
      kind: "text",
      label: this.getLabel(),
      text: "",
      isPlaceholder: false,
      badge: false,
      tone: null,
      icon: null,
      boolean: null,
      copyValue: null,
      href: null,
      html: false,
      weight: this._weight,
      size: this._size,
      tooltip: this._tooltip ?? null,
      columnSpan: this._columnSpan,
      circular: this._circular,
      imageHeight: this._imageHeight,
      language: this._language ?? null,
      pairs: [],
      items: [],
      custom: this._render ?? null,
      raw,
      row,
    };
  }

  private _formatValue(value: unknown, row: Record<string, unknown>): string {
    if (this._format) return this._format(value, row);
    let out: string;
    if (this._money) out = formatMoney(value, this._money);
    else if (this._date) out = formatDate(value, this._date);
    else out = stringify(value);
    if (this._limit && out.length > this._limit) out = out.slice(0, this._limit).trimEnd() + "…";
    return out;
  }
}

/** Plain value — the default entry. */
export function textEntry(key: string): Entry {
  return Entry.make(key);
}

/** A truthy/falsy value shown as a check or a cross. */
export function iconEntry(key: string): Entry {
  return Entry.make(key).boolean();
}

/** An image, from a URL held on the record. */
export function imageEntry(key: string): Entry {
  const entry = Entry.make(key);
  entry._kind = "image";
  return entry;
}

/** A colour swatch beside its value — `#4f46e5`, `rgb(...)`. */
export function colorEntry(key: string): Entry {
  const entry = Entry.make(key);
  entry._kind = "color";
  return entry;
}

/** Source or serialised data, in a monospace block. */
export function codeEntry(key: string): Entry {
  const entry = Entry.make(key);
  entry._kind = "code";
  return entry;
}

/** An object or map, as a two-column table of its pairs. */
export function keyValueEntry(key: string): Entry {
  const entry = Entry.make(key);
  entry._kind = "keyValue";
  return entry;
}

/**
 * An array of objects, rendering the nested {@link Entry.schema} once per item —
 * order line items, project milestones, anything repeated.
 */
export function repeatableEntry(key: string): Entry {
  const entry = Entry.make(key);
  entry._kind = "repeatable";
  return entry;
}

/** Normalise an object (or a `{key,value}[]`) into displayable pairs. */
function toPairs(value: unknown): { key: string; value: string }[] {
  if (Array.isArray(value)) {
    return value
      .filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object")
      .map((v) => ({ key: String(v["key"] ?? ""), value: stringify(v["value"]) }));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([key, v]) => ({
      key,
      value: stringify(v),
    }));
  }
  return [];
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function getByPath(row: Record<string, unknown>, path: string): unknown {
  if (path in row) return row[path];
  return path
    .split(".")
    .reduce<unknown>((acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]), row);
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  // Carbon (and other Date wrappers) expose toDate(); use it without importing Carbon.
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const d = (value as { toDate(): Date }).toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatDate(value: unknown, mode: "date" | "datetime" | "since"): string {
  const d = toDate(value);
  if (!d) return stringify(value);
  if (mode === "since") return formatSince(d);
  return mode === "datetime" ? d.toLocaleString() : d.toLocaleDateString();
}

function formatSince(d: Date): string {
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  const future = secs < 0;
  const abs = Math.abs(secs);
  const units: [number, string][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [2592000, "day"],
    [31536000, "month"],
    [Infinity, "year"],
  ];
  const divisors = [1, 60, 3600, 86400, 2592000, 31536000];
  for (let i = 0; i < units.length; i++) {
    if (abs < units[i]![0]) {
      const n = Math.max(1, Math.floor(abs / divisors[i]!));
      const unit = n === 1 ? units[i]![1] : units[i]![1] + "s";
      return future ? `in ${n} ${unit}` : `${n} ${unit} ago`;
    }
  }
  return d.toLocaleDateString();
}

function formatMoney(value: unknown, currency: string): string {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (Number.isNaN(n)) return stringify(value);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  // Carbon (and similar) — prefer a readable form over JSON.
  if (typeof value === "object") {
    const v = value as { toDate?: unknown; toString?: unknown };
    if (typeof v.toDate === "function") return (v.toDate() as Date).toLocaleString();
    if (typeof v.toString === "function" && v.toString !== Object.prototype.toString) {
      return String(value);
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function titleCase(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
