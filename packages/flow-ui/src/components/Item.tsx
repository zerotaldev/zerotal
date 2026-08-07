/** @jsxImportSource @zerotal/flow */
// ── <Item> ──────────────────────────────────────────────────────────────────
//
// One row in a list: a glyph, a title with a supporting line, and something on
// the right. It is the shape behind a settings row, a search result, a member of
// a picker, a notification.
//
// Worth a component because the same three-part row gets rebuilt with slightly
// different alignment every time it is hand-written, and the details that go
// wrong are always the same two: the middle column needs `min-w-0` or a long
// title refuses to truncate, and the ends must not shrink or they get squeezed
// by that title.
//
//   <Item icon={<Icon name="users" />} title="Team" description="4 members"
//         action={<Button size="sm">Manage</Button>} />
//   <Item href="/products/1" title="Desk Lamp" description="R450" />

import { jsx } from "@zerotal/flow/jsx-runtime";
import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface ItemProps {
  /** Leading glyph or avatar. */
  icon?: unknown;
  title?: unknown;
  /** Supporting line under the title. */
  description?: unknown;
  /** Trailing content — a button, a badge, a chevron. */
  action?: unknown;
  /** Makes the whole row a link. */
  href?: string;
  /** Show hover feedback even without an href. */
  interactive?: boolean;
  /** Mark as the chosen one in a list. */
  selected?: boolean;
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function Item(props: ItemProps): HtmlNode {
  const {
    icon,
    title,
    description,
    action,
    href,
    interactive,
    selected,
    class: cls,
    children,
    ...rest
  } = props;

  const clickable = Boolean(href) || Boolean(interactive);

  const body = [
    icon
      ? jsx("span", {
          class: "flex shrink-0 items-center text-muted-foreground",
          children: icon,
        })
      : null,
    // min-w-0 is what allows the truncation below to happen at all.
    jsx("span", {
      class: "min-w-0 flex-1",
      children: [
        title
          ? jsx("span", { class: "block truncate text-sm font-medium", children: title })
          : null,
        description
          ? jsx("span", {
              class: "block truncate text-xs text-muted-foreground",
              children: description,
            })
          : null,
        children,
      ],
    }),
    action ? jsx("span", { class: "flex shrink-0 items-center gap-2", children: action }) : null,
  ];

  const className = cn(
    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left",
    clickable && "transition-colors hover:bg-accent hover:text-accent-foreground",
    selected && "bg-accent text-accent-foreground",
    cls,
  );

  return href
    ? jsx("a", { href, navigate: true, class: className, ...rest, children: body })
    : jsx("div", { class: className, ...rest, children: body });
}
