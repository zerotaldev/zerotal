/**
 * List-page tabs — filter presets shown above the table. Each tab scopes the
 * query and can show a badge count.
 *
 *   tab("all").label("All"),
 *   tab("verified").label("Verified").badge().modifyQuery((q) => q.whereNotNull("email_verified_at")),
 *   tab("unverified").label("Unverified").badge("!" ).badgeColor("warning")
 *     .modifyQuery((q) => q.whereNull("email_verified_at")),
 */
import type { QueryModifier } from "../Resource.ts";
import type { BadgeTone } from "./Column.ts";

export class Tab {
  /** @internal */ _key: string;
  /** @internal */ _label?: string;
  /** @internal */ _icon?: string;
  /** @internal */ _badge = false;
  /** @internal */ _badgeValue?: number | string;
  /** @internal */ _badgeTone: BadgeTone = "muted";
  /** @internal */ _modify?: QueryModifier;

  constructor(key: string) {
    this._key = key;
  }

  static make(key: string): Tab {
    return new Tab(key);
  }

  label(label: string): this {
    this._label = label;
    return this;
  }

  icon(name: string): this {
    this._icon = name;
    return this;
  }

  /**
   * Show a count badge. With no argument the panel counts matching records;
   * pass a value to show a fixed badge instead.
   */
  badge(value?: number | string): this {
    this._badge = true;
    if (value !== undefined) this._badgeValue = value;
    return this;
  }

  badgeColor(tone: BadgeTone): this {
    this._badgeTone = tone;
    return this;
  }

  /** Scope the table query for this tab. */
  modifyQuery(fn: QueryModifier): this {
    this._modify = fn;
    return this;
  }

  getLabel(): string {
    return this._label ?? titleCase(this._key);
  }
}

/** A filter preset shown as a tab above the list. */
export function tab(key: string): Tab {
  return new Tab(key);
}

function titleCase(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
