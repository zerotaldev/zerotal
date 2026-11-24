import type { ReactNode } from "react";
import { Link } from "@inertiajs/react";
import { AppLogo } from "../Components/AppLogo";
import { Card } from "../Components/Card";
import ThemeToggle from "../Components/ThemeToggle";
import Toasts from "../Components/Toasts";

/**
 * The shell of every screen between "signed out" and "signed in": sign in, register,
 * password reset, two-factor, email verification. A centred card, the app's name above
 * it, and nothing else competing for attention.
 *
 *   Page.layout = (page: ReactNode) => (
 *     <AuthLayout title="Sign in" description="Welcome back.">{page}</AuthLayout>
 *   );
 */
export default function AuthLayout({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** Below the card — "Don't have an account? Register". */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-grid" />
        <div className="absolute inset-x-0 top-0 h-136 bg-aurora" />
      </div>

      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <Link href={route("home")} className="rounded-lg">
        <AppLogo className="text-lg" />
      </Link>

      <main id="main" className="mt-8 w-full max-w-md">
        <Card className="p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-balance">{title}</h1>
          {description ? (
            <p className="mt-1.5 text-sm text-pretty text-muted-foreground">{description}</p>
          ) : null}
          <div className="mt-6">{children}</div>
        </Card>

        {footer ? (
          <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>
        ) : null}
      </main>

      <Toasts />
    </div>
  );
}
