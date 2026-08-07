import { Component, Link } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { ShowcaseLayout } from "../ShowcaseLayout.tsx";

const DEMOS: { href: string; title: string; blurb: string }[] = [
  {
    href: "/showcase/flow/counter",
    title: "Counter",
    blurb:
      "The one distinction that runs everything: a method reference is a server action (round-trips), an arrow function is a client expression (instant). Same syntax as React.",
  },
  {
    href: "/showcase/flow/lists",
    title: "Reactive lists & optimistic collections",
    blurb:
      "<For> compiles to a reactive Alpine list, so appendOptimistic/removeOptimistic show a row the instant you click and reconcile when the server confirms.",
  },
  {
    href: "/showcase/flow/streaming",
    title: "Streaming @task",
    blurb:
      "An async @task streams a field's writes to the browser as they happen — the AI-answer / live-log primitive — with a loading state and $flow.cancel().",
  },
  {
    href: "/showcase/flow/forms",
    title: "Forms & real-time validation",
    blurb:
      "@validate rules checked on the server as you type; the field's error appears and clears with no action call and no client validation library.",
  },
  {
    href: "/showcase/flow/components",
    title: "Components",
    blurb:
      "The batteries-included kit: modals, drawers, dropdowns, tabbed panels and headless toggles — driven by one bound prop, and instant client-side.",
  },
  {
    href: "/showcase/flow/headless",
    title: "Headless primitives",
    blurb:
      "Switch, Select, Listbox, Combobox, Disclosure, Accordion, Popover, Tooltip — unstyled and accessible, emitting data-* state you paint with Tailwind variants.",
  },
  {
    href: "/showcase/flow/islands",
    title: "Islands",
    blurb:
      "Nested components, each with its own isolated state and update cycle — bump one and only that island re-renders. Props flow in through setup().",
  },
  {
    href: "/showcase/flow/live",
    title: "Live & polling",
    blurb:
      "A poll directive calls a server action on an interval, so the component re-renders with fresh server state — a live clock with no client timer code.",
  },
  {
    href: "/showcase/flow/reorder",
    title: "Drag to reorder",
    blurb:
      "onSort + sortItem give drag-and-drop reordering that calls a server action with the new index — the ordered list stays server-authoritative.",
  },
  {
    href: "/showcase/flow/ui-kit",
    title: "flow-ui component kit",
    blurb:
      "All 20 shadcn-style components from @zerotal/flow-ui — buttons, cards, dialogs, tables, form controls — themed by CSS variables and yours to own with flow:add.",
  },
];

/** Landing page for the live Flow showcase. */
export class IndexPage extends Component {
  static title = "Flow showcase — Zerotal";

  override layout(page: HtmlNode): HtmlNode {
    return <ShowcaseLayout>{page}</ShowcaseLayout>;
  }

  override async render(): Promise<HtmlNode> {
    return (
      <div class="space-y-8">
        <div>
          <h1 class="text-3xl font-extrabold tracking-tight text-slate-900">Flow, live</h1>
          <p class="mt-2 max-w-2xl text-slate-500">
            Flow is Zerotal's server-driven UI layer — each component is a TypeScript class that
            lives on the server, with decorators exposing state and actions to the browser over a
            WebSocket. These pages are the real thing, running now. Poke at them, then read how each
            one works in the{" "}
            <a href="/docs/flow" class="font-semibold text-orange-600">
              docs
            </a>
            .
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          {DEMOS.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              navigate
              hover
              class="group flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-5 no-underline shadow-sm transition-all hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-lg"
            >
              <span class="font-bold text-slate-900 group-hover:text-orange-600">{d.title}</span>
              <span class="text-sm leading-relaxed text-slate-500">{d.blurb}</span>
            </Link>
          ))}
        </div>
      </div>
    );
  }
}
