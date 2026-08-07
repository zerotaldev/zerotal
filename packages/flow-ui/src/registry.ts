// ── flow-ui component registry ───────────────────────────────────────────────
//
// The manifest behind `reno flow add`. It lists every
// component, where its source lives, and which utils it needs — and it knows how
// to resolve and transform that source so it can be COPIED into an app (the
// "you own the code" model), not just imported.
//
// Every component file imports its utils as `../utils/cn.ts` / `../utils/gva.ts`.
// When copied into an app, those become `./lib/cn.ts` / `./lib/gva.ts` (utils land
// in a `lib/` subfolder next to the components).
//
// A composed component — a date picker is a calendar inside a popover — imports
// its siblings as `./Sibling.tsx` and names them in `requires`. Copied components
// land flat in one directory, so a sibling import needs no rewriting at all; what
// it needs is for the pieces to come along, which `requires` is what tells the
// CLI to do.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// This file sits at <pkg>/src/registry.ts, so the package root is two levels up.
const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** A copyable utility module (shared by components). */
export interface UtilEntry {
  name: string;
  /** Path relative to the package's `src/`. */
  source: string;
  /** Destination relative to the app's UI dir (under `lib/`). */
  target: string;
}

/** A component available to `reno flow add`. */
export interface ComponentEntry {
  /** kebab-case id used on the CLI — e.g. `dropdown-menu`. */
  name: string;
  /** Human title for listings. */
  title: string;
  description: string;
  /** Path relative to the package's `src/`. */
  source: string;
  /** Destination filename relative to the app's UI dir. */
  target: string;
  /** Util ids this component needs (for listing; utils are always ensured on add). */
  utils: ("cn" | "gva")[];
  /** Sibling component ids this one imports, copied alongside it. */
  requires?: string[];
}

export const UTILS: UtilEntry[] = [
  { name: "cn", source: "utils/cn.ts", target: "lib/cn.ts" },
  { name: "gva", source: "utils/gva.ts", target: "lib/gva.ts" },
];

export const THEME = { source: "theme.css" } as const;

const C = (
  name: string,
  title: string,
  source: string,
  utils: ("cn" | "gva")[],
  description: string,
  requires?: string[],
): ComponentEntry => ({
  name,
  title,
  source: `components/${source}`,
  target: source,
  utils,
  description,
  ...(requires?.length ? { requires } : {}),
});

export const COMPONENTS: ComponentEntry[] = [
  C("button", "Button", "Button.tsx", ["cn", "gva"], "Clickable button with variants + sizes"),
  C("badge", "Badge", "Badge.tsx", ["cn", "gva"], "Small status pill with variants"),
  C("card", "Card", "Card.tsx", ["cn"], "Surface container (+ header/title/content/footer)"),
  C("input", "Input", "Input.tsx", ["cn"], "Themed text input (two-way bindable)"),
  C("textarea", "Textarea", "Textarea.tsx", ["cn"], "Themed multi-line input"),
  C("label", "Label", "Label.tsx", ["cn"], "Form label (wraps the headless Label)"),
  C("separator", "Separator", "Separator.tsx", ["cn"], "Horizontal/vertical divider"),
  C("skeleton", "Skeleton", "Skeleton.tsx", ["cn"], "Pulsing loading placeholder"),
  C("avatar", "Avatar", "Avatar.tsx", ["cn"], "Circular avatar with image + fallback"),
  C("switch", "Switch", "Switch.tsx", ["cn"], "On/off toggle bound to a boolean"),
  C("checkbox", "Checkbox", "Checkbox.tsx", ["cn"], "Checkbox bound to a boolean"),
  C("select", "Select", "Select.tsx", ["cn"], "Native select bound to a value"),
  C("radio-group", "RadioGroup", "RadioGroup.tsx", ["cn"], "Segmented radio set bound to a value"),
  C("dialog", "Dialog", "Dialog.tsx", ["cn"], "Modal dialog (focus-trapped)"),
  C("sheet", "Sheet", "Sheet.tsx", ["cn"], "Edge-anchored slide-over panel"),
  C(
    "dropdown-menu",
    "DropdownMenu",
    "DropdownMenu.tsx",
    ["cn"],
    "Keyboard-navigable menu (+ item/label/separator)",
  ),
  C("tabs", "Tabs", "Tabs.tsx", ["cn"], "Tabbed panels with a pill tablist"),
  C("alert", "Alert", "Alert.tsx", ["cn", "gva"], "Inline alert (+ title/description)"),
  C("tooltip", "Tooltip", "Tooltip.tsx", ["cn"], "Hover/focus tooltip"),
  C("table", "Table", "Table.tsx", ["cn"], "URL-sortable data table"),

  // ── Overlays & navigation ──────────────────────────────────────────────────
  C("popover", "Popover", "Popover.tsx", ["cn"], "Floating panel anchored to a trigger"),
  C("hover-card", "HoverCard", "HoverCard.tsx", ["cn"], "Preview panel shown on hover"),
  C(
    "alert-dialog",
    "AlertDialog",
    "AlertDialog.tsx",
    ["cn"],
    "Confirm before something irreversible",
    ["dialog", "button"],
  ),
  C("command", "Command", "Command.tsx", ["cn"], "Searchable command menu (⌘K palette)"),
  C("context-menu", "ContextMenu", "ContextMenu.tsx", ["cn"], "Right-click menu"),
  C("menubar", "Menubar", "Menubar.tsx", ["cn"], "Application menu bar", ["context-menu"]),
  C(
    "navigation-menu",
    "NavigationMenu",
    "NavigationMenu.tsx",
    ["cn"],
    "Site nav with dropdown panels",
  ),
  C("sidebar", "Sidebar", "Sidebar.tsx", ["cn"], "App shell nav rail with a mobile drawer"),
  C("breadcrumb", "Breadcrumb", "Breadcrumb.tsx", ["cn"], "Trail showing where a page sits"),
  C(
    "pagination",
    "Pagination",
    "Pagination.tsx",
    ["cn"],
    "Page links with a windowed number range",
  ),

  // ── Forms ──────────────────────────────────────────────────────────────────
  C("field", "Field", "Field.tsx", ["cn"], "Label + control + description + error"),
  C("input-group", "InputGroup", "InputGroup.tsx", ["cn"], "Input with affixes or addons"),
  C("input-otp", "InputOTP", "InputOTP.tsx", ["cn"], "One-time-code input"),
  C("combobox", "Combobox", "Combobox.tsx", ["cn"], "Autocomplete over many options"),
  C("slider", "Slider", "Slider.tsx", ["cn"], "Value chosen from a range"),
  C("toggle", "Toggle", "Toggle.tsx", ["cn", "gva"], "Pressed-state button (+ toggle group)"),
  C("button-group", "ButtonGroup", "ButtonGroup.tsx", ["cn"], "Buttons joined into one control"),
  C("calendar", "Calendar", "Calendar.tsx", ["cn"], "Month grid for picking or laying out dates"),
  C("date-picker", "DatePicker", "DatePicker.tsx", ["cn"], "Calendar in a popover", [
    "popover",
    "calendar",
  ]),

  // ── Feedback & status ──────────────────────────────────────────────────────
  C("toast", "Toaster", "Toast.tsx", [], "Host for transient flash messages"),
  C("progress", "Progress", "Progress.tsx", ["cn"], "Determinate progress bar"),
  C("spinner", "Spinner", "Spinner.tsx", ["gva"], "Indeterminate loading indicator"),
  C("empty", "Empty", "Empty.tsx", ["cn"], "Empty-state block with an action"),
  C("kbd", "Kbd", "Kbd.tsx", ["cn"], "Keyboard key (+ platform modifier)"),

  // ── Layout & content ───────────────────────────────────────────────────────
  C("accordion", "Accordion", "Accordion.tsx", ["cn"], "Stacked collapsible sections"),
  C("collapsible", "Collapsible", "Collapsible.tsx", ["cn"], "One section that opens and closes"),
  C("scroll-area", "ScrollArea", "ScrollArea.tsx", ["cn"], "Scrollable region with a styled bar"),
  C("resizable", "Resizable", "Resizable.tsx", ["cn"], "Two panes with a draggable handle"),
  C("carousel", "Carousel", "Carousel.tsx", ["cn"], "Snap-scrolling strip with controls"),
  C("aspect-ratio", "AspectRatio", "AspectRatio.tsx", ["cn"], "Fixed width-to-height box"),
  C("item", "Item", "Item.tsx", ["cn"], "Icon + title + description + action row"),
  C("chart", "Chart", "Chart.tsx", ["cn"], "SVG line, area, bar and donut charts"),
  C("typography", "Prose", "Typography.tsx", ["cn"], "Prose wrapper + heading helpers"),
];

/** Look up a component by its kebab-case id. */
export function findComponent(name: string): ComponentEntry | undefined {
  return COMPONENTS.find((c) => c.name === name);
}

/**
 * Expand a list of component ids to include everything they are built from.
 *
 * Asking for `date-picker` and getting a file that imports a `Calendar` which
 * was never copied is the failure this prevents. The result keeps the caller's
 * order and appends dependencies after it, so the CLI reports what was asked for
 * first and what came along second.
 */
export function withDependencies(names: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const visit = (name: string): void => {
    // A cycle in the registry would be a mistake rather than a shape to support,
    // but it must not hang the CLI while somebody finds it.
    if (seen.has(name)) return;
    seen.add(name);
    const entry = findComponent(name);
    out.push(name);
    for (const dep of entry?.requires ?? []) visit(dep);
  };

  for (const name of names) visit(name);
  return out;
}

/** Absolute path to a registry source file (`source` is relative to `src/`, except the theme). */
export function resolveSource(source: string): string {
  if (source === THEME.source) return join(PKG_ROOT, source);
  return join(PKG_ROOT, "src", source);
}

/**
 * Rewrite a component's util imports for the copy-in layout: `../utils/x.ts`
 * (the package layout) → `./lib/x.ts` (the app's UI dir layout). Idempotent and
 * a no-op for util files themselves (gva → `./cn.ts` stays a valid sibling import).
 */
export function rewriteImports(source: string): string {
  return source.replace(/(["'])\.\.\/utils\/(cn|gva)\.ts\1/g, "$1./lib/$2.ts$1");
}
