/**
 * What `<Icon name>` accepts, and how an app widens it.
 *
 * The bundled names come from `names.generated.ts` — a union of all 2,060 Lucide
 * icons and aliases, regenerated with the set by `scripts/sync-icons.ts`. Because
 * the set ships inside this package, that union is **complete on install**: a
 * fresh app gets autocomplete over every icon and a compile error on a typo,
 * having run no generator and installed nothing.
 *
 * That is the difference from core's `RouteRegistry`, which starts empty and has
 * to fall back to `string` until `bun zt route:types` fills it in. Routes are the
 * application's; icons are ours, so there is nothing to discover at build time
 * and no fallback to widen to.
 *
 * `CustomIconRegistry` is the one thing an app does own, and it is additive —
 * declaration merging widens the union rather than replacing it.
 */
import type { LucideIconName } from "./names.generated.ts";
import type { ShippedIconName } from "./custom.ts";
import type { BrandIconName } from "./brands.generated.ts";

/**
 * Icon names an application registered itself, filled by declaration merging.
 *
 * Pair it with the `registerIcons()` call that supplies the bodies — the
 * interface is what the compiler reads, the call is what the renderer reads, and
 * an app needs both:
 *
 * ```ts
 * declare module "@zerotal/flow-ui" {
 *   interface CustomIconRegistry {
 *     "acme-wordmark": true;
 *   }
 * }
 * ```
 *
 * @category Extension registries
 */
export interface CustomIconRegistry {}

/** Every icon name an application added through {@link CustomIconRegistry}. */
export type CustomIconName = Extract<keyof CustomIconRegistry, string>;

/**
 * Every name `<Icon>` accepts: the bundled set, the icons drawn alongside it, and
 * whatever the application registered.
 *
 * There is deliberately no `| string` at the end. One would make the union
 * decorative — every typo would satisfy it, which is the failure this exists to
 * remove. A name that genuinely is not known until runtime is not a literal at
 * all, and goes through {@link isIconName}, which says so at the call site.
 */
export type IconName = LucideIconName | ShippedIconName | BrandIconName | CustomIconName;

/**
 * Narrow an untrusted string to an icon name — a status field, a CMS column, a
 * URL segment — before handing it to `<Icon>`.
 *
 * This is a *shape* check and not an existence check: it says the string could be
 * a name, not that anything answers to it. Rendering is what discovers that, and
 * `<Icon>` renders nothing for a name it cannot resolve rather than throwing, so
 * being wrong here costs a blank space and not the page.
 */
export function isIconName(value: unknown): value is IconName {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
