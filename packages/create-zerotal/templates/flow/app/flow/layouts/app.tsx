import { Layout, Link } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { asset } from "zerotal/assets";
import { Auth } from "zerotal/auth";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

// Shown to signed-in visitors and guests respectively, so the header always
// offers the next useful step rather than a link that would bounce them.
const AUTHED_NAV = [{ href: "/profile", label: "Profile" }];
const GUEST_NAV = [
  { href: "/login", label: "Sign in" },
  { href: "/register", label: "Register" },
];

export class AppLayout extends Layout {
  // Built by `bun zt serve` from resources/css/app.css (Tailwind). The bundler
  // mirrors the source layout under the asset outDir, so it lands at
  // public/css/app.css and is served from /css/app.css — not /app.css.
  //
  // A getter (not a static field) so asset() re-runs per request and picks up
  // the latest ?v= cache-busting token after a dev rebuild.
  static override get head(): string {
    return `
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/zt.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${asset("/css/app.css")}">
  `;
  }

  override render(slot: HtmlNode) {
    // Flow adds `data-current` to the <Link> matching the current URL — style the active item with it.
    const navLink =
      "rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 " +
      "data-[current]:bg-indigo-50 data-[current]:text-indigo-700";

    return (
      <div class="min-h-screen bg-linear-to-b from-white via-white to-indigo-50 text-gray-900 antialiased">
        <header class="sticky top-0 z-10 border-b border-gray-200/70 bg-white/80 backdrop-blur">
          <nav class="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
            {/* Brand opts out of the active style (current={false}) so it isn't highlighted on Home. */}
            <Link href="/" current={false} class="flex items-center gap-2 font-bold tracking-tight">
              <img src={asset("/zt.svg")} alt="" class="h-7 w-7" />
              <span>Zerotal</span>
            </Link>

            <div class="flex items-center gap-1">
              {[...NAV, ...(Auth.check() ? AUTHED_NAV : GUEST_NAV)].map((item) => (
                <Link href={item.href} hover class={navLink}>
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>
        </header>

        <main class="mx-auto max-w-3xl px-6 py-14">{slot}</main>
      </div>
    );
  }
}
