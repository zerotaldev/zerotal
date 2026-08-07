import type { Children } from "zerotal/view";
import { Logo } from "../components/Logo";

interface AppLayoutProps {
  title: string;
  /** Current request path — used to highlight the active nav item. */
  path?: string;
  children?: Children;
}

const NAV = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export default function AppLayout({ title, path = "/", children }: AppLayoutProps) {
  const navLink =
    "rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900";
  const activeLink = "bg-indigo-50 text-indigo-700";

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link rel="stylesheet" href="/app.css" />
        <script type="module" src="/app.js"></script>
      </head>
      <body class="min-h-screen bg-linear-to-b from-white via-white to-indigo-50 text-gray-900 antialiased">
        <header class="sticky top-0 z-10 border-b border-gray-200/70 bg-white/80 backdrop-blur">
          <nav class="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
            <a href="/" class="flex items-center gap-2 font-bold tracking-tight">
              <Logo class="h-7 w-7" />
              <span>Zerotal</span>
            </a>

            <div class="flex items-center gap-1">
              {NAV.map((item) => {
                const isActive = item.href === "/" ? path === "/" : path.startsWith(item.href);
                return (
                  <a href={item.href} class={`${navLink} ${isActive ? activeLink : ""}`}>
                    {item.label}
                  </a>
                );
              })}
            </div>
          </nav>
        </header>

        <main class="mx-auto max-w-3xl px-6 py-14">{children}</main>
      </body>
    </html>
  );
}
