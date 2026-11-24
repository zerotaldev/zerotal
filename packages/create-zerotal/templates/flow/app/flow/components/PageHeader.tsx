import type { HtmlNode } from "@zerotal/flow";
import { Icon } from "./Icon";

/** The title row at the top of a signed-in page: what this is, and what you can do here. */
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: unknown;
  description?: unknown;
  actions?: unknown;
  /** A link back up a level, shown above the title. */
  back?: { href: string; label: string } | undefined;
}): HtmlNode {
  return (
    <header class="mb-8">
      {back ? (
        <a
          href={back.href}
          class="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon name="chevron-left" class="size-4" />
          {back.label}
        </a>
      ) : null}
      <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div class="min-w-0">
          <h1 class="text-2xl font-bold tracking-tight text-balance sm:text-3xl">{title}</h1>
          {description ? <p class="mt-1.5 text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div class="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
