import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../lib/cn";
import { appName } from "../lib/site";

/** The logo mark and the app's name, as config/app.ts sets it. */
export function AppLogo({
  class: className,
  hideName = false,
}: {
  class?: string;
  hideName?: boolean;
}): HtmlNode {
  const name = appName();
  return (
    <span class={cn("flex min-w-0 items-center gap-2.5 font-semibold tracking-tight", className)}>
      <img src="/zt.svg" alt="" class="size-8 shrink-0 rounded-lg" />
      {hideName ? <span class="sr-only">{name}</span> : <span class="truncate">{name}</span>}
    </span>
  );
}
