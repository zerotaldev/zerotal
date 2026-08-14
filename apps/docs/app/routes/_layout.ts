import { escapeHtml as escHtml } from "zerotal/helpers";
import { env } from "zerotal";
import { ZEROTAL_VERSION_SHORT } from "../version.ts";
import {
  loadApiNav,
  type ApiNavItem,
  type ApiNavSection,
  type ApiNavModule,
  type ApiNavPackage,
} from "@app/support/api-nav.ts";

/** Public origin, for the absolute URLs a crawler and a social card need. */
const SITE_URL = env("APP_URL", "https://zerotal.dev").replace(/\/$/, "");

export interface LayoutProps {
  content: string;
  title?: string;
  description?: string;
  pathname?: string;
  sidebar?: boolean;
  /** "guide" (default) uses the hand-written docs nav; "api" uses the generated API tree. */
  variant?: "guide" | "api";
}

// ── Sidebar navigation ────────────────────────────────────────────────────────
/** One sidebar link; `children` nests a foldable second level under it (e.g. "Admin Panel" → "Resources", "Tables", …). */
interface NavItem {
  label: string;
  slug: string;
  children?: { label: string; slug: string }[];
}

// A folder under `docs/` is always exactly one collapsible unit here — never a
// row of flat siblings. Large sections earn their own group, whose header is the
// section name and whose first item is the folder's `index.md` ("Getting
// Started"): Inertia, Flow, ORM Models, Testing, Database. Smaller ones nest
// as a foldable item inside a broader group, where the parent row *is* the
// landing page: HTTP Client, Broadcasting, Admin Panel.
// Adding a `docs/<section>/` folder means picking one of those two shapes —
// putting `<section>/child` entries at the top level would split one folder
// across several sidebar rows. A topic that reads better start-to-finish stays a
// single `docs/<section>.md` with no folder at all, the way Authentication,
// Assets, Routing, and Carbon do.
const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Prologue",
    items: [
      { label: "About Zerotal", slug: "about" },
      { label: "Release Notes", slug: "changelog" },
      { label: "Upgrade Guide", slug: "upgrade" },
      { label: "Support Policy", slug: "support-policy" },
      { label: "Contribution Guide", slug: "contributing" },
    ],
  },
  {
    group: "Getting Started",
    items: [
      { label: "Installation", slug: "getting-started" },
      { label: "Directory Structure", slug: "structure" },
      { label: "Configuration", slug: "config-system" },
      { label: "Conventions", slug: "conventions" },
      { label: "Commands", slug: "commands" },
      { label: "Scaffolding", slug: "scaffolding" },
      { label: "Deployment", slug: "deployment" },
    ],
  },
  {
    group: "Architecture Concepts",
    items: [
      { label: "The Application", slug: "application" },
      { label: "Request Lifecycle", slug: "lifecycle" },
      { label: "Service Container", slug: "container" },
      { label: "Service Providers", slug: "providers" },
      { label: "Events", slug: "events" },
    ],
  },
  {
    group: "The Basics",
    items: [
      { label: "Routing", slug: "routing" },
      { label: "Middleware", slug: "middleware" },
      { label: "Controllers", slug: "controllers" },
      { label: "Requests Context", slug: "context" },
      { label: "Responses", slug: "responses" },
      { label: "Validation", slug: "validator" },
      { label: "Session", slug: "session" },
      { label: "Cookies", slug: "cookies" },
      { label: "CSRF Protection", slug: "csrf" },
      { label: "Error Handling", slug: "errors" },
      { label: "Logger", slug: "logger" },
    ],
  },
  {
    group: "Frontend",
    items: [
      { label: "Views", slug: "view" },
      { label: "Assets", slug: "assets" },
      { label: "Components", slug: "components" },
    ],
  },
  {
    group: "Inertia",
    items: [
      { label: "Getting Started", slug: "inertia" },
      { label: "Rendering Pages", slug: "inertia/rendering" },
      { label: "Props", slug: "inertia/props" },
      { label: "Middleware & Versioning", slug: "inertia/middleware" },
      { label: "Server-Side Rendering", slug: "inertia/ssr" },
      { label: "CLI & Build", slug: "inertia/build" },
      { label: "References", slug: "inertia/references" },
    ],
  },
  {
    group: "Flow",
    items: [
      { label: "Getting Started", slug: "flow" },
      { label: "Routing", slug: "flow/routing" },
      { label: "Decorators", slug: "flow/decorators" },
      { label: "Lifecycle Hooks", slug: "flow/lifecycle" },
      { label: "Events & Broadcasting", slug: "flow/events" },
      { label: "Forms & Uploads", slug: "flow/forms" },
      { label: "Pagination", slug: "flow/pagination" },
      { label: "Built-in Components", slug: "flow/components" },
      { label: "Layouts & Composition", slug: "flow/layouts" },
      { label: "Transport & Performance", slug: "flow/performance" },
      { label: "Testing", slug: "flow/testing" },
      { label: "References", slug: "flow/references" },
    ],
  },
  {
    group: "Database",
    items: [
      { label: "Getting Started", slug: "database" },
      { label: "Query Builder", slug: "query-builder" },
      { label: "Migrations", slug: "migrations" },
      { label: "Seeding", slug: "seeding" },
      { label: "Pagination", slug: "pagination" },
    ],
  },
  {
    group: "ORM Models",
    items: [
      { label: "Getting Started", slug: "orm" },
      { label: "Casts & Mutators", slug: "orm/casts" },
      { label: "Queries", slug: "orm/queries" },
      { label: "Relationships", slug: "orm/relationships" },
      { label: "Serialization", slug: "orm/serialization" },
      { label: "Lifecycle & Events", slug: "orm/lifecycle" },
      { label: "Factories", slug: "orm/factories" },
    ],
  },
  {
    group: "Security",
    items: [
      { label: "Authentication", slug: "authentication" },
      { label: "Authorization", slug: "authorization" },
      // The page is two-factor authentication; roles and permissions live in
      // Authorization above. The slug is kept so existing links keep working.
      { label: "Two-Factor Authentication", slug: "roles-and-2fa" },
      { label: "Social Login", slug: "social" },
      { label: "Email Verification", slug: "email-verification" },
      { label: "Password Reset", slug: "password-reset" },
      { label: "Encryption & Hashing", slug: "encryption" },
    ],
  },
  {
    group: "Digging Deeper",
    items: [
      { label: "Helpers", slug: "helpers" },
      { label: "Carbon", slug: "carbon" },
      {
        label: "HTTP Client",
        slug: "client",
        children: [
          { label: "Requests", slug: "client/requests" },
          { label: "Authentication", slug: "client/auth" },
          { label: "Error Handling", slug: "client/errors" },
          { label: "Resilience", slug: "client/resilience" },
          { label: "File Transfers", slug: "client/files" },
          { label: "Testing", slug: "client/testing" },
          { label: "References", slug: "client/references" },
        ],
      },
      { label: "Rate Limiting", slug: "rate-limiting" },
      { label: "Notifications & Mail", slug: "notifications" },
      { label: "Queue", slug: "queue" },
      { label: "Scheduler", slug: "scheduler" },
      { label: "Cache", slug: "cache" },
      { label: "Storage", slug: "storage" },
      { label: "Media Library", slug: "media" },
      {
        label: "Broadcasting",
        slug: "broadcasting",
        children: [
          { label: "Events", slug: "broadcasting/events" },
          { label: "Channels", slug: "broadcasting/channels" },
          { label: "On the Client", slug: "broadcasting/client" },
          { label: "Testing", slug: "broadcasting/testing" },
          { label: "References", slug: "broadcasting/references" },
        ],
      },
      { label: "Locking", slug: "lock" },
      { label: "i18n", slug: "i18n" },
      { label: "Health", slug: "health" },
      { label: "Devtools", slug: "devtools" },
    ],
  },
  {
    group: "Testing",
    items: [
      { label: "Getting Started", slug: "testing" },
      { label: "HTTP Tests", slug: "testing/http" },
      { label: "Console Tests", slug: "testing/console" },
      { label: "Browser Tests", slug: "testing/browser" },
      { label: "Database", slug: "testing/database" },
      { label: "Mocking", slug: "testing/mocking" },
    ],
  },
  {
    group: "Official Packages",
    items: [
      {
        label: "Admin Panel",
        slug: "admin",
        children: [
          { label: "Resources", slug: "admin/resources" },
          { label: "Tables", slug: "admin/tables" },
          { label: "Forms & Infolists", slug: "admin/forms" },
          { label: "Actions & Relations", slug: "admin/actions" },
          { label: "Panel Structure", slug: "admin/structure" },
          { label: "Dashboard & Navigation", slug: "admin/dashboard" },
          { label: "Extending the UI", slug: "admin/extending-ui" },
          { label: "Operations", slug: "admin/operations" },
          { label: "Custom Pages & Plugins", slug: "admin/extending" },
          { label: "Auth Pages & Theming", slug: "admin/auth" },
          { label: "Testing", slug: "admin/testing" },
          { label: "References", slug: "admin/references" },
        ],
      },
      { label: "AI", slug: "ai" },
      { label: "Monitor", slug: "monitor" },
      { label: "Multi-tenancy", slug: "tenancy" },
      { label: "Telemetry", slug: "telemetry" },
      { label: "Audit Logging", slug: "audit" },
    ],
  },
  {
    group: "Resources",
    items: [
      { label: "API Reference", slug: "api" },
      { label: "Package Development", slug: "package-development" },
      { label: "Inspirations", slug: "inspirations" },
    ],
  },
];

// Flattened, ordered list of pages — powers prev/next navigation. Nested
// children are spliced in right after their parent, same order as before.
const FLAT: { label: string; slug: string }[] = NAV.flatMap((g) =>
  g.items.flatMap((item) => (item.children?.length ? [item, ...item.children] : [item])),
);

// ── Sidebar link styling ──────────────────────────────────────────────────────
// Every link sits on the 1px rail drawn by its parent <ul> and carries its own
// left border pulled back a pixel, so an active or hovered link *replaces* that
// segment of rail rather than drawing a second line beside it. Filled pills are
// deliberately avoided: across three nesting levels they stack into blocks that
// fight the rails, whereas one accent segment stays legible at any depth.
const RAIL = "border-l border-stone-200/80";
const LINK_BASE = "block -ml-px border-l no-underline transition-colors duration-100";

/** Vertical rhythm per nesting level. */
const LINK_SIZE = {
  leaf: "pl-4 pr-2 py-1.5 text-[0.8125rem]",
  nested: "pl-4 pr-2 py-1 text-[0.8125rem]",
  parent: "pl-4 pr-2 py-1.5 text-[0.8125rem]",
} as const;

type LinkVariant = keyof typeof LINK_SIZE;
/** `open` is a parent whose *child* is the current page — a heading, not a target. */
type LinkState = "active" | "open" | "rest";

// No variant sets `border-l-…` twice: the state supplies the only border colour,
// because Tailwind resolves same-property utilities by stylesheet order, not by
// the order they appear in the class attribute.
const LINK_TONE: Record<LinkVariant, Record<LinkState, string>> = {
  leaf: {
    active: "border-voltage-700 font-medium text-voltage-700",
    open: "border-transparent text-stone-700",
    rest: "border-transparent text-stone-600 hover:border-stone-300 hover:text-stone-900",
  },
  nested: {
    active: "border-voltage-700 font-medium text-voltage-700",
    open: "border-transparent text-stone-500",
    rest: "border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-900",
  },
  parent: {
    active: "border-voltage-700 font-semibold text-voltage-700",
    open: "border-transparent font-semibold text-stone-900",
    rest: "border-transparent font-medium text-stone-700 hover:border-stone-300 hover:text-stone-900",
  },
};

function linkClass(state: LinkState, variant: LinkVariant = "leaf"): string {
  return `${LINK_BASE} ${LINK_SIZE[variant]} ${LINK_TONE[variant][state]}`;
}

/** Section label above a group of links — quiet enough to read as a divider. */
const GROUP_BTN =
  "nav-group-btn flex w-full items-center justify-between gap-2 px-3 pt-4 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-stone-400 hover:text-stone-600 transition-colors bg-transparent border-0 cursor-pointer";

const chevronSvg = (cls: string, expanded: boolean): string =>
  `<svg class="${cls} w-2.5 h-2.5 shrink-0 opacity-80 transition-transform duration-150${expanded ? "" : " -rotate-90"}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>`;

/** The filter field, shared by both sidebars. `/` focuses it (see app.js). */
const searchBox = (label: string, placeholder: string, empty: string): string => `
        <div class="mb-2">
          <div class="relative">
            <svg class="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
            <input id="sidebar-search" type="text" aria-label="${label}" placeholder="${placeholder}" autocomplete="off"
                   class="w-full bg-stone-50 border border-stone-200 rounded-md pl-8.5 pr-9 py-1.5 text-[0.8125rem] text-stone-900 focus:outline-none focus:bg-white focus:ring-2 focus:ring-voltage-700/20 focus:border-voltage-700/50 transition-all placeholder:text-stone-400">
            <kbd class="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-stone-200 bg-white px-1.5 text-[0.65rem] font-medium text-stone-400 pointer-events-none">/</kbd>
          </div>
          <p id="search-empty" class="hidden px-1 pt-3 text-[0.8125rem] text-stone-400">${empty}</p>
        </div>`;

function renderSidebar(pathname = ""): string {
  // A page is "active" for its own URL and any nested URL beneath it, so deep
  // pages (e.g. `/docs/api/@zerotal/core/...`) still highlight their nav item.
  // Used for expand state (a parent should open when any descendant is the
  // current page) — but NOT for the parent's own link colour, or visiting a
  // child would light up both the parent and the child at once.
  const isActive = (slug: string): boolean => {
    const href = `/docs/${slug}`;
    return pathname === href || pathname === href + "/" || pathname.startsWith(href + "/");
  };
  // Exact match only — used for the parent's own link colour, so "Admin
  // Panel" only takes the accent when it's the page you're actually on.
  const isExactActive = (slug: string): boolean => {
    const href = `/docs/${slug}`;
    return pathname === href || pathname === href + "/";
  };

  // A leaf link — used for plain items and for grandchildren nested under a
  // foldable parent (e.g. "Resources" under "Admin Panel").
  const renderLeaf = ({ label, slug }: { label: string; slug: string }, nested = false): string =>
    `<li class="nav-item list-none" data-label="${escHtml(label.toLowerCase())}"><a href="/docs/${slug}" class="${linkClass(isExactActive(slug) ? "active" : "rest", nested ? "nested" : "leaf")}">${label}</a></li>`;

  // An item with children renders its own link plus a fold toggle, and its
  // children get their own indented rail. A parent whose child is the current
  // page turns dark-and-bold rather than accented, so exactly one link in the
  // tree ever wears the blue marker: the page you're on.
  const renderItem = (item: NavItem): string => {
    const { label, slug, children } = item;
    if (!children?.length) return renderLeaf(item);

    const expanded = isActive(slug);
    const state: LinkState = isExactActive(slug) ? "active" : expanded ? "open" : "rest";
    const childLinks = children.map((c) => renderLeaf(c, true)).join("\n");
    return `
      <li class="nav-item nav-parent list-none" data-label="${escHtml(label.toLowerCase())}">
        <div class="flex items-center">
          <a href="/docs/${slug}" class="flex-1 min-w-0 ${linkClass(state, "parent")}">${label}</a>
          <button type="button" class="nav-child-btn shrink-0 p-1.5 text-stone-300 hover:text-stone-600 bg-transparent border-0 cursor-pointer transition-colors" aria-label="Toggle ${escHtml(label)} section">
            ${chevronSvg("nav-child-chevron", expanded)}
          </button>
        </div>
        <ul class="m-0 p-0 my-0.5 ml-4 ${RAIL} space-y-px ${expanded ? "" : "hidden"}" data-child-items>${childLinks}</ul>
      </li>`;
  };

  const groups = NAV.map(({ group, items }) => {
    const isActiveGroup = items.some(
      ({ slug, children }) => isActive(slug) || (children?.some((c) => isActive(c.slug)) ?? false),
    );
    const links = items.map(renderItem).join("\n");
    const chevron = chevronSvg("nav-group-chevron", isActiveGroup);
    return `
      <li class="nav-group list-none">
        <button class="${GROUP_BTN}">
          <span>${group}</span>${chevron}
        </button>
        <ul class="m-0 p-0 ml-3 pb-1 ${RAIL} space-y-px${isActiveGroup ? "" : " hidden"}" data-group-items>${links}</ul>
      </li>`;
  }).join("\n");

  return `
    <nav id="sidebar" class="fixed top-16 left-0 w-72 h-[calc(100vh-4rem)] overflow-y-auto bg-white border-r border-stone-200 z-40 hidden md:block"
         aria-label="Documentation navigation">
      <div class="px-4 py-5">
        ${searchBox("Filter documentation", "Filter…", "No matching pages.")}
        <ul id="nav-list" class="m-0 p-0">${groups}</ul>
      </div>
    </nav>`;
}

// ── API reference sidebar (data-driven from docs/api/nav.json) ────────────────

/** Symbol-kind folder names — used to locate the current module within a path. */
const API_KIND_DIRS = new Set([
  "classes",
  "interfaces",
  "functions",
  "variables",
  "type-aliases",
  "enumerations",
  "facades",
]);

const _API_LINK_ACTIVE = `${linkClass("active")} truncate`;
const _API_LINK_INACTIVE = `${linkClass("rest")} truncate`;

export function isApiPath(pathname: string): boolean {
  return pathname === "/docs/api" || pathname.startsWith("/docs/api/");
}

/**
 * Render the "API Reference" sidebar: every package is listed; the package (and,
 * for multi-entry packages, the module) matching the current path expands to
 * show its symbols grouped by kind. Falls back to the guide sidebar if the nav
 * data hasn't been generated (`bun run docs:api`). Reuses the guide sidebar's
 * `#sidebar` / `#nav-list` / `.nav-item` structure so the filter + active-link
 * JS work unchanged; the single wrapping `.nav-group` has no toggle button, so
 * `syncGroupCollapse` leaves it permanently open.
 */
function renderApiSidebar(pathname = ""): string {
  const nav = loadApiNav();
  if (!nav) return renderSidebar(pathname);

  // Module/package landing pages resolve to a `README` file (the router
  // redirects the bare directory URL there), so normalise it off before
  // deriving the active package/module and matching active links.
  const normPath = pathname.replace(/\/$/, "").replace(/\/README$/, "");
  const apiRel = normPath.replace(/^\/docs\/api\/?/, "");
  const parts = apiRel ? apiRel.split("/") : [];
  const currentPkg =
    parts.length >= 2 && parts[0]!.startsWith("@") ? `${parts[0]}/${parts[1]}` : "";
  const kindIdx = parts.findIndex((p) => API_KIND_DIRS.has(p));
  const currentModule = kindIdx > 0 ? parts.slice(0, kindIdx).join("/") : apiRel;

  const anchor = (name: string, slug: string, extra = ""): string => {
    const href = `/docs/api/${slug}`;
    const cls = normPath === href ? _API_LINK_ACTIVE : _API_LINK_INACTIVE;
    return `<a href="${href}" class="${cls} ${extra}">${escHtml(name)}</a>`;
  };
  const link = (name: string, slug: string, extra = ""): string =>
    `<li class="nav-item list-none" data-label="${escHtml(name.toLowerCase())}">${anchor(name, slug, extra)}</li>`;

  const kindHeader = (label: string): string =>
    `<li class="list-none mt-2"><p class="m-0 pl-4 pr-2 pb-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.09em] text-stone-400">${escHtml(label)}</p></li>`;

  const sectionBlock = (s: ApiNavSection): string =>
    kindHeader(s.label) +
    s.items.map((it: ApiNavItem) => link(it.name, it.slug, "font-mono text-[0.8rem]")).join("");

  const moduleBlock = (m: ApiNavModule): string => {
    if (m.label === "") return m.sections.map(sectionBlock).join(""); // single-entry package
    const expanded = m.slug === currentModule;
    const sub = expanded
      ? `<ul class="m-0 p-0 my-0.5 ml-4 ${RAIL} space-y-px">${m.sections.map(sectionBlock).join("")}</ul>`
      : "";
    return `<li class="nav-item list-none mt-1.5" data-label="${escHtml(m.label.toLowerCase())}">${anchor(m.label, m.slug, "font-mono text-[0.8rem]")}${sub}</li>`;
  };

  const packageBlock = (p: ApiNavPackage): string => {
    if (p.slug !== currentPkg) return link(p.name, p.slug, "font-mono text-[0.8rem]");
    const header = link(p.name, p.slug, "font-mono text-[0.8rem] font-bold");
    const body = p.modules.map(moduleBlock).join("");
    return `${header}<li class="list-none"><ul class="m-0 p-0 space-y-0.5">${body}</ul></li>`;
  };

  const list = nav.packages.map(packageBlock).join("\n");

  return `
    <nav id="sidebar" class="fixed top-16 left-0 w-72 h-[calc(100vh-4rem)] overflow-y-auto bg-white border-r border-stone-200 z-40 hidden md:block"
         aria-label="API reference navigation">
      <div class="px-4 py-5">
        <a href="/docs/getting-started" class="inline-flex items-center gap-1.5 mb-3 text-[0.8125rem] text-stone-500 hover:text-stone-900 no-underline transition-colors">← Documentation</a>
        ${searchBox("Filter API symbols", "Filter symbols…", "No matching symbols.")}
        <ul id="nav-list" class="m-0 p-0">
          <li class="nav-group list-none">
            <ul data-group-items class="m-0 p-0 ml-3 ${RAIL} space-y-px">${list}</ul>
          </li>
        </ul>
      </div>
    </nav>`;
}

function renderPrevNext(pathname = ""): string {
  const idx = FLAT.findIndex(
    (i) => pathname === `/docs/${i.slug}` || pathname === `/docs/${i.slug}/`,
  );
  if (idx === -1) return "";
  const prev = FLAT[idx - 1];
  const next = FLAT[idx + 1];
  const card = (item: { label: string; slug: string } | undefined, dir: "prev" | "next") => {
    if (!item) return `<div></div>`;
    const align = dir === "next" ? "text-right items-end" : "items-start";
    const arrow = dir === "next" ? "Next →" : "← Previous";
    return `<a href="/docs/${item.slug}" class="group flex flex-col ${align} gap-0.5 px-4 py-3 rounded-lg border border-stone-200 bg-white hover:border-voltage-700/40 hover:bg-voltage-50/70 transition-colors no-underline">
      <span class="text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-stone-400">${arrow}</span>
      <span class="text-sm font-medium text-stone-800 group-hover:text-voltage-700">${escHtml(item.label)}</span>
    </a>`;
  };
  return `
    <div class="mt-12 pt-6 border-t border-stone-200 grid grid-cols-2 gap-4">
      ${card(prev, "prev")}
      ${card(next, "next")}
    </div>`;
}

// ── Header variants ───────────────────────────────────────────────────────────

const _GH_ICON = `<svg viewBox="0 0 16 16" class="w-5 h-5 fill-current" xmlns="http://www.w3.org/2000/svg"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>`;

// The mark: Voltage slashed zero on an Ink tile (the favicon lockup, header-sized).
const _MARK = `<svg viewBox="0 0 64 64" class="w-7 h-7 shrink-0 group-hover:scale-105 transition-transform" role="img" aria-label="Zerotal mark" xmlns="http://www.w3.org/2000/svg">
        <rect width="64" height="64" rx="14" fill="#0B0D0C"/>
        <g transform="translate(32,32) scale(0.78) translate(-32,-32)">
          <defs><mask id="mark-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
            <rect x="0" y="0" width="64" height="64" fill="#fff"/>
            <line x1="18.455" y1="49.336" x2="50.285" y2="8.596" stroke="#000" stroke-width="17.0" stroke-linecap="round"/>
          </mask></defs>
          <g fill="none" stroke="#B4F135" stroke-width="9.0">
            <circle cx="32" cy="32" r="22.0" mask="url(#mark-cut)"/>
            <line x1="18.455" y1="49.336" x2="50.285" y2="8.596" stroke-linecap="round"/>
          </g>
        </g>
      </svg>`;

const _LOGO = `<a href="/" class="flex items-center gap-2.5 font-display font-bold text-lg text-ink tracking-tight no-underline group">
        ${_MARK}
        zerotal
      </a>`;

const _BADGE = `<span class="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-voltage-50 border border-voltage-100 text-[0.6875rem] font-semibold tracking-wide text-stone-700 uppercase">
        <span class="w-1.5 h-1.5 rounded-full bg-voltage-700"></span>
        v${ZEROTAL_VERSION_SHORT}
      </span>`;

function renderHeader(sidebar: boolean): string {
  if (!sidebar) {
    return `<header class="fixed top-0 left-0 right-0 h-16 flex items-center justify-between px-4 sm:px-8 bg-white/90 backdrop-blur-md border-b border-stone-100 z-50">
    <div class="flex items-center gap-3">
      ${_LOGO}
      ${_BADGE}
    </div>
    <nav class="flex items-center gap-1 sm:gap-3" aria-label="Site navigation">
      <a href="/docs/getting-started" class="text-sm font-medium text-stone-500 hover:text-stone-900 no-underline transition-colors hidden sm:block px-3 py-1.5 rounded-lg hover:bg-stone-100">Documentation</a>
      <a href="/blog" class="text-sm font-medium text-stone-500 hover:text-stone-900 no-underline transition-colors hidden sm:block px-3 py-1.5 rounded-lg hover:bg-stone-100">Blog</a>
      <a href="https://github.com/zerotaldev/zerotal" target="_blank" rel="noopener"
         class="text-stone-400 hover:text-stone-900 transition-colors p-2 rounded-lg hover:bg-stone-100" title="GitHub">
        ${_GH_ICON}
      </a>
      <a href="/docs/getting-started"
         class="inline-flex items-center gap-1.5 px-4 py-2 bg-ink text-cream font-semibold text-sm rounded-lg hover:bg-ink-800 transition-colors shadow-sm shadow-ink/20 no-underline">
        Get Started
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5"><path fill-rule="evenodd" d="M2 8a.75.75 0 0 1 .75-.75h8.69L8.22 4.03a.75.75 0 0 1 1.06-1.06l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 0 1-1.06-1.06l3.22-3.22H2.75A.75.75 0 0 1 2 8Z" clip-rule="evenodd" /></svg>
      </a>
    </nav>
  </header>`;
  }

  return `<header class="fixed top-0 left-0 right-0 h-16 flex items-center justify-between px-4 sm:px-6 bg-white/85 backdrop-blur-md border-b border-stone-200 z-50">
    <div class="flex items-center gap-4">
      <button id="mobile-menu-btn" class="md:hidden text-stone-500 hover:text-stone-900" aria-label="Toggle navigation">
        <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
      </button>
      ${_LOGO}
      ${_BADGE}
    </div>
    <nav class="flex items-center gap-4 sm:gap-5" aria-label="External links">
      <a href="/docs/getting-started" class="text-sm font-medium text-stone-500 hover:text-stone-900 no-underline transition-colors hidden sm:block">Documentation</a>
      <a href="/blog" class="text-sm font-medium text-stone-500 hover:text-stone-900 no-underline transition-colors hidden sm:block">Blog</a>
      <div class="w-px h-4 bg-stone-200 hidden sm:block"></div>
      <a href="https://github.com/zerotaldev/zerotal" target="_blank" rel="noopener" class="text-stone-400 hover:text-stone-900 transition-colors" title="GitHub">
        ${_GH_ICON}
      </a>
    </nav>
  </header>`;
}

// ── Layout ────────────────────────────────────────────────────────────────────

export function Layout({
  content,
  title = "Zerotal Docs",
  description,
  pathname = "",
  sidebar = true,
  variant = "guide",
}: LayoutProps): string {
  const pageTitle = title === "Zerotal Docs" ? title : `${title} — Zerotal Docs`;
  // Built from the path alone, so the blog listing's `?category=`/`?sort=`/`?view=`
  // arrangements all point at the same canonical `/blog` rather than reading as
  // that many near-duplicate pages.
  const canonical = pathname ? `${SITE_URL}${pathname}` : "";
  const isApi = variant === "api";
  const sidebarHtml = !sidebar ? "" : isApi ? renderApiSidebar(pathname) : renderSidebar(pathname);
  // API pages carry wide signature blocks and param tables — give them room.
  const contentWidth = !sidebar
    ? "max-w-7xl mx-auto px-4 sm:px-12 py-12"
    : isApi
      ? "max-w-5xl mx-auto px-6 sm:px-10 py-12"
      : "max-w-4xl mx-auto px-6 sm:px-10 py-12";

  return `<!DOCTYPE html>
<html lang="en" style="scroll-behavior:smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(pageTitle)}</title>
  ${description ? `<meta name="description" content="${escHtml(description)}">` : ""}

  ${canonical ? `<link rel="canonical" href="${escHtml(canonical)}">` : ""}

  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="alternate" type="application/rss+xml" title="Zerotal Blog" href="/blog/feed.xml">
  <meta name="theme-color" content="#0B0D0C">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Zerotal">
  <meta property="og:title" content="${escHtml(pageTitle)}">
  ${description ? `<meta property="og:description" content="${escHtml(description)}">` : ""}
  ${canonical ? `<meta property="og:url" content="${escHtml(canonical)}">` : ""}
  <meta property="og:image" content="${escHtml(SITE_URL)}/og.png">
  <meta name="twitter:card" content="summary_large_image">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="/css/app.css">
  <script src="/js/app.js" type="module"></script>
</head>
<body class="bg-cream text-ink antialiased selection:bg-voltage-100 selection:text-ink">

  ${renderHeader(sidebar)}

  <!-- Shell -->
  <div class="flex min-h-screen pt-16">

    ${sidebarHtml}

    <!-- Main content -->
    <main class="${sidebar ? "md:ml-72 xl:mr-64" : ""} flex-1 min-w-0">
      <div class="${contentWidth}">
        <article
          class="prose prose-stone max-w-none
            prose-headings:scroll-mt-24 prose-headings:tracking-tight
            prose-h1:text-[1.75rem] prose-h1:font-semibold prose-h1:text-stone-900 prose-h1:mb-3
            prose-h2:text-xl prose-h2:font-semibold prose-h2:text-stone-900 prose-h2:border-b prose-h2:border-stone-200/70 prose-h2:pb-2 prose-h2:mt-12 prose-h2:mb-4
            prose-h3:text-base prose-h3:font-semibold prose-h3:text-stone-800 prose-h3:mt-8 prose-h3:mb-2
            prose-h4:text-[0.875rem] prose-h4:font-semibold prose-h4:text-stone-500 prose-h4:mt-6 prose-h4:mb-2
            prose-p:text-[0.9375rem] prose-p:leading-7 prose-li:text-[0.9375rem] prose-li:leading-7 prose-td:text-[0.875rem] prose-th:text-[0.8125rem]
            prose-a:text-voltage-700 prose-a:font-medium prose-a:no-underline hover:prose-a:underline
            prose-code:bg-transparent prose-code:border prose-code:border-stone-200 prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-normal
            prose-blockquote:border-l-teal-deep prose-blockquote:bg-teal-deep/5 prose-blockquote:rounded-r-lg prose-blockquote:not-italic prose-blockquote:font-normal prose-blockquote:text-stone-600 prose-blockquote:py-0.5
            prose-th:bg-transparent prose-th:font-semibold prose-th:uppercase prose-th:tracking-wide
            prose-img:rounded-lg prose-hr:border-stone-200"
        >
          ${content}
        </article>
        ${sidebar && !isApi ? renderPrevNext(pathname) : ""}
      </div>
    </main>

    ${
      sidebar
        ? `<!-- Right-hand ToC — revealed by JS once populated -->
    <div id="toc" class="hidden"
         data-toc-classes="fixed top-16 right-0 w-64 h-[calc(100vh-4rem)] overflow-y-auto py-10 px-5 z-30 hidden xl:block">
      <p class="pl-3.5 text-[0.65rem] font-semibold uppercase tracking-[0.09em] text-stone-400 mb-2">On this page</p>
      <nav id="toc-nav" class="ml-px ${RAIL}"></nav>
    </div>`
        : ""
    }

  </div><!-- /shell -->

</body>
</html>
`;
}

/** The API reference layout: same shell as {@link Layout}, but the API sidebar,
 * a wider content column, and no guide prev/next. */
export function ApiLayout(props: LayoutProps): string {
  return Layout({ ...props, variant: "api" });
}
