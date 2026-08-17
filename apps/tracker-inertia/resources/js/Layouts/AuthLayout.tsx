import type { ReactNode } from "react";
import FlashToasts from "../Components/FlashToasts";
import ThemeToggle from "../Components/ThemeToggle";
import Brand from "../Components/Brand";
import { Link } from "@inertiajs/react";

/**
 * The shell for signing in, registering and resetting a password.
 *
 * One column, centred, `max-w-sm`, and no navigation. Deliberately not the
 * public shell: a person on this screen has one thing to do, and a header
 * offering five other things is five ways to not do it. The measure is narrow
 * for the same reason — a password field stretched across 1400px reads as a
 * search box.
 *
 * The only chrome is the mark, which says which product this is, and the theme
 * toggle, which has to exist on every page or the choice does not stick.
 */
/**
 * Props arrive as untranslated English and get translated in here.
 *
 * The auth pages assign their layout outside the component body
 * (`Page.layout = (page) => <AuthLayout …/>`), and translating there would once
 * have been impossible: `useTranslate()` was a hook, and that assignment is not
 * a render. Two things have since removed that constraint — the props carry
 * English rather than `auth.welcomeBack`, and `__()` is an ordinary function.
 * Either page or layout could translate now.
 *
 * It stays here because a layout that renders whatever string it is handed is
 * the version that cannot be half-translated: there is one `__()` per prop
 * rather than one per caller, and a new auth screen gets it for free.
 */
export default function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: { text: string; link: string; href: string };
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex h-16 shrink-0 items-center justify-between px-4 sm:px-6">
        <Brand href="/" />
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:pt-16">
        <div className="w-full max-w-sm">
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">{__(title)}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{__(subtitle)}</p>}
          </div>

          <div className="mt-6 rounded-xl border border-border bg-card p-6">{children}</div>

          {footer && (
            <p className="mt-5 text-center text-sm text-muted-foreground">
              {__(footer.text)}{" "}
              <Link href={footer.href} className="font-medium text-primary hover:underline">
                {__(footer.link)}
              </Link>
            </p>
          )}
        </div>
      </main>

      <FlashToasts />
    </div>
  );
}
