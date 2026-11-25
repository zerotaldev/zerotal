import type { HtmlNode } from "@zerotal/flow";
import { buttonClass } from "../lib/button";
import type { IconName } from "../lib/icons";
import { Icon } from "./Icon";
import { DIVIDER, DIVIDER_LINE } from "../lib/ui";

const PROVIDERS: Record<string, { label: string; icon: IconName }> = {
  github: { label: "GitHub", icon: "github" },
  google: { label: "Google", icon: "google" },
};

/**
 * "Continue with GitHub / Google", for the providers config/social.ts has switched on.
 * Plain links: they leave the app for the provider's site.
 */
/** The sign-in links for the providers that are switched on, in order. */
export function socialLinks(
  providers: string[],
): { href: string; label: string; icon: IconName }[] {
  return providers
    .filter((name) => name in PROVIDERS)
    .map((name) => ({ href: `/auth/${name}`, ...PROVIDERS[name]! }));
}

export function SocialButtons({ providers }: { providers: string[] }): HtmlNode {
  const links = socialLinks(providers);
  if (links.length === 0) return { html: "" };

  return (
    <div class="grid gap-2 sm:grid-cols-2">
      {links.map(({ href, label, icon }) => (
        <a href={href} class={buttonClass("secondary", "md", "w-full")}>
          <Icon name={icon} class="size-4" />
          {label}
        </a>
      ))}
    </div>
  );
}

/** The "or" rule between one way of signing in and another. */
export function Divider({ label = "or" }: { label?: string }): HtmlNode {
  return (
    <div class={DIVIDER}>
      <span class={DIVIDER_LINE} />
      {label}
      <span class={DIVIDER_LINE} />
    </div>
  );
}
