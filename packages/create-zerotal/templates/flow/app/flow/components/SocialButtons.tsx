import type { HtmlNode } from "@zerotal/flow";
import { buttonClass } from "../lib/button";
import type { IconName } from "../lib/icons";
import { Icon } from "./Icon";

const PROVIDERS: Record<string, { label: string; icon: IconName }> = {
  github: { label: "GitHub", icon: "github" },
  google: { label: "Google", icon: "google" },
};

/**
 * "Continue with GitHub / Google", for the providers config/social.ts has switched on.
 * Plain links: they leave the app for the provider's site.
 */
export function SocialButtons({ providers }: { providers: string[] }): HtmlNode {
  const available = providers.filter((name) => name in PROVIDERS);
  if (available.length === 0) return { html: "" };

  return (
    <div class="grid gap-2 sm:grid-cols-2">
      {available.map((name) => {
        const { label, icon } = PROVIDERS[name]!;
        return (
          <a href={`/auth/${name}`} class={buttonClass("secondary", "md", "w-full")}>
            <Icon name={icon} class="size-4" />
            {label}
          </a>
        );
      })}
    </div>
  );
}

/** The "or" rule between one way of signing in and another. */
export function Divider({ label = "or" }: { label?: string }): HtmlNode {
  return (
    <div class="flex items-center gap-3 text-xs tracking-wide text-muted-foreground uppercase">
      <span class="h-px flex-1 bg-border" />
      {label}
      <span class="h-px flex-1 bg-border" />
    </div>
  );
}
