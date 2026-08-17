import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePage } from "@inertiajs/react";
import FlashToasts from "../Components/FlashToasts";
import SessionWatcher from "../Components/SessionWatcher";
import AppHeader from "./AppHeader";
import AppSidebar from "./AppSidebar";

/**
 * The shell every signed-in screen renders inside.
 *
 * One shell rather than a layout per area is the whole point: Projects and
 * Profile share a rail, a header, a background, a content width and a padding
 * scale because they are the same object with different children — not because
 * two files were kept in step by hand.
 *
 * Content is capped at 1280px and padded 16/24/32px as the viewport grows, so
 * the first character of every page begins at the same horizontal position.
 *
 * Used as an Inertia persistent layout, so the rail mounts once and survives
 * navigation; only the content column re-renders.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const { url } = usePage();
  const [navOpen, setNavOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close the drawer once a visit lands, or it stays open over the page the
  // reader just navigated to.
  useEffect(() => setNavOpen(false), [url]);

  // The drawer is a modal surface: it traps Tab, closes on Escape, locks the
  // page behind it, and hands focus back where it came from.
  useEffect(() => {
    const node = drawerRef.current;
    if (!navOpen || !node) return;

    const returnFocusTo = document.activeElement as HTMLElement | null;
    const focusable = (): HTMLElement[] =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

    focusable()[0]?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // An open menu inside the drawer owns Escape first — closing the whole
        // drawer because someone dismissed a dropdown inside it loses their place.
        if (document.querySelector('[role="menu"]')) return;
        setNavOpen(false);
        return;
      }

      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;

      const first = items[0]!;
      const last = items[items.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      returnFocusTo?.focus();
    };
  }, [navOpen]);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-60 focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
      >
        {__("Skip to content")}
      </a>

      <AppSidebar className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:flex" />

      {navOpen && (
        <div className="lg:hidden">
          <div
            aria-hidden="true"
            onClick={() => setNavOpen(false)}
            className="fixed inset-0 z-40 bg-foreground/25"
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={__("Navigation")}
            className="fixed inset-y-0 left-0 z-50 w-60"
          >
            <AppSidebar className="flex h-full" onDismiss={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-60">
        <AppHeader onOpenNav={() => setNavOpen(true)} />

        <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>

      <FlashToasts />
      <SessionWatcher />
    </div>
  );
}
