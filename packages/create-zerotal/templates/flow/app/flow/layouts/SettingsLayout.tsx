import type { HtmlNode } from "@zerotal/flow";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { cn } from "../lib/cn";
import type { IconName } from "../lib/icons";
import type { Shell } from "../lib/page";
import { AppLayout } from "./AppLayout";

interface Section {
  label: string;
  href: string;
  icon: IconName;
}

/**
 * Settings: a list of sections beside the page on wide screens, a scrolling row of tabs
 * above it on narrow ones. Renders inside AppLayout.
 *
 *   override layout(page: HtmlNode) {
 *     return <SettingsLayout shell={this.shell()}>{page}</SettingsLayout>;
 *   }
 */
export function SettingsLayout({
  shell,
  children,
}: {
  shell: Shell;
  children?: unknown;
}): HtmlNode {
  const sections: Section[] = [
    { label: "Profile", href: "/settings/profile", icon: "user" },
    { label: "Password", href: "/settings/password", icon: "lock" },
    { label: "Appearance", href: "/settings/appearance", icon: "palette" },
    { label: "Two-factor", href: "/settings/two-factor", icon: "shield" },
    // Only when PASSKEY_RP_ID is set; the routes are 404s otherwise.
    ...(shell.passkeys
      ? [{ label: "Passkeys", href: "/settings/passkeys", icon: "fingerprint" as const }]
      : []),
    { label: "Sessions", href: "/settings/sessions", icon: "monitor" },
    { label: "Delete account", href: "/settings/delete-account", icon: "trash" },
  ];

  return (
    <AppLayout shell={shell}>
      <PageHeader title="Settings" description="Manage your account and how you sign in." />

      <div class="flex flex-col gap-8 lg:flex-row lg:gap-12">
        <nav
          aria-label="Settings"
          class="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:w-52 lg:shrink-0 lg:px-0"
        >
          <ul class="flex gap-1 lg:flex-col">
            {sections.map((section) => {
              const active = shell.path === section.href;
              return (
                <li class="shrink-0">
                  <a
                    href={section.href}
                    aria-current={active ? "page" : undefined}
                    class={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon name={section.icon} class="size-4 shrink-0" />
                    {section.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div class="min-w-0 flex-1 space-y-6 lg:max-w-2xl">{children}</div>
      </div>
    </AppLayout>
  );
}
