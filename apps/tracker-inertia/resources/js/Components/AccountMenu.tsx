import { router } from "@inertiajs/react";
import Avatar from "./Avatar";
import DropdownMenu, { DropdownItem, DropdownLabel, DropdownSeparator } from "./DropdownMenu";
import { ChevronDownIcon, LogOutIcon, UserIcon } from "./Icons";
import { cn } from "../lib/cn";
import { announce } from "../lib/session";
import { endpoint } from "../lib/endpoint";

/**
 * The account control, and the only place Sign out lives.
 *
 * Sign out is an action rather than a link, because it is a POST — a plain
 * anchor would be a URL any page could make a browser fetch, and the first
 * symptom would be visitors mysteriously logged out.
 *
 * Rendered in the rail's footer above `lg` and in the header below it, so there
 * is exactly one account control at any width rather than two identical ones a
 * few hundred pixels apart. `compact` is the header's form: an avatar alone,
 * named by `aria-label` because there is no visible text to do the job.
 */
export default function AccountMenu({
  name,
  email,
  side = "bottom",
  align = "end",
  compact = false,
}: {
  name: string;
  email: string;
  side?: "top" | "bottom";
  align?: "start" | "end";
  compact?: boolean;
}) {
  return (
    <DropdownMenu
      label={__("Account")}
      triggerLabel={compact ? `Account menu for ${name}` : undefined}
      side={side}
      align={align}
      triggerClassName={cn(
        "flex items-center rounded-md transition-colors duration-150 hover:bg-muted",
        compact ? "size-9 justify-center" : "w-full gap-2.5 p-2 text-left",
      )}
      trigger={
        compact ? (
          <Avatar name={name} size="md" />
        ) : (
          <>
            <Avatar name={name} size="lg" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">{email}</span>
            </span>
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
          </>
        )
      }
    >
      <DropdownLabel title={name} description={email} />
      <DropdownSeparator />
      <DropdownItem href={route("profile")}>
        <UserIcon className="size-4" />
        {__("Profile")}
      </DropdownItem>
      <DropdownSeparator />
      <DropdownItem
        danger
        onSelect={() => {
          // Announced before the POST, not after: the redirect that follows
          // unmounts this component, and a message posted from a dead tab is a
          // message nobody sends.
          announce("signed-out");
          const { url, method } = endpoint("logout.store");
          router.visit(url, { method });
        }}
      >
        <LogOutIcon className="size-4" />
        {__("Sign out")}
      </DropdownItem>
    </DropdownMenu>
  );
}
