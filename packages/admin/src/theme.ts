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
 * Styling source for the admin shell. By default the Tailwind **Play CDN** themes
 * everything with zero build step. To ship a real build, point `stylesheet` at
 * your compiled CSS (built from your own `tailwind.config` — reuse
 * {@link adminTailwindConfig} + {@link adminTokensCss}); the CDN is then dropped
 * automatically (set `cdn: true` to keep both during migration).
 */
export interface AdminThemeConfig {
  /** A prebuilt stylesheet URL/path to link instead of (or alongside) the CDN. */
  stylesheet?: string | undefined;
  /** Keep loading the Tailwind Play CDN. Defaults to `true` unless `stylesheet` is set. */
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
 * The Tailwind config (token → CSS-var mappings, fonts, radius, animations) as a
 * JS string. Reuse it in your own `tailwind.config.js` when building real CSS so a
 * compiled build matches the CDN look exactly.
 */
export function adminTailwindConfig(): string {
  return flowTailwindConfig();
}

/**
 * Full `<head>` markup for the admin shell. Inject as `Layout.head`.
 *
 * With no `theme` (or `theme.cdn !== false`) it loads the Tailwind Play CDN. Set
 * `theme.stylesheet` to link a prebuilt CSS file and drop the CDN — only this
 * file's wiring changes; pages stay identical.
 */
export function adminHead(title = "Admin", theme: AdminThemeConfig = {}): string {
  return flowUiHead(title, theme);
}
