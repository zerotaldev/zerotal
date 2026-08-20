/**
 * Resolves an icon name to the SVG body that draws it.
 *
 * The Lucide set is vendored into this package (`lucide.json`, refreshed by
 * `scripts/sync-icons.ts`), so `<Icon name="inbox" />` works in a fresh app with
 * nothing installed. Icons are rendered on the server, so the set never reaches a
 * browser: there is no icon font, no request per glyph, and nothing to tree-shake.
 * The whole file costs one read, once, per process.
 *
 * ## Why the set is read and not imported
 *
 * `import icons from "./lucide.json"` would be shorter and would put 584 KB of
 * object literal in front of `tsc` on every typecheck — 1,843 keys it would infer
 * literal types for and then discard, because nothing here needs them. The names
 * are typed by `names.generated.ts` instead, which is 40 KB of union and the only
 * part a compiler has any use for.
 */
import { readFileSync } from "node:fs";
import { CUSTOM_ICONS } from "./custom.ts";
import { BRAND_ICONS } from "./brands.generated.ts";

/** One icon: the markup inside the `<svg>`, and the box it was drawn in. */
export interface IconBody {
  /** The SVG children — paths, circles — as markup. */
  body: string;
  /** viewBox width. Defaults to the set's (24 for Lucide). */
  width?: number;
  /** viewBox height. Defaults to the set's (24 for Lucide). */
  height?: number;
}

interface IconSet {
  icons: Record<string, IconBody>;
  aliases?: Record<string, { parent: string; width?: number; height?: number }>;
  width?: number;
  height?: number;
}

/** A resolved icon: body plus the viewBox it needs. */
export interface ResolvedIcon {
  body: string;
  width: number;
  height: number;
}

/** Icons an app registered at runtime, by name. */
const _registered = new Map<string, IconBody>();

let _set: IconSet | null = null;

/** The vendored set, parsed on first use and held for the process. */
function set(): IconSet {
  if (_set) return _set;
  const path = new URL("./lucide.json", import.meta.url);
  _set = JSON.parse(readFileSync(path, "utf8")) as IconSet;
  return _set;
}

/**
 * Add icons the bundled set does not have — a wordmark, a product glyph, a shape
 * nobody has drawn yet. Call it from a provider's `register()`, before anything
 * renders.
 *
 * Names registered here shadow the bundled set, which is how an app substitutes
 * its own drawing for one of ours without renaming every call site.
 *
 * To have them type-checked like the bundled names, declare them:
 *
 * ```ts
 * declare module "@zerotal/flow-ui" {
 *   interface CustomIconRegistry {
 *     "acme-wordmark": true;
 *   }
 * }
 * ```
 */
export function registerIcons(icons: Record<string, IconBody>): void {
  for (const [name, body] of Object.entries(icons)) _registered.set(name, body);
}

/**
 * Resolve `name` to its body and viewBox, or `null` when nothing answers to it.
 *
 * Lookup order is runtime registrations, then the icons shipped alongside this
 * package — hand-drawn, then brand marks — then the vendored set. Most specific
 * first, so an app can override a glyph it does not like.
 */
export function resolveIcon(name: string): ResolvedIcon | null {
  const s = set();
  const dw = s.width ?? 24;
  const dh = s.height ?? 24;

  const own =
    _registered.get(name) ??
    (CUSTOM_ICONS as Record<string, IconBody>)[name] ??
    (BRAND_ICONS as Record<string, IconBody>)[name];
  if (own) return { body: own.body, width: own.width ?? dw, height: own.height ?? dh };

  let key = name;
  let width: number | undefined;
  let height: number | undefined;

  // Aliases point at another name in the same set. The hop count is capped rather
  // than tracked: the data is vendored, so a cycle would be our bug and not an
  // app's input, and a bounded loop fails the icon instead of the request.
  for (let hops = 0; hops < 8; hops++) {
    const icon = s.icons[key];
    if (icon) {
      return {
        body: icon.body,
        width: width ?? icon.width ?? dw,
        height: height ?? icon.height ?? dh,
      };
    }

    const alias = s.aliases?.[key];
    if (!alias) return null;

    width ??= alias.width;
    height ??= alias.height;
    key = alias.parent;
  }

  return null;
}

/** Drop runtime registrations and the parsed set. @internal — for tests. */
export function _resetIcons(): void {
  _registered.clear();
  _set = null;
}
