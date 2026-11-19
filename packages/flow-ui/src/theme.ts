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
 *     loads Tailwind v4's browser build from a pinned CDN URL, gives it the same
 *     token mapping as a `text/tailwindcss` stylesheet, and emits the palette
 *     inline.
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
  stylesheet?: string | undefined;
  /** Keep loading Tailwind's browser build from the CDN. Defaults to `true` unless `stylesheet` is set. */
  cdn?: boolean | undefined;
  /** Extra token CSS appended after the defaults — override `:root` / `.dark` here. */
  tokensCss?: string | undefined;
  /** Skip the bundled Google Fonts links (e.g. you self-host). */
  noFonts?: boolean | undefined;
  /** Extra raw markup appended to the head. */
  extraHead?: string | undefined;
}

/**
 * Tailwind's browser build, pinned to one release so a page never changes under a
 * deploy it didn't make. The integrity hash is of that exact file: jsDelivr serves
 * npm files byte-for-byte, so the browser refuses anything else.
 */
const TAILWIND_BROWSER_SRC =
  "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.5/dist/index.global.js";
const TAILWIND_BROWSER_INTEGRITY =
  "sha384-t+qLIxS5zM/KF99/doWY+dxTsavdvgayaZt8A9ntLsUjEkiXzYl5M3Ij8zVFPL9j";

/** Every border defaults to the border token. */
const BORDER_CSS = `* { border-color: hsl(var(--border)); }`;

/**
 * Page-level rules under the components: the body takes the background and
 * foreground tokens.
 *
 * With the CDN these and {@link BORDER_CSS} go into Tailwind's `base` layer.
 * Tailwind v4 emits every utility inside a cascade layer, and a rule outside any
 * layer beats all of them, so an unlayered `* { border-color }` would override
 * `border-primary` on every element.
 */
const PAGE_CSS = `
html { scroll-behavior: smooth; }
body {
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
`.trim();

/**
 * The theme as Tailwind v4 CSS: what the browser build reads from a
 * `<style type="text/tailwindcss">`, and what a v4 build can import.
 *
 * - `dark:` follows a `.dark` class on an ancestor, the same selector the toggle
 *   and the no-flash script write.
 * - `@theme inline` maps each token to a utility (`bg-card`, `rounded-lg`,
 *   `animate-fade-in`). `inline` keeps `hsl(var(--card))` in the utility itself,
 *   so a `.dark` subtree or a `tokensCss` override recolours it where it is used.
 * - `container` is centred with 1.5rem of padding and one 1400px step.
 * - The `base` layer keeps Tailwind v3's defaults the components were drawn
 *   against: token borders, grey placeholders, pointer cursors on buttons, and
 *   centred dialogs.
 */
const TAILWIND_CSS = `
@custom-variant dark (&:is(.dark *));

@theme inline {
  --font-sans: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --color-border: hsl(var(--border));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));
  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));
  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));
  --color-popover: hsl(var(--popover));
  --color-popover-foreground: hsl(var(--popover-foreground));
  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-success: hsl(var(--success));
  --color-success-foreground: hsl(var(--success-foreground));
  --color-warning: hsl(var(--warning));
  --color-warning-foreground: hsl(var(--warning-foreground));
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --animate-fade-in: fade-in .25s ease-out both;
  @keyframes fade-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: none; }
  }
}

@layer utilities {
  .container { margin-inline: auto; padding-inline: 1.5rem; max-width: none; }
  @media (width >= 1400px) { .container { max-width: 1400px; } }
}

@layer base {
  *, ::after, ::before, ::backdrop, ::file-selector-button { border-color: hsl(var(--border)); }
  input::placeholder, textarea::placeholder { color: #9ca3af; }
  button:not(:disabled), [role="button"]:not(:disabled) { cursor: pointer; }
  dialog { margin: auto; }
${PAGE_CSS.replace(/^/gm, "  ")}
}
`.trim();

/**
 * The same theme as a Tailwind v3 config (`tailwind.config = { … }`), kept for an
 * app whose own build is still on Tailwind v3.
 */
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
const VARS_CSS = `
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
`.trim();

/** Cloaking, a numeric helper and the scrollbar: none of them compete with a utility. */
const EXTRAS_CSS = `
[x-cloak],[flow\\:cloak] { display: none !important; }
.tabular { font-variant-numeric: tabular-nums; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: hsl(var(--muted-foreground) / 0.35); border-radius: 9999px; border: 2px solid transparent; background-clip: content-box; }
::-webkit-scrollbar-thumb:hover { background: hsl(var(--muted-foreground) / 0.55); background-clip: content-box; }
`.trim();

/** Tokens plus every base rule, unlayered: the form a page without the CDN gets. */
const TOKENS_CSS = [VARS_CSS, BORDER_CSS, PAGE_CSS, EXTRAS_CSS].join("\n");

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
 * The theme as Tailwind v4 CSS: the `dark` variant, the token → utility mapping
 * (`@theme inline`), the `container` and the base layer. It is exactly what
 * {@link flowUiHead} hands the CDN, so a v4 build that includes it after
 * `@import "tailwindcss";`, with {@link flowTokensCss} beside it, matches the CDN
 * look.
 */
export function flowTailwindCss(): string {
  return TAILWIND_CSS;
}

/**
 * The theme as a Tailwind v3 config (token → CSS-var mappings, fonts, radius,
 * animations), for an app whose own build is still on Tailwind v3. The CDN runs
 * Tailwind v4 and reads {@link flowTailwindCss} instead, and the components use
 * v4 class names (`shadow-xs`, `outline-hidden`, `data-checked:`), which a v3
 * build doesn't generate.
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
    // The browser build compiles every `text/tailwindcss` style it finds, including
    // one parsed after the script, and writes the result into a <style> of its own.
    parts.push(
      `<script src="${TAILWIND_BROWSER_SRC}" integrity="${TAILWIND_BROWSER_INTEGRITY}" crossorigin="anonymous"></script>`,
      `<style type="text/tailwindcss">${TAILWIND_CSS}</style>`,
    );
  }
  if (theme.stylesheet) {
    parts.push(`<link rel="stylesheet" href="${theme.stylesheet}" />`);
  }
  // The tokens are plain CSS, valid with or without the CDN. With it, the base rules
  // already sit in Tailwind's base layer; without it, they come along unlayered.
  const tokens = useCdn ? `${VARS_CSS}\n${EXTRAS_CSS}` : TOKENS_CSS;
  parts.push(`<style>${tokens}${theme.tokensCss ? `\n${theme.tokensCss}` : ""}</style>`);
  parts.push(`<script>${THEME_TOGGLE_SCRIPT}</script>`);
  if (theme.extraHead) parts.push(theme.extraHead);
  return parts.join("\n");
}
