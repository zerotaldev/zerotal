/**
 * The flow-ui theme, as a `<head>` payload.
 *
 * flow-ui components are written against design tokens — `bg-card`,
 * `text-muted-foreground`, `border-input`, `bg-primary` — so *defining* those
 * tokens themes the whole kit at once. There are two ways to do that:
 *
 *   - **A real Tailwind build.** Import `@zerotal/flow-ui/theme.css` after
 *     `tailwindcss` and the tokens arrive as CSS custom properties.
 *   - **No build at all.** Inject {@link flowUiHead} into a Layout's `head`. It
 *     loads the Tailwind Play CDN, configures it with the same token mapping,
 *     and emits the palette inline.
 *
 * This module is the second path, and it exists so that every panel Zerotal ships
 * — the admin, the monitor — is themed from one place rather than each
 * re-deriving the same variables.
 *
 * Pass `tokensCss` to re-brand: it is appended after the defaults, so overriding
 * `--primary` on `:root` and `.dark` is enough to recolour an entire product.
 */

/** localStorage key the toggle and the no-flash script share. */
export const THEME_STORAGE_KEY = "zerotal-theme";

/** Styling source for a flow-ui surface. */
export interface FlowUiThemeConfig {
  /** A prebuilt stylesheet URL/path to link instead of (or alongside) the CDN. */
  stylesheet?: string;
  /** Keep loading the Tailwind Play CDN. Defaults to `true` unless `stylesheet` is set. */
  cdn?: boolean;
  /** Extra token CSS appended after the defaults — override `:root` / `.dark` here. */
  tokensCss?: string;
  /** Skip the bundled Google Fonts links (e.g. you self-host). */
  noFonts?: boolean;
  /** Extra raw markup appended to the head. */
  extraHead?: string;
}

/** Inline Tailwind config: class-based dark mode + token → CSS-var color mapping. */
const TAILWIND_CONFIG = `
tailwind.config = {
  darkMode: "class",
  theme: {
    container: { center: true, padding: "1.5rem", screens: { "2xl": "1400px" } },
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        success: { DEFAULT: "hsl(var(--success))", foreground: "hsl(var(--success-foreground))" },
        warning: { DEFAULT: "hsl(var(--warning))", foreground: "hsl(var(--warning-foreground))" },
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: { "fade-in": "fade-in .25s ease-out both" },
    },
  },
};
`.trim();

/**
 * Light + dark palettes as HSL triplets.
 *
 * `success` and `warning` sit alongside the base set because a panel needs
 * to say "healthy" and "degraded", and `destructive` only covers the third case.
 *
 * `--chart-1` … `--chart-7` are a *categorical* palette: colours chosen to stay
 * distinguishable from one another rather than to carry meaning. Series colours
 * can't be semantic tokens — "the second line" isn't good or bad — but they still
 * belong in the theme so a chart re-brands with everything else. SVG `stroke` and
 * `fill` can't take Tailwind classes, so reference them as `hsl(var(--chart-2))`.
 */
const TOKENS_CSS = `
:root {
  --background: 0 0% 100%;
  --foreground: 222 47% 11%;
  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 222 47% 11%;
  --primary: 243 75% 59%;
  --primary-foreground: 0 0% 100%;
  --secondary: 220 14% 96%;
  --secondary-foreground: 222 47% 11%;
  --muted: 220 14% 96%;
  --muted-foreground: 220 9% 46%;
  --accent: 220 14% 96%;
  --accent-foreground: 222 47% 11%;
  --destructive: 0 72% 51%;
  --destructive-foreground: 0 0% 100%;
  --success: 142 71% 45%;
  --success-foreground: 0 0% 100%;
  --warning: 38 92% 50%;
  --warning-foreground: 222 47% 11%;
  --border: 220 13% 91%;
  --input: 220 13% 91%;
  --ring: 243 75% 59%;
  --radius: 0.65rem;
  --chart-1: 243 75% 59%;
  --chart-2: 25 95% 53%;
  --chart-3: 199 89% 48%;
  --chart-4: 160 84% 39%;
  --chart-5: 271 81% 56%;
  --chart-6: 340 82% 59%;
  --chart-7: 43 96% 50%;
}
.dark {
  --background: 224 71% 4%;
  --foreground: 210 20% 98%;
  --card: 224 50% 7%;
  --card-foreground: 210 20% 98%;
  --popover: 224 50% 7%;
  --popover-foreground: 210 20% 98%;
  --primary: 234 89% 74%;
  --primary-foreground: 222 47% 11%;
  --secondary: 215 28% 17%;
  --secondary-foreground: 210 20% 98%;
  --muted: 215 28% 17%;
  --muted-foreground: 217 11% 65%;
  --accent: 215 28% 17%;
  --accent-foreground: 210 20% 98%;
  --destructive: 0 63% 50%;
  --destructive-foreground: 210 20% 98%;
  --success: 142 64% 47%;
  --success-foreground: 0 0% 100%;
  --warning: 38 92% 58%;
  --warning-foreground: 224 71% 4%;
  --border: 215 28% 17%;
  --input: 215 28% 20%;
  --ring: 234 89% 74%;
  --radius: 0.65rem;
  --chart-1: 234 89% 74%;
  --chart-2: 25 95% 63%;
  --chart-3: 199 89% 60%;
  --chart-4: 160 74% 52%;
  --chart-5: 271 81% 70%;
  --chart-6: 340 82% 70%;
  --chart-7: 43 96% 62%;
}
* { border-color: hsl(var(--border)); }
html { scroll-behavior: smooth; }
body {
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
[x-cloak],[flow\\:cloak] { display: none !important; }
.tabular { font-variant-numeric: tabular-nums; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: hsl(var(--muted-foreground) / 0.35); border-radius: 9999px; border: 2px solid transparent; background-clip: content-box; }
::-webkit-scrollbar-thumb:hover { background: hsl(var(--muted-foreground) / 0.55); background-clip: content-box; }
`.trim();

/** Runs before paint: apply the saved theme (or OS preference) to <html>. */
const NO_FLASH_SCRIPT = `
(function () {
  try {
    var k = ${JSON.stringify(THEME_STORAGE_KEY)};
    var saved = localStorage.getItem(k);
    var dark = saved ? saved === "dark"
      : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", !!dark);
  } catch (e) {}
})();
`.trim();

/** Small client helpers (theme toggle + copy-to-clipboard), eval-free. */
export const THEME_TOGGLE_SCRIPT = `
window.__zerotalToggleTheme = function () {
  try {
    var k = ${JSON.stringify(THEME_STORAGE_KEY)};
    var isDark = document.documentElement.classList.toggle("dark");
    localStorage.setItem(k, isDark ? "dark" : "light");
  } catch (e) {}
};
window.__zerotalCopy = function (el) {
  try {
    var text = el.getAttribute("data-copy") || "";
    if (navigator.clipboard) navigator.clipboard.writeText(text);
    el.setAttribute("data-copied", "1");
    setTimeout(function () { el.removeAttribute("data-copied"); }, 1200);
  } catch (e) {}
};
`.trim();

/** The design-token CSS (`:root` + `.dark` custom properties + base styles). */
export function flowTokensCss(): string {
  return TOKENS_CSS;
}

/**
 * The Tailwind config (token → CSS-var mappings, fonts, radius, animations) as a
 * JS string. Reuse it in your own `tailwind.config.js` when building real CSS so
 * a compiled build matches the CDN look exactly.
 */
export function flowTailwindConfig(): string {
  return TAILWIND_CONFIG;
}

/**
 * Full `<head>` markup for a flow-ui surface. Inject as a Layout's `head`.
 *
 * The no-flash script goes first so the saved theme is applied before any styled
 * content paints.
 */
export function flowUiHead(title = "Zerotal", theme: FlowUiThemeConfig = {}): string {
  const useCdn = theme.cdn ?? !theme.stylesheet;
  const parts = [
    `<script>${NO_FLASH_SCRIPT}</script>`,
    `<title>${title}</title>`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<meta name="color-scheme" content="light dark" />`,
  ];
  if (!theme.noFonts) {
    parts.push(
      `<link rel="preconnect" href="https://fonts.googleapis.com" />`,
      `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />`,
      `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />`,
    );
  }
  if (useCdn) {
    parts.push(
      `<script src="https://cdn.tailwindcss.com"></script>`,
      `<script>${TAILWIND_CONFIG}</script>`,
    );
  }
  if (theme.stylesheet) {
    parts.push(`<link rel="stylesheet" href="${theme.stylesheet}" />`);
  }
  // Tokens are plain CSS (vars + base styles), valid with or without the CDN.
  parts.push(`<style>${TOKENS_CSS}${theme.tokensCss ? `\n${theme.tokensCss}` : ""}</style>`);
  parts.push(`<script>${THEME_TOGGLE_SCRIPT}</script>`);
  if (theme.extraHead) parts.push(theme.extraHead);
  return parts.join("\n");
}
