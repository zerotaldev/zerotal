// ── <Tabs> ──────────────────────────────────────────────────────────────────
//
// Themed tabs. Built fresh over Flow's `flowTabs()`
// runtime (roving arrow-key nav, roles wired) with a token-themed pill tablist.
//
//   <Tabs items={[{ label: "Account", content: <…/> }, { label: "Password", content: <…/> }]} />

import { jsx } from "@zerotal/flow/jsx-runtime";
import { jsLiteral } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface TabItem {
  label: unknown;
  content: unknown;
  name?: string;
}

export interface TabsProps {
  items: TabItem[];
  class?: string;
  listClass?: string;
  [key: string]: unknown;
}

export function Tabs(props: TabsProps): HtmlNode {
  const { items, class: cls, listClass, ...rest } = props;
  const names = items.map((it, i) => it.name ?? String(i));
  const first = names[0] ?? "0";

  const bar = jsx("div", {
    role: "tablist",
    "x-on:keydown": "onKey($event)",
    class: cn(
      "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
      listClass,
    ),
    children: items.map((it, i) =>
      jsx("button", {
        type: "button",
        role: "tab",
        id: `flow-tab-${names[i]}`,
        "aria-controls": `flow-tabpanel-${names[i]}`,
        ":aria-selected": `tab === ${jsLiteral(names[i])}`,
        ":tabindex": `tab === ${jsLiteral(names[i])} ? 0 : -1`,
        "x-on:click": `tab = ${jsLiteral(names[i])}`,
        // Active tab gets the raised "pill" look; inactive stays muted.
        ":class": `tab === ${jsLiteral(names[i])} ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'`,
        class:
          "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring",
        children: it.label,
      }),
    ),
  });

  const panels = items.map((it, i) =>
    jsx("div", {
      role: "tabpanel",
      id: `flow-tabpanel-${names[i]}`,
      "aria-labelledby": `flow-tab-${names[i]}`,
      tabindex: 0,
      "x-show": `tab === ${jsLiteral(names[i])}`,
      "x-cloak": true,
      class: "mt-2 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md",
      children: it.content,
    }),
  );

  return jsx("div", {
    ...rest,
    "x-data": `flowTabs({ tab: ${jsLiteral(first)} })`,
    class: cn("flex flex-col", cls),
    children: [bar, ...panels],
  });
}
