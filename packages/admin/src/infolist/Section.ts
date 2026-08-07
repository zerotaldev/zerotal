/**
 * Section — an infolist layout component grouping entries under an optional
 * heading/description in a responsive grid.
 *
 *   section("Account")
 *     .description("Profile and sign-in details")
 *     .columns(2)
 *     .schema([
 *       textEntry("name"),
 *       textEntry("email").copyable(),
 *     ])
 */
import { Entry } from "./Entry.ts";

export class Section {
  /** @internal */ _heading?: string | undefined;
  /** @internal */ _description?: string;
  /** @internal */ _icon?: string;
  /** @internal */ _columns = 1;
  /** @internal */ _collapsible = false;
  /** @internal */ _collapsed = false;
  /** @internal */ _entries: Entry[] = [];

  constructor(heading?: string) {
    this._heading = heading;
  }

  static make(heading?: string): Section {
    return new Section(heading);
  }

  heading(heading: string): this {
    this._heading = heading;
    return this;
  }

  description(description: string): this {
    this._description = description;
    return this;
  }

  /** Leading icon for the section heading (key from `ui/icons`). */
  icon(name: string): this {
    this._icon = name;
    return this;
  }

  /** Number of grid columns the entries flow into. */
  columns(n: number): this {
    this._columns = Math.max(1, n);
    return this;
  }

  /** Allow the section to be collapsed (optionally collapsed by default). */
  collapsible(collapsed = false): this {
    this._collapsible = true;
    this._collapsed = collapsed;
    return this;
  }

  /** The section's entries. */
  schema(entries: Entry[]): this {
    this._entries = entries;
    return this;
  }
}

/** An infolist is an ordered list of sections and/or loose entries. */
export type InfolistComponent = Section | Entry;

/** A titled block of read-only entries on the View page. */
export function section(heading?: string): Section {
  return new Section(heading);
}

/**
 * Normalize an infolist schema into sections: loose top-level entries are
 * wrapped in a single untitled section so the View page only renders sections.
 */
export function toSections(components: InfolistComponent[]): Section[] {
  const out: Section[] = [];
  let loose: Entry[] = [];
  const flush = (): void => {
    if (loose.length) {
      out.push(new Section().schema(loose));
      loose = [];
    }
  };
  for (const c of components) {
    if (c instanceof Section) {
      flush();
      out.push(c);
    } else {
      loose.push(c);
    }
  }
  flush();
  return out;
}
