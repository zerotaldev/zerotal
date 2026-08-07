/** Infolist building blocks — read-only schemas for the View page. */
export {
  Entry,
  textEntry,
  iconEntry,
  imageEntry,
  colorEntry,
  codeEntry,
  keyValueEntry,
  repeatableEntry,
} from "./Entry.ts";
export type { EntryDisplay, EntryKind, EntrySize, EntryWeight } from "./Entry.ts";
export { Section, section, toSections } from "./Section.ts";
export type { InfolistComponent } from "./Section.ts";

import { Entry } from "./Entry.ts";
import { Section, type InfolistComponent, toSections } from "./Section.ts";
import type { Column } from "../table/Column.ts";

/**
 * Resolve a resource's View schema as sections. If `infolist()` returns
 * components, use them; otherwise derive a single section from the table
 * `columns()` (carrying their labels, formatters, and badge tones) so every
 * resource has a useful detail page with zero extra config.
 */
export function resolveInfolist(components: InfolistComponent[], columns: Column[]): Section[] {
  if (components.length > 0) return toSections(components);

  const entries = columns.map((c) => {
    const e = new Entry(c._key).label(c.getLabel());
    if (c._format) e.format(c._format);
    if (c._badge) {
      e.badge().color((value, row) => c._badge!(value, row));
    }
    return e;
  });
  return [new Section().schema(entries)];
}
