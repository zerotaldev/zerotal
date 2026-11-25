import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { AppLogo } from "../components/AppLogo";
import { Card } from "../components/Card";
import { ThemeToggle } from "../components/ThemeToggle";
import { Toasts } from "../components/Toasts";
import type { Shell } from "../lib/page";

/**
 * The shell of every screen between "signed out" and "signed in": sign in, register,
 * password reset, two-factor, email verification. A centred card, the app's name above
 * it, and nothing else competing for attention.
 *
 *   override layout(page: HtmlNode) {
 *     return (
 *       <AuthLayout shell={this.shell()} title="Sign in" description="Welcome back.">
 *         {page}
 *       </AuthLayout>
 *     );
 *   }
 */
export function AuthLayout({
  shell,
  title,
  description,
  footer,
  children,
}: {
  shell: Shell;
  title: string;
  description?: unknown;
  /** Below the card — "Don't have an account? Register". */
  footer?: unknown;
  children?: unknown;
}): HtmlNode {
  return (
    <div
      data-flow-layout="auth"
      class="relative flex min-h-dvh flex-col items-center justify-center px-4 py-12"
    >
      <div aria-hidden="true" class="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div class="absolute inset-0 bg-grid" />
        <div class="absolute inset-x-0 top-0 h-136 bg-aurora" />
      </div>

      <div class="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <a href={route("home")} class="rounded-lg">
        <AppLogo class="text-lg" />
      </a>

      <main id="main" class="mt-8 w-full max-w-md">
        <Card class="p-6 shadow-sm sm:p-8">
          <h1 class="text-xl font-semibold tracking-tight text-balance">{title}</h1>
          {description ? (
            <p class="mt-1.5 text-sm text-pretty text-muted-foreground">{description}</p>
          ) : null}
          <div class="mt-6">{children}</div>
        </Card>

        {footer ? <div class="mt-6 text-center text-sm text-muted-foreground">{footer}</div> : null}
      </main>

      <Toasts flash={shell.flash} />
    </div>
  );
}
