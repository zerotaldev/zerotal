/**
 * Admin theme — the `<head>` payload that makes the panel look good in both
 * light and dark mode with zero build step.
 *
 * The tokens themselves live in `@zerotal/flow-ui`, because they are the kit's
 * tokens: flow-ui components are written against `bg-primary`,
 * `text-muted-foreground`, `border-input` and friends, so whoever defines those
 * variables themes the components. The admin is one consumer of that theme and
 * the monitor is another; keeping the palette in the kit is what stops the two
 * from drifting apart.
 *
 * This module is the admin's thin wrapper over it: the same head payload, under
 * the names the panel's own config uses.
 */
import {
  flowUiHead,
  flowTokensCss,
  flowTailwindCss,
  flowTailwindConfig,
  THEME_STORAGE_KEY as FLOW_THEME_STORAGE_KEY,
  THEME_TOGGLE_SCRIPT as FLOW_THEME_TOGGLE_SCRIPT,
} from "@zerotal/flow-ui";

/** localStorage key the toggle and the no-flash script share.
 *
 * @internal
 */
export const THEME_STORAGE_KEY = FLOW_THEME_STORAGE_KEY;

/** Client helpers (theme toggle + copy-to-clipboard), eval-free. */
export const THEME_TOGGLE_SCRIPT = FLOW_THEME_TOGGLE_SCRIPT;

/**
 * Styling source for the admin shell. By default Tailwind v4's **browser build**,
 * loaded from a pinned CDN URL, themes everything with zero build step. To ship a
 * real build, point `stylesheet` at your compiled CSS (built with Tailwind v4 from
 * {@link adminTailwindCss} + {@link adminTokensCss}); the CDN is then dropped
 * automatically (set `cdn: true` to keep both during migration).
 */
export interface AdminThemeConfig {
  /** A prebuilt stylesheet URL/path to link instead of (or alongside) the CDN. */
  stylesheet?: string | undefined;
  /** Keep loading Tailwind's browser build from the CDN. Defaults to `true` unless `stylesheet` is set. */
  cdn?: boolean | undefined;
  /** Extra design-token CSS appended after the defaults (override `:root` / `.dark`). */
  tokensCss?: string | undefined;
  /** Skip the bundled Google Fonts links (e.g. you self-host Inter). */
  noFonts?: boolean | undefined;
}

/** The design-token CSS (`:root` + `.dark` custom properties + base styles). */
export function adminTokensCss(): string {
  return flowTokensCss();
}

/**
 * The theme as Tailwind v4 CSS (the `dark` variant, the token → utility mapping,
 * the base layer). Include it after `@import "tailwindcss";` in a v4 build, with
 * {@link adminTokensCss} beside it, and the compiled stylesheet matches the CDN look.
 */
export function adminTailwindCss(): string {
  return flowTailwindCss();
}

/**
 * The theme as a Tailwind v3 config, for an app whose own build is still on
 * Tailwind v3. The panel's markup uses v4 class names, so a v3 build misses some of
 * them; {@link adminTailwindCss} is the match for the CDN.
 */
export function adminTailwindConfig(): string {
  return flowTailwindConfig();
}

/**
 * Full `<head>` markup for the admin shell. Inject as `Layout.head`.
 *
 * With no `theme` (or `theme.cdn !== false`) it loads Tailwind's browser build. Set
 * `theme.stylesheet` to link a prebuilt CSS file and drop the CDN — only this
 * file's wiring changes; pages stay identical.
 */
export function adminHead(title = "Admin", theme: AdminThemeConfig = {}): string {
  return flowUiHead(title, theme);
}
