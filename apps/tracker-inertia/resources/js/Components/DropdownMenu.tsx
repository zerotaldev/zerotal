import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Link } from "@inertiajs/react";
import { cn } from "../lib/cn";

/**
 * A menu button — the account control in the header and the sidebar.
 *
 * Written out rather than pulled from a library because the app needs exactly
 * one menu and the keyboard contract is short: arrows move between items,
 * Escape closes and hands focus back to the trigger, a pointer press outside
 * dismisses, and choosing an item closes the menu. Items are real `<a>` and
 * `<button>` elements, so they are reachable by Tab and usable by a screen
 * reader whether or not the arrow handling is understood.
 *
 * Opening with a pointer does not move focus; opening with ArrowDown or Enter
 * lands on the first item. That distinction is the difference between a menu
 * that feels native and one that snatches the caret from under the mouse.
 */

interface MenuContext {
  close: (options?: { restoreFocus?: boolean }) => void;
}

const Context = createContext<MenuContext | null>(null);

function useMenu(): MenuContext {
  const context = useContext(Context);
  if (!context) throw new Error("Dropdown items must be rendered inside a <DropdownMenu>.");
  return context;
}

export default function DropdownMenu({
  label,
  triggerLabel,
  trigger,
  triggerClassName,
  align = "end",
  side = "bottom",
  children,
}: {
  /** Accessible name for the menu itself. */
  label: string;
  /**
   * Accessible name for the trigger, for triggers whose visible content is an
   * icon or an avatar. Leave it unset when the trigger already shows text — an
   * `aria-label` would override that text and hide the user's own name from a
   * screen reader in order to tell it something it could already read.
   */
  triggerLabel?: string | undefined;
  trigger: ReactNode;
  triggerClassName?: string;
  align?: "start" | "end";
  side?: "top" | "bottom";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Set when the menu is opened from the keyboard, read once by the effect that
  // moves focus. A pointer-opened menu leaves focus where the user put it.
  const focusFirstOnOpen = useRef(false);

  const close = useCallback(({ restoreFocus = true }: { restoreFocus?: boolean } = {}) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const itemsIn = (): HTMLElement[] =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;

    if (focusFirstOnOpen.current) {
      focusFirstOnOpen.current = false;
      itemsIn()[0]?.focus();
    }

    // `pointerdown` rather than `click`: a press that starts outside should
    // dismiss immediately, before the element under it acts on the release.
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    // Escape is bound to the document, not the menu, so it works while focus
    // sits on the trigger as well as on an item.
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  // Bound to the wrapper so the arrows work from the trigger as well as from an
  // item — otherwise a menu opened by click has no keyboard entry point.
  function onRootKeyDown(event: ReactKeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    if (!open) {
      event.preventDefault();
      focusFirstOnOpen.current = true;
      setOpen(true);
      return;
    }

    const items = itemsIn();
    if (items.length === 0) return;
    event.preventDefault();

    const current = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    // From outside the list (`-1`) ArrowDown lands on the first item and ArrowUp
    // on the last, which is what wrapping from either end should do.
    const next = current === -1 ? (step === 1 ? 0 : items.length - 1) : current + step;
    items[(next + items.length) % items.length]?.focus();
  }

  return (
    <div ref={rootRef} className="relative" onKeyDown={onRootKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={triggerClassName}
      >
        {trigger}
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          className={cn(
            "absolute z-50 min-w-56 rounded-xl border border-border bg-card p-1 shadow-lg",
            align === "end" ? "right-0" : "left-0",
            side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          )}
        >
          <Context.Provider value={{ close }}>{children}</Context.Provider>
        </div>
      )}
    </div>
  );
}

const ITEM =
  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground " +
  "transition-colors duration-150 hover:bg-muted hover:text-foreground focus:bg-muted focus:text-foreground";

/**
 * A menu entry. Give it `href` for navigation or `onSelect` for an action —
 * whichever it is, choosing it closes the menu.
 *
 * Focus is not restored to the trigger on selection: a navigation unmounts the
 * page, and an action's result belongs wherever it lands the reader.
 */
export function DropdownItem({
  href,
  onSelect,
  danger = false,
  children,
}: {
  href?: string;
  onSelect?: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  const { close } = useMenu();
  const className = cn(ITEM, danger && "text-destructive hover:text-destructive");

  if (href) {
    return (
      <Link
        href={href}
        role="menuitem"
        className={className}
        onClick={() => close({ restoreFocus: false })}
      >
        {children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      className={className}
      onClick={() => {
        close({ restoreFocus: false });
        onSelect?.();
      }}
    >
      {children}
    </button>
  );
}

/** The non-interactive block at the top of a menu — who you are signed in as. */
export function DropdownLabel({ title, description }: { title: string; description?: string }) {
  return (
    <div className="px-2.5 py-2">
      <p className="truncate text-sm font-medium text-foreground">{title}</p>
      {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

export function DropdownSeparator() {
  return <div role="separator" className="my-1 h-px bg-border" />;
}
