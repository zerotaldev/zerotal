import type { HtmlNode } from "@zerotal/flow";
import { Icon } from "./Icon";
import {
  PAGE_ACTIONS,
  PAGE_DESCRIPTION,
  PAGE_HEADER,
  PAGE_HEADER_BACK,
  PAGE_HEADER_ROW,
  PAGE_TITLE,
} from "../lib/ui";

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
    <header class={PAGE_HEADER}>
      {back ? (
        <a href={back.href} class={PAGE_HEADER_BACK}>
          <Icon name="chevron-left" class="size-4" />
          {back.label}
        </a>
      ) : null}
      <div class={PAGE_HEADER_ROW}>
        <div class="min-w-0">
          <h1 class={PAGE_TITLE}>{title}</h1>
          {description ? <p class={PAGE_DESCRIPTION}>{description}</p> : null}
        </div>
        {actions ? <div class={PAGE_ACTIONS}>{actions}</div> : null}
      </div>
    </header>
  );
}
