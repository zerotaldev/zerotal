import { usePage } from "@inertiajs/react";
import Brand from "../Components/Brand";
import ThemeToggle from "../Components/ThemeToggle";
import { MenuIcon } from "../Components/Icons";
import AccountMenu from "../Components/AccountMenu";
import type { SharedProps } from "../types";

/**
 * The bar above the content column.
 *
 * Deliberately close to empty. The rail already says where you are and the page
 * header already says what you are looking at, so a third band repeating either
 * would be furniture. What is left is the theme control, and — only where the
 * rail is not on screen — the way into navigation and the account.
 *
 * The account menu appears here below `lg` and in the rail's footer above it, so
 * there is exactly one account control at any width rather than two identical
 * ones a few hundred pixels apart.
 */
export default function AppHeader({ onOpenNav }: { onOpenNav: () => void }) {
  const user = usePage<SharedProps>().props.auth?.user;
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label={__("Open navigation")}
        className="grid size-9 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground lg:hidden"
      >
        <MenuIcon className="size-4.5" />
      </button>

      <Brand href="/" className="lg:hidden" />

      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        {user && (
          <div className="lg:hidden">
            <AccountMenu compact name={user.name} email={user.email} />
          </div>
        )}
      </div>
    </header>
  );
}
