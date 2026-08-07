import { Head, Link, Flash } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";

/**
 * Shell for the live Flow showcase pages (served at /showcase/flow/**).
 *
 * It's a plain function component wrapped around each page via the JSX-native
 * `layout(page)` hook. `<Link navigate>` swaps only the page body over the
 * WebSocket while this shell stays mounted, and marks the active item with
 * `data-current` (styled via the `data-[current]:` variant) — no `active` prop
 * to thread through. The `data-flow-layout` marker is what lets `navigate`
 * keep the shell across visits.
 */
const NAV: { href: string; label: string; blurb: string }[] = [
  { href: "/showcase/flow", label: "Overview", blurb: "What this is" },
  {
    href: "/showcase/flow/counter",
    label: "Counter",
    blurb: "Server actions vs client expressions",
  },
  {
    href: "/showcase/flow/lists",
    label: "Reactive lists",
    blurb: "<For> + optimistic collections",
  },
  {
    href: "/showcase/flow/streaming",
    label: "Streaming",
    blurb: "@task field streaming + cancel",
  },
  { href: "/showcase/flow/forms", label: "Forms", blurb: "Real-time validation" },
  {
    href: "/showcase/flow/components",
    label: "Components",
    blurb: "Modals, drawers, tabs, menus",
  },
  { href: "/showcase/flow/headless", label: "Headless", blurb: "Unstyled a11y primitives" },
  { href: "/showcase/flow/islands", label: "Islands", blurb: "Nested components, own state" },
  { href: "/showcase/flow/live", label: "Live & polling", blurb: "Server clock, loading states" },
  { href: "/showcase/flow/reorder", label: "Reorder", blurb: "Drag-and-drop sorting" },
  { href: "/showcase/flow/ui-kit", label: "flow-ui kit", blurb: "All 20 shadcn-style components" },
];

export function ShowcaseLayout(props: { children?: unknown }): HtmlNode {
  const link =
    "block rounded-lg px-3 py-2 no-underline transition-colors " +
    "text-stone-600 hover:bg-stone-100 hover:text-stone-900 " +
    "data-[current]:bg-voltage-50 data-[current]:text-voltage-700 data-[current]:font-semibold";

  return (
    <div data-flow-layout="showcase" class="min-h-screen bg-cream text-ink antialiased">
      <Head>
        {/* No <title> here — each page's `static title` sets the document title. */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/css/app.css" />
      </Head>

      <header class="sticky top-0 z-40 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div class="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <a
            href="/"
            class="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-ink no-underline"
          >
            <img src="/favicon.svg" alt="Zerotal mark" class="h-7 w-7 rounded-lg" />
            zerotal
          </a>
          <span class="rounded-full bg-voltage-50 px-2.5 py-0.5 text-xs font-semibold text-stone-700">
            Flow showcase
          </span>
          <div class="ml-auto flex items-center gap-4 text-sm">
            <a
              href="/docs/flow"
              class="font-semibold text-stone-500 no-underline transition-colors hover:text-stone-900"
            >
              Read the docs
            </a>
          </div>
        </div>
      </header>

      <div class="mx-auto flex max-w-6xl gap-8 px-4 py-8 sm:px-6">
        <aside class="hidden w-60 shrink-0 md:block">
          <p class="px-3 pb-2 text-xs font-bold uppercase tracking-widest text-stone-400">Demos</p>
          <nav class="space-y-0.5">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                navigate
                exact={n.href === "/showcase/flow"}
                class={link}
              >
                <span class="block text-sm">{n.label}</span>
                <span class="block text-xs text-stone-400">{n.blurb}</span>
              </Link>
            ))}
          </nav>
          <p class="mt-6 px-3 text-xs leading-relaxed text-stone-400">
            Every page here is a real server-driven Flow component over a WebSocket — open your
            devtools network tab to watch the patches.
          </p>
        </aside>

        <main class="min-w-0 flex-1">{props.children}</main>
      </div>

      <Flash position="bottom-right" />
    </div>
  );
}
