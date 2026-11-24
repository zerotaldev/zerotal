import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

/**
 * Light, dark, or whatever the operating system says.
 *
 * The class on `<html>` is the single source of truth for what is on screen — every
 * colour in the app is a CSS custom property that `.dark` redefines, so flipping the
 * class re-themes the page with no re-render. This module decides the class.
 *
 * The choice is stored under the key the no-flash script in resources/app.html reads
 * before the first paint (the same one @zerotal/flow-ui uses, so an app and its admin
 * panel agree). "system" is stored as no key at all.
 */
export type Appearance = "light" | "dark" | "system";

const STORAGE_KEY = "zerotal-theme";
const EVENT = "app:appearance";

const systemQuery = () =>
  typeof window === "undefined" ? null : window.matchMedia("(prefers-color-scheme: dark)");

export function getAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function apply(appearance: Appearance): void {
  const dark = appearance === "system" ? Boolean(systemQuery()?.matches) : appearance === "dark";
  document.documentElement.classList.toggle("dark", dark);
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
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** The current choice. Every component using it stays in step; set it with `setAppearance`. */
export function useAppearance(): Ref<Appearance> {
  const appearance = ref<Appearance>("system");
  const sync = () => (appearance.value = getAppearance());
  // Follow the OS while the choice is "system": a laptop that switches to dark at
  // sunset should take the app with it.
  const onSystemChange = () => {
    if (getAppearance() === "system") apply("system");
  };

  onMounted(() => {
    sync();
    systemQuery()?.addEventListener("change", onSystemChange);
    window.addEventListener(EVENT, sync);
  });
  onBeforeUnmount(() => {
    systemQuery()?.removeEventListener("change", onSystemChange);
    window.removeEventListener(EVENT, sync);
  });

  return appearance;
}
