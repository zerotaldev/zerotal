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

/** The attributes every icon in the bundled set carries. Kept in one place so a
 *  hand-drawn body cannot quietly disagree with the 1,843 it sits beside. */
const S =
  'fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"';

/**
 * Hand-drawn additions, merged over the bundled set.
 *
 * These four are the authentication flows `@zerotal/auth` ships — passkeys,
 * TOTP, email one-time codes and magic links — and Lucide has no icon for any of
 * them as a concept. It has `key-round`, `fingerprint` and `shield-check`, which
 * are the parts, and a login page needs the whole.
 *
 * Everything else probed for turned out to be there under a name that reads
 * differently: `git-branch` not `branch`, `file-json` not `json`, `paperclip` not
 * `attachment`, `venetian-mask` for impersonation. The set is thorough, and the
 * bar for adding to it is that the *concept* is missing rather than the spelling.
 */
export const CUSTOM_ICONS = {
  /** WebAuthn / passkey sign-in — a fingerprint that ends in a key. */
  passkey: {
    body:
      `<g ${S}>` +
      '<path d="M8 6a6 6 0 0 0 0 12"/>' +
      '<path d="M8 9.5a2.5 2.5 0 0 0 0 5"/>' +
      '<path d="M8 12h12"/>' +
      '<path d="M17 12v3"/>' +
      '<path d="M20 12v3"/>' +
      "</g>",
  },

  /**
   * Two-factor authentication — a second device that has to agree.
   *
   * The phone is the set's own 14 × 20 body, not a narrowed one: at 10 wide it
   * read as a remote control and broke the proportions of every device icon it
   * would sit beside. Room for the check comes from opening the bottom-right
   * corner instead, which is how `mail-check` makes room for the same mark.
   */
  "two-factor": {
    body:
      `<g ${S}>` +
      '<path d="M19 13V4a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h5"/>' +
      '<path d="M12 18h.01"/>' +
      '<path d="m15 20 2 2 5-5"/>' +
      "</g>",
  },

  /**
   * An emailed one-time code — the separate slots it gets typed into.
   *
   * One field with marks inside was the obvious drawing and collided with
   * `rectangle-ellipsis`, which is the same rounded 20 × 12 frame carrying three
   * dots. Three discrete boxes is the thing `rectangle-ellipsis` cannot be
   * mistaken for, and it is what a code input actually looks like.
   */
  otp: {
    body:
      `<g ${S}>` +
      '<rect x="2" y="8" width="6" height="8" rx="1.5"/>' +
      '<rect x="9" y="8" width="6" height="8" rx="1.5"/>' +
      '<rect x="16" y="8" width="6" height="8" rx="1.5"/>' +
      "</g>",
  },

  /**
   * Passwordless sign-in by emailed link — an envelope with the spark on it.
   *
   * The star is drawn with quadratic curves pulling its waist in toward the
   * centre, matching `sparkles`. The first attempt was straight-edged, which
   * beside the set's concave star read as hand-cut.
   */
  "magic-link": {
    body:
      `<g ${S}>` +
      '<path d="M18 9v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h9"/>' +
      '<path d="m2 7 8 5 4-2.5"/>' +
      '<path d="M19 1.5q.4 3.1 3.5 3.5-3.1.4-3.5 3.5-.4-3.1-3.5-3.5 3.1-.4 3.5-3.5z"/>' +
      "</g>",
  },
} as const satisfies Record<string, IconBody>;

/** Every hand-drawn icon this package ships. */
export type ShippedIconName = keyof typeof CUSTOM_ICONS & string;
