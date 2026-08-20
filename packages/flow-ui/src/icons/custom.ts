/**
 * Icons drawn for this package because the bundled set has no equivalent.
 *
 * "Ships full" is the promise `<Icon>` makes: a name that ought to exist should
 * render, rather than sending an app off to install a second set for one glyph.
 * Lucide covers most of it — 1,843 icons — and where it does not, the icon is
 * drawn here and joins the same union as everything else.
 *
 * ## Drawing one
 *
 * Match the set it sits beside or it will look wrong next to it. Lucide is a
 * **24×24 stroke** set: no fills, `stroke="currentColor"`, `stroke-width="2"`,
 * round caps and joins, geometry on a 24-unit grid inset by 2. Copy the shape of
 * an existing body rather than exporting from a design tool, which will hand you
 * absolute fills and a 0.5px grid:
 *
 * ```ts
 * "acme-widget": {
 *   body:
 *     '<g fill="none" stroke="currentColor" stroke-width="2" ' +
 *     'stroke-linecap="round" stroke-linejoin="round">' +
 *     '<path d="M4 6h16M4 12h16M4 18h10"/>' +
 *     "</g>",
 * },
 * ```
 *
 * `width`/`height` are only needed for an icon drawn against a different box;
 * they default to the set's 24×24.
 *
 * The body is inserted into the page as markup, so it is **not** the place for
 * anything that came from outside this repo. It is trusted for the same reason
 * the rest of this package's markup is: it was written here and reviewed here.
 *
 * An application adds its own through `registerIcons()` instead — see
 * [`loader.ts`](./loader.ts) — which keeps its artwork, and its licence, its own.
 */
import type { IconBody } from "./loader.ts";

/**
 * Hand-drawn additions, merged over the bundled set.
 *
 * Empty is the honest starting point: every name asked for so far is in Lucide.
 * Entries land here as gaps turn up, and each one joins {@link ShippedIconName}
 * automatically — there is no second list to update.
 */
export const CUSTOM_ICONS = {} as const satisfies Record<string, IconBody>;

/** Every hand-drawn icon this package ships. */
export type ShippedIconName = keyof typeof CUSTOM_ICONS & string;
