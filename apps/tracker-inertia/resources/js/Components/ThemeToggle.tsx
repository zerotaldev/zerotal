import { useCallback, useState } from "react";
import { MoonIcon, SunIcon } from "./Icons";

/**
 * Light/dark switch.
 *
 * The class on `<html>` is the single source of truth — every colour in the app
 * is a CSS custom property that `.dark` redefines, so flipping the class
 * re-themes the page with no re-render and no `dark:` variants scattered through
 * the components. The choice is persisted under the same storage key the
 * no-flash script in resources/app.html reads on boot.
 */

const STORAGE_KEY = "zerotal-theme";

function isDark(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

export default function ThemeToggle() {
  const [dark, setDark] = useState(isDark);

  const toggle = useCallback(() => {
    const next = !isDark();
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Storage can be unavailable (private mode). The class is still applied,
      // the choice just won't survive a reload.
    }
    setDark(next);
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {dark ? <MoonIcon className="size-4.5" /> : <SunIcon className="size-4.5" />}
    </button>
  );
}
