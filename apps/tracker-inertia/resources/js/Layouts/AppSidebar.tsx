import { Link, usePage } from "@inertiajs/react";
import AccountMenu from "../Components/AccountMenu";
import Brand from "../Components/Brand";
import { ChartIcon, ClockIcon, CloseIcon, ProjectsIcon, UserIcon } from "../Components/Icons";
import { cn } from "../lib/cn";
import type { SharedProps } from "../types";

/**
 * The navigation rail: the mark, the sections, and who you are signed in as.
 *
 * Grouped rather than a flat list, because "Projects" and "Profile" are not the
 * same kind of destination — one is the work, the other is the account — and two
 * headings cost less than a reader wondering why they sit together. Sections are
 * only added here when the route behind them exists; a rail advertising features
 * the app does not have is worse than a short one.
 *
 * The rail stays neutral. The accent colour appears on the active item's icon and
 * nowhere else, so it never competes with the status and priority badges, which
 * are the only colour in this app that carries information.
 *
 * Rendered twice: fixed on the left from `lg` up, and inside the drawer below it.
 * Same component both times, so the two cannot drift.
 */

/**
 * Labels are the English words, translated at render.
 *
 * The structure is static; the words are not. Holding the English here is not
 * the same as hardcoding English — every one of these goes through `__()` below,
 * and the string doubles as its own catalog key. The upside over the
 * `nav.workspace` this used to hold is that the sidebar now reads as the
 * sidebar, in the file that defines it.
 */
const SECTIONS = [
  {
    label: "Workspace",
    items: [
      { href: route("dashboard"), label: "Dashboard", icon: ChartIcon },
      { href: route("projects"), label: "Projects", icon: ProjectsIcon },
      { href: route("activity"), label: "Activity", icon: ClockIcon },
    ],
  },
  {
    label: "Account",
    items: [{ href: route("profile"), label: "Profile", icon: UserIcon }],
  },
] as const;

/**
 * `usePage().url` carries the query string, so a plain `startsWith` marks
 * nothing active the moment a filter is applied — `/projects?status=todo` begins
 * with neither `/projects` nor `/projects/`. Compare paths only.
 */
export function isActive(url: string, href: string): boolean {
  const path = url.split("?")[0] ?? "/";
  return path === href || path.startsWith(`${href}/`);
}

export default function AppSidebar({
  className,
  onDismiss,
}: {
  className?: string;
  /** Set only for the drawer copy, which needs a way to close itself. */
  onDismiss?: () => void;
}) {
  const { url, props } = usePage<SharedProps>();
  const user = props.auth?.user;

  return (
    <aside className={cn("flex-col border-r border-border bg-card", className)}>
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-4">
        <Brand href="/" />

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={__("Close navigation")}
            className="grid size-9 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground lg:hidden"
          >
            <CloseIcon className="size-4.5" />
          </button>
        )}
      </div>

      <nav aria-label={__("Main")} className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="px-3 pb-1 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">
              {__(section.label)}
            </p>

            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(url, item.href);
                const Icon = item.icon;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-9 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors duration-150",
                        active
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon
                        className={cn("size-4 shrink-0", active ? "text-primary" : "text-current")}
                      />
                      {__(item.label)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {user && (
        <div className="shrink-0 border-t border-border p-2">
          <AccountMenu name={user.name} email={user.email} side="top" align="start" />
        </div>
      )}
    </aside>
  );
}
