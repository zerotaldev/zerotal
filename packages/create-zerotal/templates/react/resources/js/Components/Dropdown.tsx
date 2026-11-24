import { Link } from "@inertiajs/react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import { cn } from "../lib/cn";

export interface DropdownItem {
  label: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>> | undefined;
  /** A link. With `method`, a form-like request instead (sign out is a POST). */
  href?: string | undefined;
  method?: "post" | "delete" | undefined;
  onSelect?: () => void | undefined;
  danger?: boolean | undefined;
}

/**
 * A menu behind a button, usable from the keyboard: Enter, Space or Arrow Down opens it
 * on the first item, the arrows and Home/End move between items, Escape closes it and
 * returns focus to the button, and Tab leaves it.
 */
export function Dropdown({
  trigger,
  label,
  header,
  items,
  align = "end",
  side = "bottom",
  className,
}: {
  /** The button's content. */
  trigger: ReactNode;
  /** The button's accessible name, when `trigger` is not text. */
  label?: string | undefined;
  /** Non-interactive content above the items — the signed-in user's name, say. */
  header?: ReactNode;
  items: DropdownItem[];
  align?: "start" | "end" | undefined;
  side?: "top" | "bottom" | undefined;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const menuItems = () =>
    Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  const focusItem = (index: number) => {
    const all = menuItems();
    if (all.length === 0) return;
    all[(index + all.length) % all.length]?.focus();
  };

  // Close on a click anywhere else.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const openOn = (index: number) => {
    setOpen(true);
    // After the menu renders.
    requestAnimationFrame(() => focusItem(index));
  };

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };

  const onButtonKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openOn(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openOn(-1);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const all = menuItems();
    const current = all.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem(current + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem(current - 1);
        break;
      case "Home":
        event.preventDefault();
        focusItem(0);
        break;
      case "End":
        event.preventDefault();
        focusItem(-1);
        break;
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  const itemClass = (danger?: boolean) =>
    cn(
      "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors",
      "focus-visible:bg-muted hover:bg-muted",
      danger ? "text-destructive" : "text-foreground",
    );

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={onButtonKeyDown}
        className="w-full rounded-lg"
      >
        {trigger}
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={cn(
            "absolute z-50 min-w-56 rounded-xl border border-border bg-card p-1.5 shadow-xl",
            align === "end" ? "right-0" : "left-0",
            side === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
          )}
        >
          {header ? (
            <div className="border-b border-border px-2.5 pt-1.5 pb-2.5 mb-1.5">{header}</div>
          ) : null}
          {items.map((item) => {
            const Icon = item.icon;
            const content = (
              <>
                {Icon ? <Icon className="size-4 shrink-0 opacity-70" /> : null}
                {item.label}
              </>
            );
            if (item.href) {
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  role="menuitem"
                  tabIndex={-1}
                  className={itemClass(item.danger)}
                  onClick={() => close(false)}
                  {...(item.method ? { method: item.method, as: "button" as const } : {})}
                >
                  {content}
                </Link>
              );
            }
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={itemClass(item.danger)}
                onClick={() => {
                  close(true);
                  item.onSelect?.();
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
