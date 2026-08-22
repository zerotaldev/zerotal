/** @jsxImportSource @zerotal/flow */
import { Head, Link, Flash } from "@zerotal/flow";
import { RequestContext } from "zerotal";
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
  {
    href: "/showcase/flow/ai-chat",
    label: "AI chat",
    blurb: "Streaming tokens, cancellable",
  },
  {
    href: "/showcase/flow/ui-kit",
    label: "flow-ui kit",
    // 20 of the 53 in the catalogue — enough to show the theming, not the whole set.
    blurb: "20 representative components",
  },
];

const SITE = "https://zerotal.dev";

const DESCRIPTION =
  "Live, server-driven Flow demos: server actions, reactive lists, streaming, " +
  "real-time validation and the component kit — every one a real WebSocket, not a recording.";

/**
 * The path this page is being rendered for.
 *
 * The showcase is a Flow app, so there is no `pathname` prop threaded through the
 * layout — the request is in the context instead. Falls back to the section root
 * rather than emitting a canonical that points at the wrong page, which is worse
 * than a slightly blunt one.
 */
function currentPath(): string {
  try {
    return RequestContext.tryGet()?.url.pathname ?? "/showcase/flow";
  } catch {
    return "/showcase/flow";
  }
}

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
        {/* The demos had a title and nothing else: no canonical, no description,
            nothing to show when a link is shared. They are the most persuasive
            pages on the site and the least equipped to be found or posted. */}
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href={`${SITE}${currentPath()}`} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Zerotal" />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content={`${SITE}${currentPath()}`} />
        <meta property="og:image" content={`${SITE}/og.png`} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:description" content={DESCRIPTION} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/css/app.css" />
      </Head>

      {/* First tab stop. The demo list is a dozen links; without this a keyboard
          user walks all of them to reach the page they asked for. */}
      <a
        href="#demo"
        class="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-cream focus:no-underline focus:shadow-lg"
      >
        Skip to the demo
      </a>

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

      {/* Below `md` the sidebar is hidden and there was nothing in its place, so a
          phone reaching any demo had no way to any other one. A <details> needs no
          script — it is keyboard-operable, announces its own state, and survives
          the SPA swap because the shell stays mounted. */}
      <details class="mx-auto block max-w-6xl px-4 pt-4 sm:px-6 md:hidden">
        <summary class="cursor-pointer list-none rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700">
          Demos
        </summary>
        <nav
          aria-label="Demos"
          class="mt-2 space-y-0.5 rounded-lg border border-stone-200 bg-white p-2"
        >
          {NAV.map((n) => (
            <Link
              key={`m-${n.href}`}
              href={n.href}
              navigate
              exact={n.href === "/showcase/flow"}
              class={link}
            >
              <span class="block text-sm">{n.label}</span>
            </Link>
          ))}
        </nav>
      </details>

      <div class="mx-auto flex max-w-6xl gap-8 px-4 py-8 sm:px-6">
        <aside class="hidden w-60 shrink-0 md:block">
          <p class="px-3 pb-2 text-xs font-bold uppercase tracking-widest text-stone-400">Demos</p>
          <nav aria-label="Demos" class="space-y-0.5">
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

        <main id="demo" tabindex="-1" class="min-w-0 flex-1">
          {props.children}
        </main>
      </div>

      <Flash position="bottom-right" />
    </div>
  );
}
