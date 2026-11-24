import type { ComponentType, ReactNode, SVGProps } from "react";
import { Link, usePage } from "@inertiajs/react";
import AppLayout from "./AppLayout";
import { PageHeader } from "../Components/PageHeader";
import {
  FingerprintIcon,
  LockIcon,
  MonitorIcon,
  PaletteIcon,
  ShieldIcon,
  TrashIcon,
  UserIcon,
} from "../Components/Icons";
import { cn } from "../lib/cn";
import type { SharedProps } from "../types";

interface Section {
  label: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/**
 * Settings: a list of sections beside the page on wide screens, a scrolling row of tabs
 * above it on narrow ones. Renders inside AppLayout.
 *
 *   Page.layout = (page: ReactNode) => <SettingsLayout>{page}</SettingsLayout>;
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  const { url, props } = usePage<SharedProps>();
  const path = url.split("?")[0] ?? url;

  const sections: Section[] = [
    { label: "Profile", href: "/settings/profile", icon: UserIcon },
    { label: "Password", href: "/settings/password", icon: LockIcon },
    { label: "Appearance", href: "/settings/appearance", icon: PaletteIcon },
    { label: "Two-factor", href: "/settings/two-factor", icon: ShieldIcon },
    // Only when PASSKEY_RP_ID is set; the routes are 404s otherwise.
    ...(props.features?.passkeys
      ? [{ label: "Passkeys", href: "/settings/passkeys", icon: FingerprintIcon }]
      : []),
    { label: "Sessions", href: "/settings/sessions", icon: MonitorIcon },
    { label: "Delete account", href: "/settings/delete-account", icon: TrashIcon },
  ];

  return (
    <AppLayout>
      <PageHeader title="Settings" description="Manage your account and how you sign in." />

      <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
        <nav
          aria-label="Settings"
          className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:w-52 lg:shrink-0 lg:px-0"
        >
          <ul className="flex gap-1 lg:flex-col">
            {sections.map((section) => {
              const active = path === section.href;
              const Icon = section.icon;
              return (
                <li key={section.href} className="shrink-0">
                  <Link
                    href={section.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {section.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 space-y-6 lg:max-w-2xl">{children}</div>
      </div>
    </AppLayout>
  );
}
