/**
 * Light, dark, or whatever the operating system says.
 *
 * The class on `<html>` is the single source of truth for what is on screen — every
 * colour in the app is a CSS custom property that `.dark` redefines, so flipping the
 * class re-themes the page. This module decides the class.
 *
 * The choice is stored under the key the no-flash script in app/flow/lib/document.ts
 * reads before the first paint (the same one @zerotal/flow-ui uses, so an app and its
 * admin panel agree). "system" is stored as no key at all.
 *
 * Anything with `data-appearance="light|dark|system"` sets it when clicked: the theme
 * menu's items and the options in Settings → Appearance. What shows the current choice
 * (`data-appearance-icon`, `data-appearance-option`) is kept in step here.
 */
export type Appearance = "light" | "dark" | "system";

const STORAGE_KEY = "zerotal-theme";

const systemQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function apply(appearance: Appearance): void {
  const dark = appearance === "system" ? systemQuery().matches : appearance === "dark";
  document.documentElement.classList.toggle("dark", dark);
}

/** Show which choice is current, wherever the page shows one. */
function reflect(appearance: Appearance): void {
  for (const icon of document.querySelectorAll<HTMLElement>("[data-appearance-icon]")) {
    icon.hidden = icon.dataset["appearanceIcon"] !== appearance;
  }
  for (const option of document.querySelectorAll<HTMLInputElement>("input[data-appearance]")) {
    option.checked = option.dataset["appearance"] === appearance;
    option.closest("label")?.toggleAttribute("data-checked", option.checked);
  }
}

export function setAppearance(appearance: Appearance): void {
  try {
    if (appearance === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, appearance);
  } catch {
    // Storage can be unavailable (private mode). The class is still applied; the
    // choice just won't survive a reload.
  }
  apply(appearance);
  reflect(appearance);
}

export function installTheme(): void {
  reflect(getAppearance());

  // Follow the OS while the choice is "system": a laptop that switches to dark at
  // sunset should take the app with it.
  systemQuery().addEventListener("change", () => {
    if (getAppearance() === "system") apply("system");
  });

  document.addEventListener("click", (event) => {
    const target = (event.target as Element).closest<HTMLElement>("button[data-appearance]");
    const choice = target?.dataset["appearance"];
    if (choice === "light" || choice === "dark" || choice === "system") setAppearance(choice);
  });
  document.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    const choice = target.matches("input[data-appearance]") ? target.dataset["appearance"] : null;
    if (choice === "light" || choice === "dark" || choice === "system") setAppearance(choice);
  });
}
