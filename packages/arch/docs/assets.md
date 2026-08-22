---
title: Assets
description: Compile and serve your CSS and JavaScript with Bun's native bundler and hot reload — no separate build tool to configure.
---

# Assets

Zerotal compiles and serves your frontend assets — CSS and JavaScript — with Bun's
native bundler, so there's no separate build tool to configure. Each stack (Flow,
View, Inertia) has its own pipeline and hot-reload behaviour; all three use
[Tailwind CSS v4](https://tailwindcss.com/docs/v4-beta).

Asset compilation is built into the framework — there's no package to install or
provider to register for the pipeline itself. You only add Tailwind and wire up a
static route, then `bun zt serve --dev` handles build-and-reload for you.

> **Note** — Projects ship a `zt.ts` entry and a `zt` package script,
> so commands are written `bun zt <command>` (e.g. `bun zt serve --dev`).

## Getting Started

Asset building is part of `@zerotal/core` — nothing to install and no provider
to register. `bun zt serve --dev` builds on change, and `bun zt css:build`
produces a production bundle:

```bash
# in your project root
bun zt serve --dev     # watch and rebuild
bun zt css:build       # one production build
```

Tailwind is the only optional piece; [add it](#tailwind-css) when you want it.

### Which build command should I use?

Pick by stack — the dev server runs the right pipeline automatically:

- **Flow or View** (server-rendered, one stylesheet): `bun zt css:build` for
  production. Dev rebuilds are wired up by `FlowProvider`.
- **Inertia** (React or Vue SPA, JS + CSS bundle): `bun zt inertia:build` for
  production. Dev rebuilds are wired up by `InertiaProvider`.
- **Any stack, development**: `bun zt serve --dev` — initial build, file watch,
  rebuild on save, and a browser reload over WebSocket.

## Tailwind CSS

Install Tailwind v4 and Bun's native Tailwind plugin:

```bash
# in your project root
bun add -d tailwindcss bun-plugin-tailwind
```

Create `resources/css/app.css`:

```css
/* resources/css/app.css */
@import "tailwindcss";

/* Extend Tailwind's theme with @theme */
@theme {
  --color-brand: oklch(0.6 0.2 260);
  --font-sans: "Inter", sans-serif;
}
```

That's it — no `tailwind.config.js`, no PostCSS config, no purge list. Tailwind
v4 detects your templates automatically via content scanning.

> **Tip** — Why `bun-plugin-tailwind` and not PostCSS?
> Bun has native CSS support built in. `bun-plugin-tailwind` is a first-party
> Bun plugin that processes Tailwind v4 without PostCSS as an intermediary —
> it's faster and requires no extra peer dependencies. PostCSS is not needed.

### How the build finds Tailwind

Zerotal looks for `bun-plugin-tailwind` in your project's `node_modules` at build
time. When it's installed, the plugin runs inside Bun's bundler and processes
every `@import "tailwindcss"` directive natively — no PostCSS, no extra peer
dependencies.

When it isn't, the build falls back to spawning `bunx @tailwindcss/cli` as a
subprocess, which needs only `tailwindcss`. Your stylesheet is built either way;
installing the plugin keeps the work in-process and faster.

## CSS builds for Flow and View

Flow and View apps ship a single compiled stylesheet — the entry lives in
`resources/`, the built output in `public/`:

```text
# project layout (Flow / View)
resources/
  css/
    app.css          ← Tailwind entry point
public/
  css/
    app.css          ← Built output (git-ignored)
```

### Linking the built CSS

Reference the built stylesheet with a plain `<link>` pointing at `/css/app.css`. In a
Flow layout it goes in the `static head`; in a View controller it's a tag in the
returned HTML:

```html
<!-- in a Flow layout head, or a View controller's HTML -->
<link rel="stylesheet" href="/css/app.css" />
```

### Dev mode

```bash
# in your project root
bun zt serve --dev
```

When `resources/css/app.css` exists, `FlowProvider.onBooted()` registers a
combined CSS/JS build hook. The `DevOrchestrator` then:

1. Runs an initial CSS build before starting the server
2. Watches `resources/css/` for changes
3. Rebuilds CSS on every save (using `bun-plugin-tailwind` if installed,
   falling back to `bunx @tailwindcss/cli`)
4. Signals the browser to reload over WebSocket (`/__dev/ws`)

The browser receives the reload signal and does a full page refresh — the
updated CSS is served from `public/css/app.css`.

> **Note** — The same `onBooted` hook also bundles `resources/js/app.js` →
> `public/js/app.js` when that entry exists, so Flow apps with a small client
> bundle get the same watch-and-rebuild treatment as their CSS.

### Production build

```bash
# in your project root
bun zt css:build
```

Override the defaults with flags:

```bash
# in your project root
bun zt css:build --input resources/css/app.css --output public/css --minify
```

| Flag       | Short | Default                 | Description                  |
| ---------- | ----- | ----------------------- | ---------------------------- |
| `--input`  | `-i`  | `resources/css/app.css` | Path to the CSS entry point. |
| `--output` | `-o`  | `public/css`            | Output directory.            |
| `--minify` | `-m`  | `true`                  | Minify the output.           |

All flags default to sensible values; the short form with no flags is
sufficient for most apps.

### Static file serving

Add `Router.static` to serve `public/` at the root:

```typescript fragment
// routes/index.ts
Router.static("/", "public");
```

Or target `public/css/` specifically:

```typescript fragment
// routes/index.ts
Router.static("/css", "public/css");
```

Every file present when the server starts is registered as its own route and
served without entering JavaScript, which is why a static asset costs
essentially nothing per request. The trade-off is that the list is fixed at
startup, so a file written afterwards has no route. That is fine for a deployed
app, where the build finishes before the server boots. Where it isn't — a
directory whose contents change while the server runs — pass `eager: false` to
fall back to a per-request disk lookup. Dev mode applies that fallback to every
static directory automatically, which is how a freshly-built chunk is served the
moment it lands.

### The asset helper

Hard-coding `/css/app.css` into a template works right up until you move the
build output or serve it from a CDN prefix. `asset()` builds the URL for you
from the configured `app.assets.prefix`, so the template stops caring where the
file actually lives:

```typescript
import { asset } from "zerotal/assets";

asset("app.css"); // → "/css/app.css"
```

Reach for it in layouts and templates you write by hand — the Flow scaffold
uses it for exactly this. You do not need it for Inertia's `resources/app.html`,
which already gets its URLs rewritten for you.

In dev it also appends `?v=<build token>`, so a rebuilt file is refetched rather
than served from cache. In production it returns the clean path unchanged — a
deployed build is immutable, so cache invalidation belongs to your deploy (a
CDN purge, or the Inertia asset version described below) rather than to a query
string that would change on every boot.

## JavaScript builds for Inertia

The React and Vue stacks share one build pipeline — same bundler, dev reload, and
output. The only differences are the page file extension (`.tsx` vs `.vue`) and the
JS entry point.

### Inertia directory layout

```text
# project layout (Inertia)
resources/
  app.html           ← HTML shell template
  css/
    app.css          ← Tailwind entry (imported in app.tsx)
  js/
    app.tsx          ← JS entry point
    env.d.ts         ← ambient module decls (*.css, *.vue, images)
    pages.generated.ts ← auto-generated page registry (do not edit)
    Layouts/
      AppLayout.tsx  ← (.vue for Vue)
    pages/           ← page components live here by default
      home.tsx       ← (.vue for Vue)
      Posts/
        Index.tsx
        Show.tsx
public/
  assets/
    app.js           ← Built bundle (git-ignored)
    app.css          ← Extracted CSS (git-ignored)
    chunk-*.js       ← Per-page chunks (code splitting, git-ignored)
```

### JS entry point

`resources/js/app.tsx` is the bundler's entry point. It imports your CSS (so Tailwind
runs as part of the JS build) and boots the Inertia client, resolving each page from
the generated registry:

```typescript fragment
// resources/js/app.tsx (React)
import { createInertiaApp, type ResolvedComponent } from "@inertiajs/react";
import { createRoot } from "react-dom/client";
import { pages } from "./pages.generated.ts";
import "../css/app.css"; // ← imports CSS into the JS bundle

createInertiaApp({
  resolve: async (name): Promise<ResolvedComponent> => {
    const page = pages[name];
    if (!page) throw new Error(`Inertia page not found: "${name}"`);
    return (await page()).default as ResolvedComponent;
  },
  setup({ el, App, props }) {
    createRoot(el).render(<App {...props} />);
  },
});
```

```typescript fragment
// resources/js/app.tsx (Vue)
import { createInertiaApp } from "@inertiajs/vue3";
import { createApp, h, type DefineComponent } from "vue";
import { pages } from "./pages.generated.ts";
import "../css/app.css";

createInertiaApp({
  resolve: async (name): Promise<DefineComponent> => {
    const page = pages[name];
    if (!page) throw new Error(`Inertia page not found: "${name}"`);
    return (await page()).default as DefineComponent;
  },
  setup({ el, App, props, plugin }) {
    createApp({ render: () => h(App, props) })
      .use(plugin)
      .mount(el as Element);
  },
});
```

Tailwind is processed because `app.tsx` imports `app.css`, and `Bun.build()`
passes all CSS through `bun-plugin-tailwind` before emitting
`public/assets/app.css`. For Vue, the build also runs `@vue/compiler-sfc` via the
Inertia Vue plugin so `.vue` single-file components compile.

> **Warning** — `tsconfig.json` must set the right JSX runtime. React pages need
> `"jsxImportSource": "react"` and Vue pages need `"jsxImportSource": "vue"`.
> Using a server-JSX runtime instead (`"zerotal"` for views, `"@zerotal/flow"` for Flow) produces a runtime
> "Invalid hook call" / null-dispatcher error.

### Inertia dev mode

```bash
# in your project root
bun zt serve --dev
```

`InertiaProvider.onBooted()` registers Inertia's build routine under its own
name. Each view layer registers its own, and every one of them runs on a change
— an Inertia app that also installs `@zerotal/monitor` gets Flow alongside
it, and both bundles keep rebuilding. The orchestrator:

1. Runs `generatePageRegistry()` + `Bun.build()` on startup
2. Watches `resources/js/` (which includes `resources/js/pages/`) and
   `resources/css/`
3. Regenerates the page registry and rebuilds the bundle on changes
4. Signals the browser over WebSocket at `/__dev/ws`

Code splitting is enabled (`splitting: true`), so each page becomes its own
lazy-loaded chunk. Only the entry bundle (with the shared framework runtime) is
loaded on first navigation; each subsequent page chunk is fetched on demand.

A rebuild that changes the shape of the module graph — adding a page, adding an
import — emits chunk filenames the previous build never had. Those are served
as soon as they are written: in dev the server falls back to a disk lookup for
any path its startup scan didn't already know about, so a fresh chunk never
404s while waiting for a restart.

#### Asset cache-busting in dev

To stop the browser serving a stale bundle after a rebuild, dev mode busts the
cache two ways (no-op in production):

- **Versioned URLs.** The served HTML rewrites local `/assets/*.js` and `*.css`
  URLs to `?v=<file mtime>`. After a rebuild the mtime changes → the URL changes
  → the browser fetches fresh; when nothing changed the URL is stable, so the
  browser keeps using its cached copy. This works even on frontend-only rebuilds,
  where the server is never restarted.
- **A per-build token on `asset()`.** URLs built by the
  [`asset()` helper](#the-asset-helper) instead carry `?v=<build token>` — one
  token for the whole build, reissued on every rebuild and handed to the server
  over the same channel that triggers the browser reload. Templates that call
  `asset()` therefore bust every URL at once, rather than file by file.
- **`Cache-Control: no-cache`** is set on static assets served from `public/`, so
  the browser always revalidates.

In production, asset URLs are served as-is. Use `ASSET_VERSION` (surfaced as
`inertia.version`) to set the Inertia asset version — on a mismatch the client
triggers a full reload (HTTP 409), which is how you invalidate clients after a
deploy.

### Inertia production build

```bash
# in your project root
bun zt inertia:build
bun zt inertia:build --production   # minified, no source maps
```

The build:

1. Regenerates `pages.generated.ts`
2. Runs `Bun.build()` with `splitting: true` (plus minify / no source maps for
   `--production`)
3. Outputs all assets to `public/assets/`
4. Deletes what the previous build left behind

Run it before `bun zt serve` in production (it is wired to the `build` script in
the scaffolded `package.json`).

#### Why the output directory needs sweeping

Code-splitting names each shared chunk after its content — `chunk-3f9a2c.js` —
so a rebuild that changes one page emits a new set of chunk names and abandons
the old ones. Nothing overwrites them. Left alone, a long dev session buries the
output directory in hundreds of dead chunks, all of them registered as static
routes at startup and all of them shipped in the next deploy.

Every build that splits therefore sweeps up after itself, in dev and in
production alike. It removes two things and nothing else: files the previous
build recorded as its own output, and files named the way the bundler names
chunks. Anything else in the directory is left untouched, which matters because
an output directory is often `public/`, where your images and favicon live
alongside the bundle. The record of what each build wrote is kept in
`.zerotal/build/`, outside the served directory.

A directory that has been collecting chunks since before this existed is cleaned
by the next build, since chunks are recognised by name and not only by the
record.

## Controlling how files are loaded

`url()` references in your CSS are resolved at build time, and Bun inlines small
files as `data:` URIs. That is the right default for an icon and the wrong one for a
font: the bytes move **into the stylesheet**, which blocks first paint. Nine woff2
subsets can turn a 36 KB stylesheet into 260 KB that must download before anything
renders — the opposite of what `font-display: swap` is for, and expensive on exactly
the connections that need it most.

Set a per-extension loader to emit them as separate files instead:

```typescript fragment
// config/app.ts
export default AppConfig({
  assets: {
    entrypoint: "resources/css/app.css",
    loader: { ".woff2": "file", ".woff": "file" },
  },
});
```

`file` copies the asset to `outDir` and rewrites the `url()` to point at it, so the
stylesheet stays small and the fonts load in parallel. The other accepted values are
`dataurl` (force inlining), `base64`, `text`, `json`, and `toml`.

## Hot reload

Both pipelines above are driven by the same dev process. `bun zt serve --dev`
builds once, spawns the server as a child process, and watches the filesystem;
what happens on a change depends on which directory the change landed in:

```text
# bun zt serve --dev process model
┌──────────────────────────────────────────────────────┐
│  bun zt serve --dev                                 │
│                                                      │
│  Process 1: DevOrchestrator                          │
│  ├─ Initial build (CSS or JS+CSS)                    │
│  ├─ Spawn Process 2 (server)                         │
│  └─ Watch filesystem                                 │
│       │                                              │
│       ├─ Backend change (app/, routes/, bootstrap/)  │
│       │    └─ Rebuild, then kill + respawn (150 ms)  │
│       │                                              │
│       └─ Frontend change (resources/css/, js/)       │
│            └─ Rebuild assets (80 ms debounce)        │
│                 └─ Write "reload:<token>" to         │
│                      Process 2 stdin                 │
│                                                      │
│  Process 2: Zerotal server (--dev-worker)             │
│  ├─ Serves app routes                                │
│  ├─ Sends "version:<token>" on every WS connect      │
│  ├─ Broadcasts "reload" to WS clients                │
│  └─ WebSocket at /__dev/ws                           │
│                              │                       │
│                              ▼                       │
│                    Browser (JS client)               │
│                    connects on load                  │
│                    reloads on "reload" message       │
│                    reloads when the token changed    │
│                    reconnects on close (1 s delay)   │
└──────────────────────────────────────────────────────┘
```

### What triggers a restart, and what only rebuilds

| Changed path                               | Action                                 |
| ------------------------------------------ | -------------------------------------- |
| `app/`, `routes/`, `bootstrap/`, `config/` | Server restart (150 ms)                |
| `resources/css/`, `resources/js/`          | Asset rebuild + browser reload (80 ms) |
| `public/`                                  | Ignored (output dir)                   |
| `node_modules/`, `.git/`                   | Ignored                                |

Inertia pages live under `resources/js/pages/`, so they're covered by the
`resources/js/` watch and rebuild rather than restart.

### Browser client

Under `--dev-worker`, `DevReloadMiddleware` injects this script into every
`text/html` response, so live reload works for any view layer — Flow, View,
plain HTML — with no wiring on your part:

```html
<!-- injected before </body> in --dev-worker mode -->
<script>
  (function () {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    var build = null;
    function connect() {
      var ws = new WebSocket(proto + "//" + location.host + "/__dev/ws");
      ws.onmessage = function (e) {
        var d = e.data;
        if (d === "reload") {
          location.reload();
          return;
        }
        if (d.indexOf("version:") === 0) {
          var v = d.slice(8);
          if (!v) return;
          if (build === null) build = v;
          else if (build !== v) location.reload();
        }
      };
      ws.onclose = function () {
        setTimeout(connect, 1000);
      };
    }
    connect();
  })();
</script>
```

The two signals cover two different situations. A frontend change pushes
`reload` down a socket that is already open. A backend change cannot: it
restarts the server, and the restart closes every socket, so a reload pushed at
that moment reaches nobody — the tab does not reconnect for another second. The
build token closes that gap. The server states its token whenever a socket
opens; the tab remembers the first one it sees and reloads when a reconnect
reports a different one. That is how a rebuild triggered by a backend edit still
reaches the browser.

Inertia is the one exception to where the script comes from: it bakes the same
client into its cached HTML template at boot rather than receiving it from the
middleware, because injecting into the response body means buffering it, and
`Inertia.stream()` exists precisely to avoid that. The middleware skips any page
that already carries a `/__dev/ws` client, so the two never collide.

## Styling

Zerotal is unopinionated about CSS — the Tailwind pipeline above is the default, but
nothing forces it. For state-driven classes inside Flow components, see
[reactive classes and attributes](/docs/flow#reactive-classes-and-attributes); the
patterns below are the styling techniques you'll reach for most, whichever stack you
picked.

### CSS Modules

Bun's bundler understands CSS Modules out of the box. Import a `.module.css` file and
use the generated class names — styles are scoped to the component, so names never
collide across files:

```tsx fragment
// app/components/Button.tsx
import styles from "./Button.module.css";

export function Button({ label }: { label: string }) {
  return <button class={styles.button}>{label}</button>;
}
```

```css
/* app/components/Button.module.css */
.button {
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  background: var(--color-brand);
  font-weight: 600;
}
```

### Component libraries

For ready-made, themeable UI, reach for **flow-ui** — Zerotal's first-party,
shadcn-style component set built on the same Tailwind tokens, so it follows your
theme automatically:

```bash
# in your project root
bun zt flow:add button card dialog
```

Browse the full catalogue in [Components](/docs/components). Any npm component library
also works with the Bun bundler — common choices:

| Library     | Install                                  |
| ----------- | ---------------------------------------- |
| shadcn/ui   | `bunx shadcn@latest init`                |
| Radix UI    | `bun add @radix-ui/react-dialog`         |
| Headless UI | `bun add @headlessui/react`              |
| DaisyUI     | `bun add -d daisyui` (a Tailwind plugin) |

### Web fonts

Load fonts from a CDN for a quick start, or self-host them in `public/` for one fewer
network round-trip (and to keep requests on your own domain). Pair a self-hosted face
with `--font-sans` in your `@theme` block so Tailwind's `font-sans` utility picks it up:

```html
<!-- in your HTML head — Google Fonts quick start -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link
  href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
```

```css
/* resources/css/app.css — self-hosted alternative */
@font-face {
  font-family: "Inter";
  src: url("/assets/fonts/Inter.woff2") format("woff2");
  font-weight: 100 900;
  font-display: swap;
}
```

## Testing

Set your suite up once as described in [Testing](/docs/testing). Assets are built
artifacts, so the useful tests are about what a request receives — not about the
bundler.

That boundary is worth holding. Tailwind emitting the right rules and Bun bundling
the right modules are already covered by those tools' own suites, and a test that
asserts on the _content_ of built CSS breaks every time a class is added. What is
genuinely yours to verify is the wiring: that the page points at the asset, that
the asset is served, and that a deploy invalidates the old one.

**Assert the page references the asset**, which catches a build config that
silently stopped emitting it:

```typescript fragment
// tests/http/assets.test.ts
import { test } from "bun:test";
import { createApp } from "../helpers.ts";

test("the layout links the built stylesheet", async () => {
  const app = await createApp();

  const res = await app.get("/");

  res.assertSee("/assets/app.css");
  await app.close();
});
```

**Assert it is actually served**, because a reference to a missing file is a
`404` the page will not tell you about:

```typescript fragment
// tests/http/assets.test.ts
const css = await app.get("/assets/app.css");

css.assertOk();
css.assertHeader("Content-Type", "text/css");
```

These two belong together. Each passes on its own while the pair is broken — a
page can link a path nothing serves, and a served file can go unreferenced — so
testing only one leaves the failure that actually reaches users uncovered.

**Cache-busting is worth one test** if you rely on it for deploys. In dev the URL
carries a `?v=` token that changes on rebuild; in production `ASSET_VERSION`
drives the Inertia version header:

```typescript fragment
// tests/http/assets.test.ts
test("asset URLs carry a version in dev", async () => {
  const res = await app.get("/");

  expect(res.text()).toMatch(/\/assets\/app\.css\?v=/);
});
```

> **Warning** — These tests need a build to have run. A suite in CI that never
> runs `bun zt css:build` will fail them for a reason unrelated to the code —
> either build in the pipeline before testing, or scope these to a suite you run
> after building.

The cleanest arrangement is to build once as a CI step before the test job, the way
you would before starting the server. Failing that, keep asset tests in their own
file and run it as a separate command after the build, so a missing artifact fails
one obvious job rather than scattering unrelated failures through the whole suite.

### Unit-testing the asset helper

`asset()` is a pure function of the configured prefix, so its behaviour can be
pinned down without a request at all. This is the cheapest place to catch a
misconfigured CDN prefix:

```typescript fragment
// tests/unit/asset.test.ts
import { asset } from "zerotal/assets";

test("asset() resolves against the configured prefix", () => {
  expect(asset("app.css")).toBe("/css/app.css");
});
```

### Inertia stale-bundle reloads

Inertia apps carry an asset version on every page object, and a request whose
`X-Inertia-Version` no longer matches the server's is answered with a `409` and an
`X-Inertia-Location` header, which is what makes a browser holding yesterday's
bundle do a full reload after a deploy. That flow only fires when the version
actually changes between builds, so it is worth one test:

```typescript fragment
// tests/http/assets.test.ts
test("a stale bundle is told to reload", async () => {
  const res = await app.get("/dashboard", {
    "X-Inertia": "true",
    "X-Inertia-Version": "stale-version",
  });

  res.assertStatus(409);
  res.assertHeader("X-Inertia-Location");
});
```

## References

### Commands

| Command                             | Effect                                          |
| ----------------------------------- | ----------------------------------------------- |
| `bun zt serve`                      | Serve the app; assets are built once at boot    |
| `bun zt serve --dev`                | Dev server with hot reload                      |
| `bun zt css:build`                  | Production CSS build (Flow/View)                |
| `bun zt inertia:build`              | Development JS+CSS build (Inertia)              |
| `bun zt inertia:build --production` | Production JS+CSS build (Inertia)               |
| `bun zt route:list`                 | List all routes (including static asset routes) |

Which build command belongs to your app follows from the view layer, not from
preference: `css:build` covers Flow and View, which ship server-rendered HTML
and need only a stylesheet; `inertia:build` covers Inertia, which additionally
bundles page components into JavaScript. Running the wrong one leaves the app
without the output it looks for at boot.

### Files

| File                              | Purpose                           |
| --------------------------------- | --------------------------------- |
| `resources/css/app.css`           | Tailwind entry (all stacks)       |
| `resources/app.html`              | HTML shell (Inertia only)         |
| `resources/js/app.tsx`            | JS entry (Inertia only)           |
| `resources/js/pages/`             | Inertia page components (default) |
| `resources/js/pages.generated.ts` | Auto-generated page registry      |
| `public/css/app.css`              | Built CSS output (Flow/View)      |
| `public/assets/app.js`            | Built JS output (Inertia)         |
| `public/assets/app.css`           | Built CSS output (Inertia)        |

Everything under `resources/` is source you edit; everything under `public/` is
build output. `public/` is regenerated, so nothing hand-written should live there
and the whole directory is safe to delete and rebuild.

### Configuration

| Key                 | Controls                                               |
| ------------------- | ------------------------------------------------------ |
| `app.assets.prefix` | URL prefix `asset()` resolves against — point at a CDN |
| `ASSET_VERSION`     | Inertia asset version; a mismatch forces a full reload |

```typescript
import { asset } from "zerotal/assets";

asset("app.css"); // → "/css/app.css"
```

See [the asset helper](#the-asset-helper) for what it does in dev versus
production, and [what triggers a restart](#what-triggers-a-restart-and-what-only-rebuilds)
for the watcher's rules.

## Next steps

- [Flow](/docs/flow) — the zero-config server-rendered SPA stack.
- [Inertia](/docs/inertia) — controllers, pages, shared props, and SSR.
- [Middleware & versioning](/docs/inertia/middleware) — the asset-version flow in full.
- [Components](/docs/components) — themeable flow-ui components for your UI.
- [View](/docs/view) — classic SSR with JSX controllers.
- [Deployment](/docs/deployment) — run the production asset build before serving.
