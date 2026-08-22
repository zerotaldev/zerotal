---
title: Components
description: Themeable UI components for Flow that you install via the CLI or import from the package.
---

# Components

`@zerotal/flow-ui` ships 53 themeable components for [Flow](/docs/flow). They are
built on accessible headless primitives and design tokens, so they follow your theme
(light / dark) out of the box. Add them with the CLI (copy the source into your app) or
import them straight from the package.

The catalogue covers what an application actually needs rather than only the obvious
primitives:

| Group             | Components                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forms             | `Field`, `Input`, `InputGroup`, `InputOTP`, `Textarea`, `Select`, `Combobox`, `Checkbox`, `RadioGroup`, `Switch`, `Slider`, `Toggle`, `ToggleGroup`, `Label`, `Calendar`, `DatePicker` |
| Buttons & actions | `Button`, `ButtonGroup`, `DropdownMenu`, `ContextMenu`, `Menubar`                                                                                                                      |
| Overlays          | `Dialog`, `AlertDialog`, `Sheet`, `Popover`, `HoverCard`, `Tooltip`, `Command`                                                                                                         |
| Navigation        | `Sidebar`, `NavigationMenu`, `Breadcrumb`, `Pagination`, `Tabs`                                                                                                                        |
| Data              | `Table`, `Chart`, `Item`, `Avatar`, `Badge`                                                                                                                                            |
| Feedback          | `Toaster`, `Alert`, `Progress`, `Spinner`, `Skeleton`, `Empty`                                                                                                                         |
| Layout & content  | `Card`, `Accordion`, `Collapsible`, `ScrollArea`, `Resizable`, `Carousel`, `AspectRatio`, `Separator`, `Prose`, `Kbd`                                                                  |

## Where the work happens

The components follow one rule, and it is worth stating before the API: **the
server renders, the client reacts.**

Anything that answers to a pointer or a keystroke — dragging a slider, paging a
calendar, filtering a palette, pressing a toggle, hovering a chart — runs entirely
in the browser through Alpine. Those interactions have to land inside a frame, and
a network round-trip cannot make that promise. Putting them on the server produces
the specific ugliness of a control that lags its own input: a slider whose readout
does not move while you drag it, a segmented button that stays unpressed until the
reply arrives.

The server's job is the first paint and the data. It renders the initial state so
the page is correct and complete before any script runs, and it hears about a
change once — when there is something to persist. A date picker syncs the day you
chose, not the six months you browsed to find it.

In practice that means most components bind rather than call:

```tsx fragment
<Slider bind={this.volume} showValue />        {/* live while dragging, synced on release */}
<ToggleGroup bind={this.view} options={…} />   {/* presses instantly, syncs after */}
<DatePicker bind={this.due} />                 {/* months page client-side, day syncs once */}
```

Where a component genuinely needs the server — a calendar laying out records, a
table of rows — it says so, and paging is a real navigation because the next page
means different data.

## Getting Started

```bash
# in your project root
bun add @zerotal/flow-ui
```

## Register the provider

`FlowUiProvider` is a scaffolding-only provider: it registers the `flow:*` CLI commands. The components themselves are plain functions with no runtime service, so you only need the provider to use the CLI. Add it to the providers array in `bootstrap/providers.ts`:

```ts
// bootstrap/providers.ts
import { FlowUiProvider } from "@zerotal/flow-ui";

const providers = [
  // …your other providers
  FlowUiProvider,
];

export default providers;
```

Registering the provider switches on the following:

- `onBooted` — registers the `flow:list`, `flow:add`, and `flow:init` console commands (only when the `commands` binding is present, so web/test boots stay unaffected).

## Set up the theme

Run `flow:init` once per app. It drops the shared `cn` / `gva` utilities into `app/flow/components/ui/lib/` and wires the design-token theme into your Tailwind entry CSS:

```bash
# in your project root
bun zt flow:init
```

> **Note** — `flow:init` is idempotent: it skips files that already exist and only adds the `@import "@zerotal/flow-ui/theme.css";` line if it is missing. Pass `--css <path>` to target a Tailwind entry other than `resources/css/app.css`.

### Without a build step

Components are written against design tokens — `bg-card`, `text-muted-foreground`, `border-input`, `bg-primary` — so _defining_ those tokens themes the whole kit at once. `theme.css` does that for a real Tailwind build. When you have no build step, `flowUiHead()` does the same job as a `<head>` payload: it loads the Tailwind Play CDN, configures it with the identical token mapping, and emits the palette inline.

```ts
import { Layout, flowUiHead } from "@zerotal/flow-ui";

export class AppLayout extends Layout {
  static override get head() {
    return flowUiHead("Acme");
  }
}
```

Re-brand by passing `tokensCss`; it is appended after the defaults, so overriding one variable recolours everything that reads it:

```ts fragment
flowUiHead("Acme", {
  tokensCss: `
    :root { --primary: 21 90% 48%; --ring: 21 90% 48%; }
    .dark { --primary: 25 95% 58%; --ring: 25 95% 58%; }
  `,
});
```

This is the path both panels Zerotal ships take. The [admin](/docs/admin) uses it through `adminHead()`, and the [monitor](/docs/monitor) uses it directly with an orange `--primary` — which is the whole reason the two look like the same product rather than two.

### The token set

Alongside the base tokens (`background`, `card`, `primary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`) the theme adds:

| Token                                       | For                                                                |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `success` / `warning`                       | The states `destructive` doesn't cover — "healthy" and "degraded". |
| `flow-toast-success` / `flow-toast-warning` | Status accents the toast host reads at runtime.                    |
| `chart-1` … `chart-7`                       | A categorical series palette for charts.                           |

The chart tokens are deliberately _not_ semantic: "the second line" isn't good or bad, it just has to stay distinguishable from the first. Because SVG `stroke` and `fill` can't take Tailwind classes, reference them as `hsl(var(--chart-2))`.

## Adding components

`flow:add` copies component source into `app/flow/components/ui/`, so you own the code
outright. The shared `cn` / `gva` utils land in `ui/lib/`, and util imports are rewritten
to the local `./lib/*` paths on the way in.

A component built from others brings them along. Asking for `date-picker` also copies
`popover` and `calendar`, because a file importing a `Calendar` that was never copied is
not a working component.

```bash
# in your project root
bun zt flow:add button                 # one component
bun zt flow:add button,card,dialog     # several, comma-separated
bun zt flow:add --all                  # everything
bun zt flow:add button --force         # overwrite if it exists
```

Browse everything available with `flow:list`:

```bash
# in your project root
bun zt flow:list
```

> **Tip** — The copied `cn` util needs `clsx` and `tailwind-merge` in your app. `flow:add` and `flow:init` warn you with the exact `bun add` command if they are missing.

## Copy-in vs import — which should I use?

Both give you the same components; they differ in ownership:

- **Copy in with `flow:add`** when you want to _own and tweak_ the source — change variants, restyle, or extend a component. The code lives in your repo and won't change under you.
- **Import from `@zerotal/flow-ui`** when you just want the component as-is and prefer to track upstream updates. Every component is exported from the package root:

```tsx
// in a Flow component
import { Button, Card, Dialog } from "@zerotal/flow-ui";
```

The component API is identical either way — the sections below apply to both.

Props not listed for a component pass straight through to the underlying element —
`onClick`, `type`, `disabled`, and any `flow:*` directive behave exactly as they would
on the raw tag, so a component never gets in the way of Flow's own bindings.

<!-- BEGIN GENERATED COMPONENTS — edit the spec in packages/flow-ui/src/docs/, not this block. -->

### All 53 components

- [Button](#components-button) — Clickable button with variants + sizes
- [Badge](#components-badge) — Small status pill with variants
- [Card](#components-card) — Surface container (+ header/title/content/footer)
- [Input](#components-input) — Themed text input (two-way bindable)
- [Textarea](#components-textarea) — Themed multi-line input
- [Label](#components-label) — Form label (wraps the headless Label)
- [Separator](#components-separator) — Horizontal/vertical divider
- [Skeleton](#components-skeleton) — Pulsing loading placeholder
- [Avatar](#components-avatar) — Circular avatar with image + fallback
- [Switch](#components-switch) — On/off toggle bound to a boolean
- [Checkbox](#components-checkbox) — Checkbox bound to a boolean
- [Select](#components-select) — Native select bound to a value
- [RadioGroup](#components-radio-group) — Segmented radio set bound to a value
- [Dialog](#components-dialog) — Modal dialog (focus-trapped)
- [Sheet](#components-sheet) — Edge-anchored slide-over panel
- [DropdownMenu](#components-dropdown-menu) — Keyboard-navigable menu (+ item/label/separator)
- [Tabs](#components-tabs) — Tabbed panels with a pill tablist
- [Alert](#components-alert) — Inline alert (+ title/description)
- [Tooltip](#components-tooltip) — Hover/focus tooltip
- [Table](#components-table) — URL-sortable data table
- [Popover](#components-popover) — Floating panel anchored to a trigger
- [HoverCard](#components-hover-card) — Preview panel shown on hover
- [AlertDialog](#components-alert-dialog) — Confirm before something irreversible
- [Command](#components-command) — Searchable command menu (⌘K palette)
- [ContextMenu](#components-context-menu) — Right-click menu
- [Menubar](#components-menubar) — Application menu bar
- [NavigationMenu](#components-navigation-menu) — Site nav with dropdown panels
- [Sidebar](#components-sidebar) — App shell nav rail with a mobile drawer
- [Breadcrumb](#components-breadcrumb) — Trail showing where a page sits
- [Pagination](#components-pagination) — Page links with a windowed number range
- [Field](#components-field) — Label + control + description + error
- [InputGroup](#components-input-group) — Input with affixes or addons
- [InputOTP](#components-input-otp) — One-time-code input
- [Combobox](#components-combobox) — Autocomplete over many options
- [Slider](#components-slider) — Value chosen from a range
- [Toggle](#components-toggle) — Pressed-state button (+ toggle group)
- [ButtonGroup](#components-button-group) — Buttons joined into one control
- [Calendar](#components-calendar) — Month grid for picking or laying out dates
- [DatePicker](#components-date-picker) — Calendar in a popover
- [Toaster](#components-toast) — Host for transient flash messages
- [Progress](#components-progress) — Determinate progress bar
- [Spinner](#components-spinner) — Indeterminate loading indicator
- [Empty](#components-empty) — Empty-state block with an action
- [Kbd](#components-kbd) — Keyboard key (+ platform modifier)
- [Accordion](#components-accordion) — Stacked collapsible sections
- [Collapsible](#components-collapsible) — One section that opens and closes
- [ScrollArea](#components-scroll-area) — Scrollable region with a styled bar
- [Resizable](#components-resizable) — Two panes with a draggable handle
- [Carousel](#components-carousel) — Snap-scrolling strip with controls
- [AspectRatio](#components-aspect-ratio) — Fixed width-to-height box
- [Item](#components-item) — Icon + title + description + action row
- [Chart](#components-chart) — SVG line, area, bar and donut charts
- [Prose](#components-typography) — Prose wrapper + heading helpers

<a id="components-button"></a>

## Button

Clickable button with variants + sizes.

### Button installation

```sh
bun zt flow:add button
```

Or import directly from the package: `import { Button } from "@zerotal/flow-ui";`

### Button preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="flex flex-wrap items-center gap-3"><button type="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2">Default</button><button type="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 bg-secondary text-secondary-foreground hover:bg-secondary/80 h-9 px-4 py-2">Secondary</button><button type="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 bg-destructive text-destructive-foreground hover:bg-destructive/90 h-9 px-4 py-2">Destructive</button><button type="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2">Outline</button><button type="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2">Ghost</button><button type="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 text-primary underline-offset-4 hover:underline h-9 px-4 py-2">Link</button></div>
</div>

### Button usage

```tsx fragment
<Button onClick={this.save}>Save</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>
```

### Button props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>variant</code></td><td><code>"default" | "secondary" | "destructive" | "outline" | "ghost" | "link"</code></td><td><code>"default"</code></td><td>Visual style.</td></tr>
  <tr><td><code>size</code></td><td><code>"default" | "sm" | "lg" | "icon"</code></td><td><code>"default"</code></td><td>Sizing.</td></tr>
  <tr><td><code>onClick</code></td><td><code>handler</code></td><td>—</td><td>Server action or client expression (standard Flow).</td></tr>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Extra classes, merged last (wins over defaults).</td></tr>
  </tbody>
</table>

<a id="components-badge"></a>

## Badge

Small status pill with variants.

### Badge installation

```sh
bun zt flow:add badge
```

Or import directly from the package: `import { Badge } from "@zerotal/flow-ui";`

### Badge preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="flex flex-wrap items-center gap-3"><span class="inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-primary text-primary-foreground hover:bg-primary/80">Default</span><span class="inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80">Secondary</span><span class="inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80">Destructive</span><span class="inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-foreground">Outline</span></div>
</div>

### Badge usage

```tsx fragment
<Badge>New</Badge>
<Badge variant="secondary">Beta</Badge>
<Badge variant="destructive">Overdue</Badge>
<Badge variant="outline">Draft</Badge>
```

### Badge props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>variant</code></td><td><code>"default" | "secondary" | "destructive" | "outline"</code></td><td><code>"default"</code></td><td>Visual style.</td></tr>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Extra classes.</td></tr>
  </tbody>
</table>

<a id="components-card"></a>

## Card

Surface container (+ header/title/content/footer).

### Card installation

```sh
bun zt flow:add card
```

Or import directly from the package: `import { Card } from "@zerotal/flow-ui";`

### Card preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="rounded-xl border bg-card text-card-foreground shadow w-80"><div class="flex flex-col space-y-1.5 p-6"><h3 class="font-semibold leading-none tracking-tight">Create project</h3><p class="text-sm text-muted-foreground">Deploy your new project in one click.</p></div><div class="p-6 pt-0"><p class="text-sm text-muted-foreground">Project settings go here.</p></div><div class="flex items-center p-6 pt-0"><button type="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2">Deploy</button></div></div>
</div>

### Card usage

```tsx fragment
<Card>
  <CardHeader>
    <CardTitle>Create project</CardTitle>
    <CardDescription>Deploy your new project in one click.</CardDescription>
  </CardHeader>
  <CardContent>…</CardContent>
  <CardFooter>
    <Button>Deploy</Button>
  </CardFooter>
</Card>
```

### Card props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Extra classes on the surface.</td></tr>
  <tr><td><code>children</code></td><td><code>node</code></td><td>—</td><td>Compose with CardHeader / CardTitle / CardDescription / CardContent / CardFooter.</td></tr>
  </tbody>
</table>

<a id="components-input"></a>

## Input

Themed text input (two-way bindable).

### Input installation

```sh
bun zt flow:add input
```

Or import directly from the package: `import { Input } from "@zerotal/flow-ui";`

### Input preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="flex w-72 flex-col gap-1.5"><label class="flow-label text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Email</label><input type="text" data-slot="input" class="flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40" placeholder="you@example.com"></div>
</div>

### Input usage

```tsx fragment
<Field label="Email">
  <Input value={this.form.email} placeholder="you@example.com" />
</Field>
```

### Input props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>value</code></td><td><code>bound state</code></td><td>—</td><td>Two-way bind to an @expose / form field (emits flow:model).</td></tr>
  <tr><td><code>type</code></td><td><code>string</code></td><td><code>"text"</code></td><td>Native input type.</td></tr>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Extra classes.</td></tr>
  </tbody>
</table>

<a id="components-textarea"></a>

## Textarea

Themed multi-line input.

### Textarea installation

```sh
bun zt flow:add textarea
```

Or import directly from the package: `import { Textarea } from "@zerotal/flow-ui";`

### Textarea preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="w-72"><textarea class="flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" placeholder="Tell us about yourself" rows="4"></textarea></div>
</div>

### Textarea usage

```tsx fragment
<Textarea value={this.form.bio} placeholder="Tell us about yourself" rows={4} />
```

### Textarea props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>value</code></td><td><code>bound state</code></td><td>—</td><td>Two-way bind to an @expose / form field.</td></tr>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Extra classes.</td></tr>
  </tbody>
</table>

<a id="components-label"></a>

## Label

Form label (wraps the headless Label).

### Label installation

```sh
bun zt flow:add label
```

Or import directly from the package: `import { Label } from "@zerotal/flow-ui";`

### Label preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="flex flex-col gap-1.5"><label for="email" class="flow-label text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Email address</label><input type="text" data-slot="input" class="flex h-9 min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 w-64" id="email" placeholder="you@example.com"></div>
</div>

### Label usage

```tsx fragment
<Label for="email">Email</Label>
```

### Label props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>for</code></td><td><code>string</code></td><td>—</td><td>Associated control id.</td></tr>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Extra classes.</td></tr>
  </tbody>
</table>

<a id="components-separator"></a>

## Separator

Horizontal/vertical divider.

### Separator installation

```sh
bun zt flow:add separator
```

Or import directly from the package: `import { Separator } from "@zerotal/flow-ui";`

### Separator preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="w-72"><p class="text-sm font-medium text-foreground">Radix Primitives</p><p class="text-sm text-muted-foreground">An open-source UI component library.</p><div role="none" class="shrink-0 bg-border h-px w-full my-3"></div><div class="flex h-5 items-center gap-3 text-sm"><span>Blog</span><div role="none" class="shrink-0 bg-border h-full w-px"></div><span>Docs</span><div role="none" class="shrink-0 bg-border h-full w-px"></div><span>Source</span></div></div>
</div>

### Separator usage

```tsx fragment
<Separator />
<Separator orientation="vertical" class="h-6" />
```

### Separator props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>orientation</code></td><td><code>"horizontal" | "vertical"</code></td><td><code>"horizontal"</code></td><td>Divider direction.</td></tr>
  <tr><td><code>decorative</code></td><td><code>boolean</code></td><td><code>true</code></td><td>ARIA-hidden when decorative; semantic separator otherwise.</td></tr>
  </tbody>
</table>

<a id="components-skeleton"></a>

## Skeleton

Pulsing loading placeholder.

### Skeleton installation

```sh
bun zt flow:add skeleton
```

Or import directly from the package: `import { Skeleton } from "@zerotal/flow-ui";`

### Skeleton preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="flex items-center gap-3"><div class="animate-pulse bg-muted h-12 w-12 rounded-full"></div><div class="flex flex-col gap-2"><div class="animate-pulse rounded-md bg-muted h-4 w-40"></div><div class="animate-pulse rounded-md bg-muted h-4 w-28"></div></div></div>
</div>

### Skeleton usage

```tsx fragment
<Skeleton class="h-12 w-12 rounded-full" />
<Skeleton class="h-4 w-48" />
```

### Skeleton props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Size + shape via utilities.</td></tr>
  </tbody>
</table>

<a id="components-avatar"></a>

## Avatar

Circular avatar with image + fallback.

### Avatar installation

```sh
bun zt flow:add avatar
```

Or import directly from the package: `import { Avatar } from "@zerotal/flow-ui";`

### Avatar preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="flex flex-wrap items-center gap-3"><span class="relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full"><img src="https://i.pravatar.cc/64?img=11" alt="Ada Mokoena" class="aspect-square h-full w-full object-cover"></span><span class="relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full"><span class="flex h-full w-full items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">AL</span></span><span class="relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full bg-primary text-primary-foreground"><span class="flex h-full w-full items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">GH</span></span></div>
</div>

### Avatar usage

```tsx fragment
<Avatar src={user.avatarUrl} alt={user.name} fallback="AL" />
<Avatar fallback="GH" />
```

### Avatar props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>src</code></td><td><code>string | null</code></td><td>—</td><td>Image URL; falls back to `fallback` when absent.</td></tr>
  <tr><td><code>fallback</code></td><td><code>node</code></td><td>—</td><td>Shown when there's no image (e.g. initials).</td></tr>
  <tr><td><code>alt</code></td><td><code>string</code></td><td>—</td><td>Image alt text.</td></tr>
  </tbody>
</table>

<a id="components-switch"></a>

## Switch

On/off toggle bound to a boolean.

### Switch installation

```sh
bun zt flow:add switch
```

Or import directly from the package: `import { Switch } from "@zerotal/flow-ui";`

### Switch preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<label class="flex items-center gap-2 text-sm"><button type="button" role="switch" tabindex="0" aria-checked="true" class="flow-switch group inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background bg-input data-checked:bg-primary" data-checked=""><span class="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform translate-x-0 group-data-checked:translate-x-4"></span></button>Airplane mode</label>
</div>

### Switch usage

```tsx fragment
<Switch bind={this.notifications} />
```

### Switch props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>bind</code></td><td><code>@expose boolean</code></td><td>—</td><td>Two-way bound boolean (server-synced).</td></tr>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Extra classes on the track.</td></tr>
  </tbody>
</table>

<a id="components-checkbox"></a>

## Checkbox

Checkbox bound to a boolean.

### Checkbox installation

```sh
bun zt flow:add checkbox
```

Or import directly from the package: `import { Checkbox } from "@zerotal/flow-ui";`

### Checkbox preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<label class="flex items-center gap-2 text-sm"><button type="button" role="checkbox" tabindex="0" aria-checked="true" class="flow-checkbox grid h-4 w-4 shrink-0 place-items-center rounded-sm border border-primary text-transparent shadow outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-checked:bg-primary data-checked:text-primary-foreground" data-checked=""><svg viewBox="0 0 16 16" fill="none" class="h-3.5 w-3.5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"></path></svg></button>Accept terms and conditions</label>
</div>

### Checkbox usage

```tsx fragment
<Checkbox bind={this.agree} />
```

### Checkbox props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>bind</code></td><td><code>@expose boolean</code></td><td>—</td><td>Two-way bound boolean.</td></tr>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Extra classes.</td></tr>
  </tbody>
</table>

<a id="components-select"></a>

## Select

Native select bound to a value.

### Select installation

```sh
bun zt flow:add select
```

Or import directly from the package: `import { Select } from "@zerotal/flow-ui";`

### Select preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="w-56"><select class="flow-select flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"><option value="ca" selected>Canada</option><option value="br">Brazil</option><option value="jp">Japan</option></select></div>
</div>

### Select usage

```tsx fragment
<Select bind={this.country} options={[{ label: "Canada", value: "ca" }]} />
```

### Select props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>bind</code></td><td><code>@expose value</code></td><td>—</td><td>Two-way bound value (flow:model).</td></tr>
  <tr><td><code>options</code></td><td><code>{ label, value }[]</code></td><td>—</td><td>Option list.</td></tr>
  <tr><td><code>placeholder</code></td><td><code>string</code></td><td>—</td><td>Optional empty first option.</td></tr>
  </tbody>
</table>

<a id="components-radio-group"></a>

## RadioGroup

Segmented radio set bound to a value.

### RadioGroup installation

```sh
bun zt flow:add radio-group
```

Or import directly from the package: `import { RadioGroup } from "@zerotal/flow-ui";`

### RadioGroup preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div role="radiogroup" x-data="{}" class="flow-radiogroup grid gap-2 w-56"><div role="radio" aria-checked="false" class="flow-radio flex cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground" tabindex="-1">Free</div><div role="radio" aria-checked="true" class="flow-radio flex cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground" data-checked="" tabindex="0">Pro</div><div role="radio" aria-checked="false" class="flow-radio flex cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground" tabindex="-1">Enterprise</div></div>
</div>

### RadioGroup usage

```tsx fragment
<RadioGroup bind={this.plan} options={[{ label: "Pro", value: "pro" }]} />
```

### RadioGroup props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>bind</code></td><td><code>@expose value</code></td><td>—</td><td>Two-way bound value.</td></tr>
  <tr><td><code>options</code></td><td><code>{ label, value }[]</code></td><td>—</td><td>Option list.</td></tr>
  <tr><td><code>optionClass</code></td><td><code>string</code></td><td>—</td><td>Per-option classes.</td></tr>
  </tbody>
</table>

<a id="components-dialog"></a>

## Dialog

Modal dialog (focus-trapped).

### Dialog installation

```sh
bun zt flow:add dialog
```

Or import directly from the package: `import { Dialog } from "@zerotal/flow-ui";`

### Dialog preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<button type="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2">Edit profile</button>
</div>

### Dialog usage

```tsx fragment
<Button onClick={() => (this.open = true)}>Edit profile</Button>

<Dialog show={this.open} title="Edit profile" description="Make changes here.">
  <form onSubmit={this.save} class="flex flex-col gap-3">
    <Field label="Name"><Input value={this.form.name} /></Field>
    <Button type="submit">Save</Button>
  </form>
</Dialog>
```

### Dialog props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>show</code></td><td><code>@expose boolean</code></td><td>—</td><td>Visibility (focus-trapped while open).</td></tr>
  <tr><td><code>title</code></td><td><code>node</code></td><td>—</td><td>Dialog title (wires aria-labelledby).</td></tr>
  <tr><td><code>description</code></td><td><code>node</code></td><td>—</td><td>Supporting text (aria-describedby).</td></tr>
  <tr><td><code>closable</code></td><td><code>boolean</code></td><td><code>true</code></td><td>Show the × + allow backdrop/Escape close.</td></tr>
  </tbody>
</table>

<a id="components-sheet"></a>

## Sheet

Edge-anchored slide-over panel.

### Sheet installation

```sh
bun zt flow:add sheet
```

Or import directly from the package: `import { Sheet } from "@zerotal/flow-ui";`

### Sheet preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<button type="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2">Open sheet</button>
</div>

### Sheet usage

```tsx fragment
<Button onClick={() => (this.open = true)}>Open</Button>

<Sheet show={this.open} side="right" title="Edit profile">…</Sheet>
```

### Sheet props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>show</code></td><td><code>@expose boolean</code></td><td>—</td><td>Visibility (focus-trapped while open).</td></tr>
  <tr><td><code>side</code></td><td><code>"left" | "right" | "top" | "bottom"</code></td><td><code>"right"</code></td><td>Edge to slide from.</td></tr>
  <tr><td><code>title</code></td><td><code>node</code></td><td>—</td><td>Header title.</td></tr>
  </tbody>
</table>

<a id="components-dropdown-menu"></a>

## DropdownMenu

Keyboard-navigable menu (+ item/label/separator).

### DropdownMenu installation

```sh
bun zt flow:add dropdown-menu
```

Or import directly from the package: `import { DropdownMenu } from "@zerotal/flow-ui";`

### DropdownMenu preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<button type="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2">Options ▾</button>
</div>

### DropdownMenu usage

```tsx fragment
<DropdownMenu label="Options">
  <DropdownMenuLabel>My account</DropdownMenuLabel>
  <DropdownMenuItem onClick={this.profile}>Profile</DropdownMenuItem>
  <DropdownMenuSeparator />
  <DropdownMenuItem variant="destructive" onClick={this.signOut}>
    Sign out
  </DropdownMenuItem>
</DropdownMenu>
```

### DropdownMenu props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>label</code></td><td><code>node</code></td><td>—</td><td>Default trigger label (or pass `trigger`).</td></tr>
  <tr><td><code>align</code></td><td><code>"left" | "right"</code></td><td><code>"left"</code></td><td>Panel alignment.</td></tr>
  </tbody>
</table>

<a id="components-tabs"></a>

## Tabs

Tabbed panels with a pill tablist.

### Tabs installation

```sh
bun zt flow:add tabs
```

Or import directly from the package: `import { Tabs } from "@zerotal/flow-ui";`

### Tabs preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="w-80"><div x-data="flowTabs({ tab: &quot;0&quot; })" class="flex flex-col"><div role="tablist" x-on:keydown="onKey($event)" class="inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground"><button type="button" role="tab" id="flow-tab-0" aria-controls="flow-tabpanel-0" :aria-selected="tab === &quot;0&quot;" :tabindex="tab === &quot;0&quot; ? 0 : -1" x-on:click="tab = &quot;0&quot;" :class="tab === &quot;0&quot; ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'" class="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring">Account</button><button type="button" role="tab" id="flow-tab-1" aria-controls="flow-tabpanel-1" :aria-selected="tab === &quot;1&quot;" :tabindex="tab === &quot;1&quot; ? 0 : -1" x-on:click="tab = &quot;1&quot;" :class="tab === &quot;1&quot; ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'" class="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring">Password</button></div><div role="tabpanel" id="flow-tabpanel-0" aria-labelledby="flow-tab-0" tabindex="0" x-show="tab === &quot;0&quot;" x-cloak class="mt-2 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"><p class="text-sm text-muted-foreground">Account settings.</p></div><div role="tabpanel" id="flow-tabpanel-1" aria-labelledby="flow-tab-1" tabindex="0" x-show="tab === &quot;1&quot;" x-cloak class="mt-2 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"><p class="text-sm text-muted-foreground">Change your password.</p></div></div></div>
</div>

### Tabs usage

```tsx fragment
<Tabs
  items={[
    { label: "Account", content: <AccountForm /> },
    { label: "Password", content: <PasswordForm /> },
  ]}
/>
```

### Tabs props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>items</code></td><td><code>{ label, content, name? }[]</code></td><td>—</td><td>Tabs + their panels.</td></tr>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Extra classes.</td></tr>
  </tbody>
</table>

<a id="components-alert"></a>

## Alert

Inline alert (+ title/description).

### Alert installation

```sh
bun zt flow:add alert
```

Or import directly from the package: `import { Alert } from "@zerotal/flow-ui";`

### Alert preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="flex w-96 flex-col gap-3"><div role="status" x-data="{ shown: true }" x-show="shown" class="relative w-full rounded-lg border px-4 py-3 text-sm bg-background text-foreground flex items-start gap-3"><div class="min-w-0 flex-1"><div class="mb-1 font-medium leading-none tracking-tight">Heads up!</div><div class="text-sm [&amp;_p]:leading-relaxed">You can add components to your app using the CLI.</div></div></div><div role="alert" x-data="{ shown: true }" x-show="shown" class="relative w-full rounded-lg border px-4 py-3 text-sm border-destructive/50 text-destructive flex items-start gap-3"><div class="min-w-0 flex-1"><div class="mb-1 font-medium leading-none tracking-tight">Error</div><div class="text-sm [&amp;_p]:leading-relaxed">Your session has expired.</div></div></div></div>
</div>

### Alert usage

```tsx fragment
<Alert title="Heads up!">You can add components to your app.</Alert>
<Alert variant="destructive" title="Error">Something went wrong.</Alert>
```

### Alert props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>variant</code></td><td><code>"default" | "destructive"</code></td><td><code>"default"</code></td><td>Visual style + ARIA role.</td></tr>
  <tr><td><code>title</code></td><td><code>node</code></td><td>—</td><td>Bold title line.</td></tr>
  <tr><td><code>dismissible</code></td><td><code>boolean</code></td><td><code>false</code></td><td>Show a client-only dismiss button.</td></tr>
  </tbody>
</table>

<a id="components-tooltip"></a>

## Tooltip

Hover/focus tooltip.

### Tooltip installation

```sh
bun zt flow:add tooltip
```

Or import directly from the package: `import { Tooltip } from "@zerotal/flow-ui";`

### Tooltip preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<button type="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 w-9">+</button>
</div>

### Tooltip usage

```tsx fragment
<Tooltip content="Add to library">
  <Button size="icon">+</Button>
</Tooltip>
```

### Tooltip props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>content</code></td><td><code>node</code></td><td>—</td><td>Tooltip text.</td></tr>
  <tr><td><code>placement</code></td><td><code>"top" | "bottom"</code></td><td><code>"top"</code></td><td>Bubble position.</td></tr>
  </tbody>
</table>

<a id="components-table"></a>

## Table

URL-sortable data table.

### Table installation

```sh
bun zt flow:add table
```

Or import directly from the package: `import { Table } from "@zerotal/flow-ui";`

### Table preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="w-96"><table class="w-full caption-bottom border-collapse text-sm"><thead class="[&amp;_tr]:border-b [&amp;_tr]:border-border"><tr><th scope="col" class="h-10 px-2 text-left align-middle font-medium text-muted-foreground">Name</th><th scope="col" class="h-10 px-2 text-left align-middle font-medium text-muted-foreground">Role</th></tr></thead><tbody><tr flow:key="Ada Lovelace" class="border-b border-border transition-colors hover:bg-muted/50"><td class="p-2 align-middle">Ada Lovelace</td><td class="p-2 align-middle">Engineer</td></tr><tr flow:key="Alan Turing" class="border-b border-border transition-colors hover:bg-muted/50"><td class="p-2 align-middle">Alan Turing</td><td class="p-2 align-middle">Researcher</td></tr></tbody></table></div>
</div>

### Table usage

```tsx fragment
<Table
  columns={[
    { key: "name", label: "Name", sortable: true },
    { key: "role", label: "Role" },
  ]}
  rows={people}
  sortBy={this.sortBy}
  sortDir={this.sortDir}
  hover
/>
```

### Table props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>columns</code></td><td><code>TableColumn[]</code></td><td>—</td><td>Column defs (key, label, sortable?, render?).</td></tr>
  <tr><td><code>rows</code></td><td><code>T[]</code></td><td>—</td><td>Row data.</td></tr>
  <tr><td><code>sortBy / sortDir</code></td><td><code>@url state</code></td><td>—</td><td>Bind to URL sort state for sortable headers.</td></tr>
  </tbody>
</table>

<a id="components-popover"></a>

## Popover

Floating panel anchored to a trigger.

### Popover installation

```sh
bun zt flow:add popover
```

Or import directly from the package: `import { Popover } from "@zerotal/flow-ui";`

### Popover preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div x-data="{ open: false }" class="flow-popover relative inline-block"><span x-on:click="open = !open" :aria-expanded="open" :data-open="open ? '' : null" role="button" tabindex="0" class="flow-popover-button cursor-pointer outline-none"><button type="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2">Options</button></span><div x-show="open" x-cloak x-transition x-on:click.outside="open = false" x-on:keydown.escape.window="open = false" :data-open="open ? '' : null" class="flow-popover-panel absolute top-full mt-2 left-0 z-50 min-w-[8rem] rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md outline-none"><p class="text-sm">Anything at all.</p></div></div>
</div>

### Popover usage

```tsx fragment
<Popover trigger={<Button variant="outline">Options</Button>}>
  <p class="text-sm">Anything at all.</p>
</Popover>
```

### Popover props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>trigger</code></td><td><code>node</code></td><td>—</td><td>The element that opens the panel.</td></tr>
  <tr><td><code>side</code></td><td><code>"top" | "right" | "bottom" | "left"</code></td><td><code>"bottom"</code></td><td>Which edge the panel sits on.</td></tr>
  <tr><td><code>align</code></td><td><code>"start" | "center" | "end"</code></td><td><code>"start"</code></td><td>How the panel lines up along that edge.</td></tr>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Extra classes, merged last (wins over defaults).</td></tr>
  </tbody>
</table>

<a id="components-hover-card"></a>

## HoverCard

Preview panel shown on hover.

### HoverCard installation

```sh
bun zt flow:add hover-card
```

Or import directly from the package: `import { HoverCard } from "@zerotal/flow-ui";`

### HoverCard preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div x-data="{
    open: false,
    t: null,
    show() { clearTimeout(this.t); this.t = setTimeout(() =&gt; (this.open = true), 300); },
    hide() { clearTimeout(this.t); this.t = setTimeout(() =&gt; (this.open = false), 150); }
  }" class="relative inline-block" x-on:mouseenter="show()" x-on:mouseleave="hide()"><span tabindex="0" x-on:focus="open = true" x-on:blur="hide()" class="cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"><span class="underline">@ada</span></span><div x-show="open" x-cloak x-transition class="absolute z-50 w-64 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md top-full mt-2 left-0"><p class="text-sm font-medium">Ada Mokoena</p><p class="text-xs text-muted-foreground">Joined in 2024</p></div></div>
</div>

### HoverCard usage

```tsx fragment
<HoverCard trigger={<a href="/users/1">@ada</a>}>
  <p class="text-sm font-medium">Ada Mokoena</p>
</HoverCard>
```

### HoverCard props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>trigger</code></td><td><code>node</code></td><td>—</td><td>What is hovered.</td></tr>
  <tr><td><code>openDelay</code></td><td><code>number</code></td><td><code>300</code></td><td>Milliseconds before it opens.</td></tr>
  <tr><td><code>closeDelay</code></td><td><code>number</code></td><td><code>150</code></td><td>Grace period so the pointer can reach the panel.</td></tr>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Extra classes, merged last (wins over defaults).</td></tr>
  </tbody>
</table>

<a id="components-alert-dialog"></a>

## AlertDialog

Confirm before something irreversible.

### AlertDialog installation

```sh
bun zt flow:add alert-dialog
```

Or import directly from the package: `import { AlertDialog } from "@zerotal/flow-ui";`

### AlertDialog preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div role="dialog" aria-modal="true" class="fixed inset-0 z-50 flex items-center justify-center p-4"><div class="absolute inset-0 bg-black/50"></div><div class="relative z-10 w-full max-w-lg rounded-lg border border-border bg-background p-6 text-foreground shadow-lg" flow:transition><div class="mb-4 flex flex-col gap-1.5 pr-6"><h2 class="text-lg font-semibold leading-none tracking-tight">Delete this product?</h2><p class="text-sm text-muted-foreground">It will be removed from every order. This cannot be undone.</p></div><div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2">Cancel</button><button type="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 bg-destructive text-destructive-foreground hover:bg-destructive/90 h-9 px-4 py-2">Delete</button></div></div></div>
</div>

### AlertDialog usage

```tsx fragment
<AlertDialog
  show={this.confirming}
  title="Delete this product?"
  description="It will be removed from every order. This cannot be undone."
  confirmLabel="Delete"
  onConfirm={this.destroy}
/>
```

### AlertDialog props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>show</code></td><td><code>boolean</code></td><td>—</td><td>Bound @expose boolean controlling visibility.</td></tr>
  <tr><td><code>title</code></td><td><code>node</code></td><td>—</td><td>The question.</td></tr>
  <tr><td><code>description</code></td><td><code>node</code></td><td>—</td><td>What will happen. Worth a full sentence.</td></tr>
  <tr><td><code>onConfirm</code></td><td><code>handler</code></td><td>—</td><td>Server action for the confirming choice.</td></tr>
  <tr><td><code>destructive</code></td><td><code>boolean</code></td><td><code>true</code></td><td>Style the confirm button as destructive.</td></tr>
  </tbody>
</table>

<a id="components-command"></a>

## Command

Searchable command menu (⌘K palette).

### Command installation

```sh
bun zt flow:add command
```

Or import directly from the package: `import { Command } from "@zerotal/flow-ui";`

### Command preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<p class="text-sm text-muted-foreground">Mounted hidden; press <kbd class="pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground" x-data="{ mac: false }" x-init="mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)" x-text="mac ? '⌘' : 'Ctrl'">Ctrl</kbd> <kbd class="pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">K</kbd> to open it.</p><div x-data="flowCommand({&quot;items&quot;:[{&quot;label&quot;:&quot;Products&quot;,&quot;href&quot;:&quot;#&quot;,&quot;group&quot;:&quot;Go to&quot;},{&quot;label&quot;:&quot;Orders&quot;,&quot;href&quot;:&quot;#&quot;,&quot;group&quot;:&quot;Go to&quot;},{&quot;label&quot;:&quot;New order&quot;,&quot;href&quot;:&quot;#&quot;,&quot;group&quot;:&quot;Create&quot;}],&quot;hotkey&quot;:&quot;k&quot;})" x-show="open" x-cloak x-transition.opacity x-on:click="if ($event.target === $el) hide()" x-on:keydown.escape.window="hide()" class="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]"><div role="dialog" aria-modal="true" aria-label="Command menu" class="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"><div class="flex items-center gap-2 border-b border-border px-3"><svg class="h-4 w-4 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg><input x-ref="field" type="text" role="combobox" aria-expanded="true" aria-controls="flow-command-list" autocomplete="off" placeholder="Search…" x-model="query" x-on:input="active = 0" x-on:keydown.arrow-down.prevent="move(1)" x-on:keydown.arrow-up.prevent="move(-1)" x-on:keydown.enter.prevent="choose()" class="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"></div><div id="flow-command-list" role="listbox" class="max-h-80 overflow-y-auto p-2"><template x-for="(item, i) in results()" :key="item.label + i"><div><div x-show="startsGroup(i)" x-text="item.group" class="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"></div><div role="option" :aria-selected="active === i" x-on:click="choose(i)" x-on:mousemove="active = i" :class="active === i &amp;&amp; 'bg-accent text-accent-foreground'" class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm"><span class="flex-1 truncate" x-text="item.label"></span><span x-show="item.shortcut" x-text="item.shortcut" class="text-[11px] text-muted-foreground"></span></div></div></template><p x-show="results().length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">Nothing found.</p></div></div></div>
</div>

### Command usage

```tsx fragment
<Command
  items={[
    { label: "Products", href: "/admin/products", group: "Go to" },
    { label: "New order", href: "/admin/orders/create", group: "Create" },
  ]}
/>
```

### Command props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>items</code></td><td><code>CommandItem[]</code></td><td>—</td><td>Destinations and actions, each with an optional group.</td></tr>
  <tr><td><code>hotkey</code></td><td><code>string | null</code></td><td><code>"k"</code></td><td>Key that opens it with the platform modifier.</td></tr>
  <tr><td><code>placeholder</code></td><td><code>string</code></td><td><code>"Search…"</code></td><td>Placeholder in the search box.</td></tr>
  <tr><td><code>emptyMessage</code></td><td><code>string</code></td><td><code>"Nothing found."</code></td><td>Shown when nothing matches.</td></tr>
  </tbody>
</table>

<a id="components-context-menu"></a>

## ContextMenu

Right-click menu.

### ContextMenu installation

```sh
bun zt flow:add context-menu
```

Or import directly from the package: `import { ContextMenu } from "@zerotal/flow-ui";`

### ContextMenu preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div x-data="{ open: false, x: 0, y: 0 }" x-on:contextmenu=" $event.preventDefault(); open = true; $nextTick(() =&gt; { const menu = $refs.menu; const w = menu.offsetWidth, h = menu.offsetHeight; x = Math.min($event.clientX, window.innerWidth - w - 8); y = Math.min($event.clientY, window.innerHeight - h - 8); }); " class="contents"><div class="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Right-click me</div><div x-ref="menu" x-show="open" x-cloak x-on:click.outside="open = false" x-on:keydown.escape.window="open = false" x-bind:style="`position:fixed;left:${x}px;top:${y}px`" role="menu" class="z-50 min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"><button type="button" role="menuitem" class="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"><span class="flex-1">Open</span><span class="text-xs text-muted-foreground">↵</span></button><div role="separator" class="-mx-1 my-1 h-px bg-border"></div><button type="button" role="menuitem" class="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 text-destructive hover:bg-destructive/10"><span class="flex-1">Delete</span></button></div></div>
</div>

### ContextMenu usage

```tsx fragment
<ContextMenu
  items={[
    { label: "Open", action: "$flow.open(id)" },
    { separator: true },
    { label: "Delete", action: "$flow.remove(id)", danger: true },
  ]}
>
  <div>Right-click me</div>
</ContextMenu>
```

### ContextMenu props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>items</code></td><td><code>ContextMenuItem[]</code></td><td>—</td><td>Entries, dividers and destructive actions.</td></tr>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Extra classes, merged last (wins over defaults).</td></tr>
  </tbody>
</table>

<a id="components-menubar"></a>

## Menubar

Application menu bar.

### Menubar installation

```sh
bun zt flow:add menubar
```

Or import directly from the package: `import { Menubar } from "@zerotal/flow-ui";`

### Menubar preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div x-data="{ open: -1 }" x-on:click.outside="open = -1" x-on:keydown.escape.window="open = -1" role="menubar" class="flex items-center gap-0.5 rounded-md border border-border bg-card p-1"><div class="relative"><button type="button" role="menuitem" x-on:click="open = open === 0 ? -1 : 0" x-on:mouseenter="if (open !== -1) open = 0" x-bind:aria-expanded="open === 0" x-bind:class="open === 0 &amp;&amp; 'bg-accent text-accent-foreground'" class="rounded-sm px-3 py-1 text-sm font-medium outline-none transition-colors hover:bg-accent hover:text-accent-foreground">File</button><div x-show="open === 0" x-cloak x-transition role="menu" class="absolute left-0 top-full z-50 mt-1 min-w-48 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"><button type="button" role="menuitem" class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"><span class="flex-1">New</span><span class="text-xs text-muted-foreground">⌘N</span></button><div role="separator" class="-mx-1 my-1 h-px bg-border"></div><button type="button" role="menuitem" class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"><span class="flex-1">Export</span></button></div></div><div class="relative"><button type="button" role="menuitem" x-on:click="open = open === 1 ? -1 : 1" x-on:mouseenter="if (open !== -1) open = 1" x-bind:aria-expanded="open === 1" x-bind:class="open === 1 &amp;&amp; 'bg-accent text-accent-foreground'" class="rounded-sm px-3 py-1 text-sm font-medium outline-none transition-colors hover:bg-accent hover:text-accent-foreground">Edit</button><div x-show="open === 1" x-cloak x-transition role="menu" class="absolute left-0 top-full z-50 mt-1 min-w-48 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"><button type="button" role="menuitem" class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"><span class="flex-1">Undo</span><span class="text-xs text-muted-foreground">⌘Z</span></button><button type="button" role="menuitem" class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"><span class="flex-1">Redo</span><span class="text-xs text-muted-foreground">⇧⌘Z</span></button></div></div><div class="relative"><button type="button" role="menuitem" x-on:click="open = open === 2 ? -1 : 2" x-on:mouseenter="if (open !== -1) open = 2" x-bind:aria-expanded="open === 2" x-bind:class="open === 2 &amp;&amp; 'bg-accent text-accent-foreground'" class="rounded-sm px-3 py-1 text-sm font-medium outline-none transition-colors hover:bg-accent hover:text-accent-foreground">View</button><div x-show="open === 2" x-cloak x-transition role="menu" class="absolute left-0 top-full z-50 mt-1 min-w-48 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"><button type="button" role="menuitem" class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"><span class="flex-1">Zoom in</span></button><button type="button" role="menuitem" class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"><span class="flex-1">Zoom out</span></button></div></div></div>
</div>

### Menubar usage

```tsx fragment
<Menubar
  menus={[
    { label: "File", items: [{ label: "New", shortcut: "⌘N" }] },
    { label: "Edit", items: [{ label: "Undo", shortcut: "⌘Z" }] },
  ]}
/>
```

### Menubar props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>menus</code></td><td><code>MenubarMenu[]</code></td><td>—</td><td>Top-level menus, each with its own items.</td></tr>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Extra classes, merged last (wins over defaults).</td></tr>
  </tbody>
</table>

<a id="components-navigation-menu"></a>

## NavigationMenu

Site nav with dropdown panels.

### NavigationMenu installation

```sh
bun zt flow:add navigation-menu
```

Or import directly from the package: `import { NavigationMenu } from "@zerotal/flow-ui";`

### NavigationMenu preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<nav class="relative flex items-center gap-1"><a href="#" flow:navigate class="inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">Docs</a><div x-data="{ open: false }" x-on:mouseenter="open = true" x-on:mouseleave="open = false" x-on:focusin="open = true" x-on:focusout="open = false" class="relative"><button type="button" x-bind:aria-expanded="open" class="inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">Products<svg class="h-3 w-3 transition-transform" x-bind:class="open &amp;&amp; 'rotate-180'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button><div x-show="open" x-cloak x-transition class="absolute left-0 top-full z-50 mt-1.5 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg w-72 space-y-1"><a href="#" flow:navigate class="flex gap-3 rounded-md p-3 transition-colors hover:bg-accent hover:text-accent-foreground"><span class="min-w-0"><span class="block text-sm font-medium">Admin</span><span class="mt-0.5 block text-xs leading-snug text-muted-foreground">Declarative back office</span></span></a><a href="#" flow:navigate class="flex gap-3 rounded-md p-3 transition-colors hover:bg-accent hover:text-accent-foreground"><span class="min-w-0"><span class="block text-sm font-medium">Flow</span><span class="mt-0.5 block text-xs leading-snug text-muted-foreground">Server-driven reactivity</span></span></a></div></div></nav>
</div>

### NavigationMenu usage

```tsx fragment
<NavigationMenu
  items={[
    { label: "Docs", href: "/docs" },
    { label: "Products", panel: [{ label: "Admin", href: "/admin", description: "Back office" }] },
  ]}
/>
```

### NavigationMenu props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>items</code></td><td><code>NavigationMenuItem[]</code></td><td>—</td><td>Links, some of which open a panel.</td></tr>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Extra classes, merged last (wins over defaults).</td></tr>
  </tbody>
</table>

<a id="components-sidebar"></a>

## Sidebar

App shell nav rail with a mobile drawer.

### Sidebar installation

```sh
bun zt flow:add sidebar
```

Or import directly from the package: `import { Sidebar } from "@zerotal/flow-ui";`

### Sidebar preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="h-64 overflow-hidden rounded-lg border border-border"><aside class="flex w-64 flex-col border-r border-border bg-card"><a href="/" flow:navigate class="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4"><span class="min-w-0"><span class="block truncate text-sm font-semibold">Zerotal</span><span class="block truncate text-[11px] text-muted-foreground">Back office</span></span></a><nav class="flex-1 space-y-4 overflow-y-auto p-3"><div class="space-y-1"><p class="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Shop</p><a href="/admin/products" flow:navigate aria-current="page" class="group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors hover:bg-accent/50 hover:text-foreground [&amp;[aria-current]]:bg-accent [&amp;[aria-current]]:text-accent-foreground bg-accent text-accent-foreground"><span class="truncate">Products</span><span class="ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none bg-muted text-muted-foreground">12</span></a><a href="/admin/orders" flow:navigate class="group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors text-muted-foreground hover:bg-accent/50 hover:text-foreground [&amp;[aria-current]]:bg-accent [&amp;[aria-current]]:text-accent-foreground"><span class="truncate">Orders</span></a></div><div class="space-y-1"><p class="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">System</p><a href="/admin/settings" flow:navigate class="group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors text-muted-foreground hover:bg-accent/50 hover:text-foreground [&amp;[aria-current]]:bg-accent [&amp;[aria-current]]:text-accent-foreground"><span class="truncate">Settings</span></a></div></nav></aside></div>
</div>

### Sidebar usage

```tsx fragment
<Sidebar
  brand="Zerotal"
  tagline="Back office"
  current={path}
  groups={[{ label: "Shop", items: [{ label: "Products", href: "/admin/products", badge: 12 }] }]}
/>
```

### Sidebar props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>groups</code></td><td><code>SidebarGroup[]</code></td><td>—</td><td>Nav tree, optionally nested one level.</td></tr>
  <tr><td><code>current</code></td><td><code>string</code></td><td>—</td><td>Current path, for marking the active item.</td></tr>
  <tr><td><code>collapsible</code></td><td><code>boolean</code></td><td><code>true</code></td><td>Render the mobile drawer toggle.</td></tr>
  <tr><td><code>footer</code></td><td><code>node</code></td><td>—</td><td>Pinned to the bottom — a user menu, a version.</td></tr>
  </tbody>
</table>

<a id="components-breadcrumb"></a>

## Breadcrumb

Trail showing where a page sits.

### Breadcrumb installation

```sh
bun zt flow:add breadcrumb
```

Or import directly from the package: `import { Breadcrumb } from "@zerotal/flow-ui";`

### Breadcrumb preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<nav aria-label="Breadcrumb" class="text-xs text-muted-foreground"><ol class="flex flex-wrap items-center gap-1.5"><li class="inline-flex items-center gap-1.5"><a href="#" flow:navigate class="inline-flex items-center gap-1 transition-colors hover:text-foreground">Dashboard</a></li><li class="inline-flex items-center gap-1.5"><svg class="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg><a href="#" flow:navigate class="inline-flex items-center gap-1 transition-colors hover:text-foreground">Products</a></li><li class="inline-flex items-center gap-1.5"><svg class="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg><span aria-current="page" class="inline-flex items-center gap-1 text-foreground">Desk Lamp</span></li></ol></nav>
</div>

### Breadcrumb usage

```tsx fragment
<Breadcrumb
  items={[
    { label: "Dashboard", href: "/admin" },
    { label: "Products", href: "/admin/products" },
    { label: "Desk Lamp" },
  ]}
/>
```

### Breadcrumb props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>items</code></td><td><code>BreadcrumbItem[]</code></td><td>—</td><td>The trail. The last item renders as the current page.</td></tr>
  <tr><td><code>maxItems</code></td><td><code>number</code></td><td>—</td><td>Collapse a longer trail to first + last few.</td></tr>
  <tr><td><code>separator</code></td><td><code>node</code></td><td>—</td><td>What sits between items.</td></tr>
  </tbody>
</table>

<a id="components-pagination"></a>

## Pagination

Page links with a windowed number range.

### Pagination installation

```sh
bun zt flow:add pagination
```

Or import directly from the package: `import { Pagination } from "@zerotal/flow-ui";`

### Pagination preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<nav aria-label="Pagination" class="flex flex-wrap items-center justify-between gap-3"><p class="text-sm text-muted-foreground">61–80 of 231</p><div class="flex items-center gap-1"><a href="#" flow:navigate aria-label="Previous page" class="inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"><svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg></a><a href="#" flow:navigate aria-label="Page 1" class="inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">1</a><a href="#" flow:navigate aria-label="Page 2" class="inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">2</a><a href="#" flow:navigate aria-label="Page 3" class="inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">3</a><a href="#" flow:navigate aria-current="page" class="inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors bg-primary text-primary-foreground">4</a><a href="#" flow:navigate aria-label="Page 5" class="inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">5</a><a href="#" flow:navigate aria-label="Page 6" class="inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">6</a><span class="px-1 text-sm text-muted-foreground" aria-hidden="true">…</span><a href="#" flow:navigate aria-label="Page 12" class="inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">12</a><a href="#" flow:navigate aria-label="Next page" class="inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"><svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg></a></div></nav>
</div>

### Pagination usage

```tsx fragment
<Pagination
  page={p.page}
  lastPage={p.lastPage}
  total={p.total}
  perPage={p.perPage}
  href={(n) => `?page=${n}`}
/>
```

### Pagination props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>page</code></td><td><code>number</code></td><td>—</td><td>Current page, 1-based.</td></tr>
  <tr><td><code>lastPage</code></td><td><code>number</code></td><td>—</td><td>How many pages there are.</td></tr>
  <tr><td><code>href</code></td><td><code>(page: number) =&gt; string</code></td><td>—</td><td>Builds each page's URL, keeping your other params.</td></tr>
  <tr><td><code>total</code></td><td><code>number</code></td><td>—</td><td>Row count, shown as “1–20 of 231”.</td></tr>
  <tr><td><code>siblings</code></td><td><code>number</code></td><td><code>5</code></td><td>Numbered links around the current page.</td></tr>
  </tbody>
</table>

<a id="components-field"></a>

## Field

Label + control + description + error.

### Field installation

```sh
bun zt flow:add field
```

Or import directly from the package: `import { Field } from "@zerotal/flow-ui";`

### Field preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="w-full max-w-sm space-y-4"><div class="space-y-1.5"><label for="flow-field-1" class="block text-sm font-medium leading-none text-foreground">Email<span class="ml-0.5 text-destructive" aria-hidden="true">*</span></label><div class="space-y-1.5"><input type="email" data-slot="input" class="flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40" placeholder="ada@example.com" id="flow-field-1" aria-describedby="flow-field-1-description" aria-required="true"><p id="flow-field-1-description" class="text-xs text-muted-foreground">We never share it.</p></div></div><div class="space-y-1.5"><label for="flow-field-2" class="block text-sm font-medium leading-none text-foreground">Password</label><div class="space-y-1.5"><input type="password" data-slot="input" class="flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40" id="flow-field-2" aria-describedby="flow-field-2-error" aria-invalid="true"><p id="flow-field-2-error" role="alert" class="text-xs font-medium text-destructive">Must be at least 8 characters.</p></div></div></div>
</div>

### Field usage

```tsx fragment
<Field label="Email" description="We never share it." error={errors.email} required>
  <Input type="email" flow:model="form.email" />
</Field>
```

### Field props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>label</code></td><td><code>node</code></td><td>—</td><td>Associated with the control by a generated id.</td></tr>
  <tr><td><code>description</code></td><td><code>node</code></td><td>—</td><td>Helper text, linked by aria-describedby.</td></tr>
  <tr><td><code>error</code></td><td><code>node</code></td><td>—</td><td>Its presence marks the field invalid and announces it.</td></tr>
  <tr><td><code>required</code></td><td><code>boolean</code></td><td>—</td><td>Shows the marker and sets aria-required.</td></tr>
  <tr><td><code>orientation</code></td><td><code>"vertical" | "horizontal"</code></td><td><code>"vertical"</code></td><td>Label above or beside.</td></tr>
  </tbody>
</table>

<a id="components-input-group"></a>

## InputGroup

Input with affixes or addons.

### InputGroup installation

```sh
bun zt flow:add input-group
```

Or import directly from the package: `import { InputGroup } from "@zerotal/flow-ui";`

### InputGroup preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="w-full max-w-sm space-y-3"><div class="flex w-full items-stretch"><div class="relative flex-1"><span class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-muted-foreground">R</span><div class="[&amp;&gt;input]:w-full [&amp;&gt;input]:pl-8"><input type="text" data-slot="input" class="flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40" placeholder="0.00"></div></div></div><div class="flex w-full items-stretch"><div class="relative flex-1"><div class="[&amp;&gt;input]:w-full [&amp;&gt;input]:rounded-r-none"><input type="text" data-slot="input" class="flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40" value="kln_live_8f3a"></div></div><span class="inline-flex shrink-0 items-center [&amp;&gt;button]:rounded-l-none"><button type="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2">Copy</button></span></div></div>
</div>

### InputGroup usage

```tsx fragment
<InputGroup prefix="R"><Input flow:model="form.price" /></InputGroup>
<InputGroup addonAfter={<Button>Copy</Button>}><Input value={key} /></InputGroup>
```

### InputGroup props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>prefix</code></td><td><code>node</code></td><td>—</td><td>Inside the border, before the text.</td></tr>
  <tr><td><code>suffix</code></td><td><code>node</code></td><td>—</td><td>Inside the border, after the text.</td></tr>
  <tr><td><code>addonBefore</code></td><td><code>node</code></td><td>—</td><td>Outside the border, in its own cell.</td></tr>
  <tr><td><code>addonAfter</code></td><td><code>node</code></td><td>—</td><td>Outside the border — often a button.</td></tr>
  </tbody>
</table>

<a id="components-input-otp"></a>

## InputOTP

One-time-code input.

### InputOTP installation

```sh
bun zt flow:add input-otp
```

Or import directly from the package: `import { InputOTP } from "@zerotal/flow-ui";`

### InputOTP preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div x-data="{ value: '' }" class="relative inline-flex" x-on:click="$refs.field.focus()"><input x-ref="field" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" x-model="value" class="absolute inset-0 z-10 h-full w-full cursor-default opacity-0"><div class="flex items-center gap-2"><div class="flex h-10 w-10 items-center justify-center rounded-md border border-input bg-background text-sm font-medium tabular-nums transition-colors" x-bind:class="value.length === 0 &amp;&amp; 'ring-2 ring-ring border-ring'"><span x-text="value[0] || ''"></span></div><div class="flex h-10 w-10 items-center justify-center rounded-md border border-input bg-background text-sm font-medium tabular-nums transition-colors" x-bind:class="value.length === 1 &amp;&amp; 'ring-2 ring-ring border-ring'"><span x-text="value[1] || ''"></span></div><div class="flex h-10 w-10 items-center justify-center rounded-md border border-input bg-background text-sm font-medium tabular-nums transition-colors" x-bind:class="value.length === 2 &amp;&amp; 'ring-2 ring-ring border-ring'"><span x-text="value[2] || ''"></span></div><span class="w-2"></span><div class="flex h-10 w-10 items-center justify-center rounded-md border border-input bg-background text-sm font-medium tabular-nums transition-colors" x-bind:class="value.length === 3 &amp;&amp; 'ring-2 ring-ring border-ring'"><span x-text="value[3] || ''"></span></div><div class="flex h-10 w-10 items-center justify-center rounded-md border border-input bg-background text-sm font-medium tabular-nums transition-colors" x-bind:class="value.length === 4 &amp;&amp; 'ring-2 ring-ring border-ring'"><span x-text="value[4] || ''"></span></div><div class="flex h-10 w-10 items-center justify-center rounded-md border border-input bg-background text-sm font-medium tabular-nums transition-colors" x-bind:class="value.length === 5 &amp;&amp; 'ring-2 ring-ring border-ring'"><span x-text="value[5] || ''"></span></div></div></div>
</div>

### InputOTP usage

```tsx fragment
<InputOTP length={6} groupAfter={3} flow:model="form.code" />
```

### InputOTP props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>length</code></td><td><code>number</code></td><td><code>6</code></td><td>How many characters the code has.</td></tr>
  <tr><td><code>numeric</code></td><td><code>boolean</code></td><td><code>true</code></td><td>Restrict to digits.</td></tr>
  <tr><td><code>groupAfter</code></td><td><code>number</code></td><td>—</td><td>Insert a wider gap after this many boxes.</td></tr>
  </tbody>
</table>

<a id="components-combobox"></a>

## Combobox

Autocomplete over many options.

### Combobox installation

```sh
bun zt flow:add combobox
```

Or import directly from the package: `import { Combobox } from "@zerotal/flow-ui";`

### Combobox preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="w-full max-w-sm"><div x-data="{ open: false, active: -1, query: '' }" class="flow-combobox relative"><input type="text" role="combobox" autocomplete="off" aria-autocomplete="list" aria-controls="flow-combobox-list" :aria-expanded="open" placeholder="Search brands…" :value="query" x-on:input="onInput($event)" x-on:focus="openList()" x-on:click="openList()" x-on:keydown="onKey($event)" class="flow-combobox-input flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"><ul id="flow-combobox-list" role="listbox" x-show="open" x-cloak x-on:click.outside="close()" :aria-activedescendant="null" class="flow-combobox-options absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"><li role="option" data-value="&quot;1&quot;" data-label="Acme" aria-selected="false" :aria-selected="isSelected(&quot;1&quot;)" :data-selected="isSelected(&quot;1&quot;) ? '' : null" :data-active="active === 0 ? '' : null" x-on:click="selectEl($event.currentTarget)" x-on:mousemove="active = 0" class="flow-combobox-option cursor-pointer rounded-sm px-2 py-1.5 text-sm outline-none data-active:bg-accent data-active:text-accent-foreground data-selected:font-medium data-disabled:pointer-events-none data-disabled:opacity-50" x-show="!query || &quot;acme&quot;.includes(query.toLowerCase())">Acme</li><li role="option" data-value="&quot;2&quot;" data-label="Globex" aria-selected="false" :aria-selected="isSelected(&quot;2&quot;)" :data-selected="isSelected(&quot;2&quot;) ? '' : null" :data-active="active === 1 ? '' : null" x-on:click="selectEl($event.currentTarget)" x-on:mousemove="active = 1" class="flow-combobox-option cursor-pointer rounded-sm px-2 py-1.5 text-sm outline-none data-active:bg-accent data-active:text-accent-foreground data-selected:font-medium data-disabled:pointer-events-none data-disabled:opacity-50" x-show="!query || &quot;globex&quot;.includes(query.toLowerCase())">Globex</li><li role="option" data-value="&quot;3&quot;" data-label="Initech" aria-selected="false" :aria-selected="isSelected(&quot;3&quot;)" :data-selected="isSelected(&quot;3&quot;) ? '' : null" :data-active="active === 2 ? '' : null" x-on:click="selectEl($event.currentTarget)" x-on:mousemove="active = 2" class="flow-combobox-option cursor-pointer rounded-sm px-2 py-1.5 text-sm outline-none data-active:bg-accent data-active:text-accent-foreground data-selected:font-medium data-disabled:pointer-events-none data-disabled:opacity-50" x-show="!query || &quot;initech&quot;.includes(query.toLowerCase())">Initech</li></ul></div></div>
</div>

### Combobox usage

```tsx fragment
<Combobox bind={this.brandId} options={brands} placeholder="Search brands…" />
```

### Combobox props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>bind</code></td><td><code>@expose value</code></td><td>—</td><td>The chosen value.</td></tr>
  <tr><td><code>options</code></td><td><code>ComboboxOption[]</code></td><td>—</td><td>Choices, filtered as you type.</td></tr>
  <tr><td><code>query</code></td><td><code>@expose value</code></td><td>—</td><td>Bind to filter on the server instead of the client.</td></tr>
  </tbody>
</table>

<a id="components-slider"></a>

## Slider

Value chosen from a range.

### Slider installation

```sh
bun zt flow:add slider
```

Or import directly from the package: `import { Slider } from "@zerotal/flow-ui";`

### Slider preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="w-full max-w-sm"><div value="64" x-data="flowSlider({&quot;name&quot;:null,&quot;min&quot;:0,&quot;max&quot;:100,&quot;step&quot;:1})" :data-dragging="dragging ? '' : null" class="flow-slider flex items-center gap-3"><input type="range" min="0" max="100" step="1" value="0" style="background:linear-gradient(to right, var(--primary) 0%, var(--secondary) 0%)" :style="`background:linear-gradient(to right, var(--primary) ${percent()}%, var(--secondary) ${percent()}%)`" x-model.number="value" x-on:input="onInput($event)" x-on:change="commit()" x-on:keyup.debounce.200ms="commit()" class="flow-slider-input h-2 w-full cursor-pointer appearance-none rounded-full outline-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&amp;::-webkit-slider-thumb]:h-4 [&amp;::-webkit-slider-thumb]:w-4 [&amp;::-webkit-slider-thumb]:appearance-none [&amp;::-webkit-slider-thumb]:rounded-full [&amp;::-webkit-slider-thumb]:border-2 [&amp;::-webkit-slider-thumb]:border-primary [&amp;::-webkit-slider-thumb]:bg-background [&amp;::-webkit-slider-thumb]:shadow [&amp;::-webkit-slider-thumb]:transition-transform [&amp;::-webkit-slider-thumb]:hover:scale-110 [&amp;::-moz-range-thumb]:h-4 [&amp;::-moz-range-thumb]:w-4 [&amp;::-moz-range-thumb]:rounded-full [&amp;::-moz-range-thumb]:border-2 [&amp;::-moz-range-thumb]:border-primary [&amp;::-moz-range-thumb]:bg-background [&amp;::-moz-range-thumb]:shadow"><span class="w-14 shrink-0 text-right text-sm tabular-nums text-muted-foreground"><span x-text="value"></span></span></div></div>
</div>

### Slider usage

```tsx fragment
<Slider value={this.volume} max={100} showValue />
```

### Slider props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>value</code></td><td><code>number</code></td><td>—</td><td>Current value.</td></tr>
  <tr><td><code>min</code></td><td><code>number</code></td><td><code>0</code></td><td>Lower bound.</td></tr>
  <tr><td><code>max</code></td><td><code>number</code></td><td><code>100</code></td><td>Upper bound.</td></tr>
  <tr><td><code>showValue</code></td><td><code>boolean</code></td><td>—</td><td>Show the value beside the track.</td></tr>
  </tbody>
</table>

<a id="components-toggle"></a>

## Toggle

Pressed-state button (+ toggle group).

### Toggle installation

```sh
bun zt flow:add toggle
```

Or import directly from the package: `import { Toggle } from "@zerotal/flow-ui";`

### Toggle preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="flex flex-wrap items-center gap-3"><button type="button" aria-pressed="true" class="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 hover:bg-muted hover:text-muted-foreground h-9 px-2.5 bg-accent text-accent-foreground">B</button><button type="button" aria-pressed="false" class="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 hover:bg-muted hover:text-muted-foreground border border-input bg-transparent h-9 px-2.5">I</button><div value="grid" role="radiogroup" x-data="flowToggleGroup({&quot;name&quot;:null,&quot;multiple&quot;:false})" class="flow-toggle-group inline-flex items-center gap-1 rounded-md"><button type="button" aria-pressed="false" :aria-pressed="isOn(&quot;list&quot;)" :data-pressed="isOn(&quot;list&quot;) ? '' : null" x-on:click="toggle(&quot;list&quot;)" class="flow-toggle inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 hover:bg-muted hover:text-muted-foreground border border-input bg-transparent h-9 px-2.5 data-pressed:bg-accent data-pressed:text-accent-foreground">List</button><button type="button" aria-pressed="false" :aria-pressed="isOn(&quot;grid&quot;)" :data-pressed="isOn(&quot;grid&quot;) ? '' : null" x-on:click="toggle(&quot;grid&quot;)" class="flow-toggle inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 hover:bg-muted hover:text-muted-foreground border border-input bg-transparent h-9 px-2.5 data-pressed:bg-accent data-pressed:text-accent-foreground">Grid</button></div></div>
</div>

### Toggle usage

```tsx fragment
<Toggle pressed={this.bold}>B</Toggle>
<ToggleGroup value={this.view} options={[
  { value: "list", label: "List" }, { value: "grid", label: "Grid" },
]} />
```

### Toggle props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>pressed</code></td><td><code>boolean</code></td><td>—</td><td>Whether the toggle is on (sets aria-pressed).</td></tr>
  <tr><td><code>variant</code></td><td><code>"default" | "outline"</code></td><td><code>"default"</code></td><td>Visual style.</td></tr>
  <tr><td><code>options</code></td><td><code>ToggleOption[]</code></td><td>—</td><td>ToggleGroup only — the members.</td></tr>
  <tr><td><code>type</code></td><td><code>"single" | "multiple"</code></td><td><code>"single"</code></td><td>ToggleGroup only — how many may be on.</td></tr>
  </tbody>
</table>

<a id="components-button-group"></a>

## ButtonGroup

Buttons joined into one control.

### ButtonGroup installation

```sh
bun zt flow:add button-group
```

Or import directly from the package: `import { ButtonGroup } from "@zerotal/flow-ui";`

### ButtonGroup preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div role="group" class="inline-flex flex-row [&amp;&gt;*:not(:first-child)]:rounded-l-none [&amp;&gt;*:not(:last-child)]:rounded-r-none [&amp;&gt;*:not(:first-child)]:-ml-px [&amp;&gt;*:focus-visible]:relative [&amp;&gt;*:focus-visible]:z-10"><button type="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2">Day</button><button type="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2">Week</button><button type="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2">Month</button></div>
</div>

### ButtonGroup usage

```tsx fragment
<ButtonGroup>
  <Button variant="outline">Day</Button>
  <Button variant="outline">Week</Button>
</ButtonGroup>
```

### ButtonGroup props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>orientation</code></td><td><code>"horizontal" | "vertical"</code></td><td><code>"horizontal"</code></td><td>Direction the members join in.</td></tr>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Extra classes, merged last (wins over defaults).</td></tr>
  </tbody>
</table>

<a id="components-calendar"></a>

## Calendar

Month grid for picking or laying out dates.

### Calendar installation

```sh
bun zt flow:add calendar
```

Or import directly from the package: `import { Calendar } from "@zerotal/flow-ui";`

### Calendar preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="rounded-lg border border-border bg-card p-3"><div class="mb-2 flex items-center justify-between px-1"><span class="w-7"></span><p class="text-sm font-medium">July 2026</p><span class="w-7"></span></div><div class="grid grid-cols-7 gap-px"><div class="pb-1 text-center text-[11px] font-medium text-muted-foreground">Mon</div><div class="pb-1 text-center text-[11px] font-medium text-muted-foreground">Tue</div><div class="pb-1 text-center text-[11px] font-medium text-muted-foreground">Wed</div><div class="pb-1 text-center text-[11px] font-medium text-muted-foreground">Thu</div><div class="pb-1 text-center text-[11px] font-medium text-muted-foreground">Fri</div><div class="pb-1 text-center text-[11px] font-medium text-muted-foreground">Sat</div><div class="pb-1 text-center text-[11px] font-medium text-muted-foreground">Sun</div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">29</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">30</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">1</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">2</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">3</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">4</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">5</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">6</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">7</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">8</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">9</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">10</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">11</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">12</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">13</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors bg-primary text-primary-foreground"><span class="">14</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">15</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">16</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">17</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">18</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">19</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">20</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">21</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">22</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">23</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">24</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">25</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">26</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">27</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">28</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">29</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">30</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">31</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">1</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">2</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">3</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">4</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">5</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">6</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">7</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">8</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">9</span></div></div></div>
</div>

### Calendar usage

```tsx fragment
<Calendar value={this.due} onSelect={this.pick} />
<Calendar month="2026-07" events={[{ date: "2026-07-14", label: "Launch" }]} />
```

### Calendar props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>month</code></td><td><code>string</code></td><td>—</td><td>`YYYY-MM` to display.</td></tr>
  <tr><td><code>value</code></td><td><code>string</code></td><td>—</td><td>Selected `YYYY-MM-DD`.</td></tr>
  <tr><td><code>onSelect</code></td><td><code>handler</code></td><td>—</td><td>Receives the clicked `YYYY-MM-DD`.</td></tr>
  <tr><td><code>events</code></td><td><code>CalendarEvent[]</code></td><td>—</td><td>Records to lay out across the month.</td></tr>
  <tr><td><code>min / max</code></td><td><code>string</code></td><td>—</td><td>Selectable range.</td></tr>
  </tbody>
</table>

<a id="components-date-picker"></a>

## DatePicker

Calendar in a popover.

### DatePicker installation

```sh
bun zt flow:add date-picker
```

Or import directly from the package: `import { DatePicker } from "@zerotal/flow-ui";`

### DatePicker preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="w-56"><div x-data="{ open: false }" class="flow-popover relative inline-block"><span x-on:click="open = !open" :aria-expanded="open" :data-open="open ? '' : null" role="button" tabindex="0" class="flow-popover-button cursor-pointer outline-none"><span class="inline-flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"><svg class="h-4 w-4 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path></svg><span>14 Jul 2026</span></span></span><div x-show="open" x-cloak x-transition x-on:click.outside="open = false" x-on:keydown.escape.window="open = false" :data-open="open ? '' : null" class="flow-popover-panel absolute top-full mt-2 left-0 z-50 min-w-[8rem] rounded-md border border-border bg-popover text-popover-foreground shadow-md outline-none p-0"><div class="rounded-lg border-border bg-card p-3 border-0"><div class="mb-2 flex items-center justify-between px-1"><span class="w-7"></span><p class="text-sm font-medium">July 2026</p><span class="w-7"></span></div><div class="grid grid-cols-7 gap-px"><div class="pb-1 text-center text-[11px] font-medium text-muted-foreground">Mon</div><div class="pb-1 text-center text-[11px] font-medium text-muted-foreground">Tue</div><div class="pb-1 text-center text-[11px] font-medium text-muted-foreground">Wed</div><div class="pb-1 text-center text-[11px] font-medium text-muted-foreground">Thu</div><div class="pb-1 text-center text-[11px] font-medium text-muted-foreground">Fri</div><div class="pb-1 text-center text-[11px] font-medium text-muted-foreground">Sat</div><div class="pb-1 text-center text-[11px] font-medium text-muted-foreground">Sun</div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">29</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">30</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">1</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">2</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">3</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">4</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">5</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">6</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">7</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">8</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">9</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">10</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">11</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">12</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">13</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors bg-primary text-primary-foreground"><span class="">14</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">15</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">16</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">17</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">18</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">19</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">20</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">21</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">22</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">23</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">24</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">25</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">26</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">27</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">28</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">29</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">30</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors"><span class="">31</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">1</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">2</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">3</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">4</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">5</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">6</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">7</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">8</span></div><div class="h-9 items-center justify-center flex flex-col rounded-md text-sm transition-colors text-muted-foreground/40"><span class="">9</span></div></div></div></div></div></div>
</div>

### DatePicker usage

```tsx fragment
<DatePicker value={this.due} onSelect={this.setDue} />
```

### DatePicker props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>value</code></td><td><code>string</code></td><td>—</td><td>Selected `YYYY-MM-DD`.</td></tr>
  <tr><td><code>onSelect</code></td><td><code>handler</code></td><td>—</td><td>Receives the clicked `YYYY-MM-DD`.</td></tr>
  <tr><td><code>placeholder</code></td><td><code>string</code></td><td><code>"Pick a date"</code></td><td>Shown when nothing is chosen.</td></tr>
  <tr><td><code>min / max</code></td><td><code>string</code></td><td>—</td><td>Selectable range.</td></tr>
  </tbody>
</table>

<a id="components-toast"></a>

## Toaster

Host for transient flash messages.

### Toaster installation

```sh
bun zt flow:add toast
```

Or import directly from the package: `import { Toaster } from "@zerotal/flow-ui";`

### Toaster preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<p class="text-sm text-muted-foreground">Mounted once per layout; every <code class="font-mono text-xs">page.flash()</code> lands in it.</p>
</div>

### Toaster usage

```tsx fragment
<Toaster position="bottom-right" />;
// then anywhere on the server:
page.flash("Saved.", "success");
```

### Toaster props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>position</code></td><td><code>"top-right" | "bottom-right" | …</code></td><td><code>"bottom-right"</code></td><td>Corner it stacks in.</td></tr>
  <tr><td><code>duration</code></td><td><code>number</code></td><td><code>4000</code></td><td>How long a toast stays, in ms.</td></tr>
  <tr><td><code>max</code></td><td><code>number</code></td><td><code>4</code></td><td>Most on screen at once.</td></tr>
  </tbody>
</table>

<a id="components-progress"></a>

## Progress

Determinate progress bar.

### Progress installation

```sh
bun zt flow:add progress
```

Or import directly from the package: `import { Progress } from "@zerotal/flow-ui";`

### Progress preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="w-full max-w-sm space-y-3"><div class="flex items-center gap-3"><div role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="62" class="relative h-2 w-full overflow-hidden rounded-full bg-secondary"><div class="h-full rounded-full bg-primary transition-[width] duration-300 ease-out" style="width:62%"></div></div><span class="shrink-0 text-xs tabular-nums text-muted-foreground">62%</span></div><div class="flex items-center gap-3"><div role="progressbar" aria-valuemin="0" aria-valuemax="100" class="relative h-2 w-full overflow-hidden rounded-full bg-secondary"><div class="h-full rounded-full bg-primary transition-[width] duration-300 ease-out w-1/3 animate-[flow-progress_1.2s_ease-in-out_infinite]"></div></div></div></div>
</div>

### Progress usage

```tsx fragment
<Progress value={imported} max={total} showValue />
<Progress />  {/* indeterminate */}
```

### Progress props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>value</code></td><td><code>number</code></td><td>—</td><td>Completed amount. Omit for the indeterminate bar.</td></tr>
  <tr><td><code>max</code></td><td><code>number</code></td><td><code>100</code></td><td>The total.</td></tr>
  <tr><td><code>showValue</code></td><td><code>boolean</code></td><td>—</td><td>Show the percentage beside the bar.</td></tr>
  <tr><td><code>label</code></td><td><code>string</code></td><td>—</td><td>Describes what is progressing, for screen readers.</td></tr>
  </tbody>
</table>

<a id="components-spinner"></a>

## Spinner

Indeterminate loading indicator.

### Spinner installation

```sh
bun zt flow:add spinner
```

Or import directly from the package: `import { Spinner } from "@zerotal/flow-ui";`

### Spinner preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="flex flex-wrap items-center gap-3"><span role="status" class="inline-flex items-center"><svg class="animate-spin text-current h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.2"></circle><path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"></path></svg><span class="sr-only">Loading</span></span><span role="status" class="inline-flex items-center"><svg class="animate-spin text-current h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.2"></circle><path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"></path></svg><span class="sr-only">Loading</span></span><span role="status" class="inline-flex items-center"><svg class="animate-spin text-current h-8 w-8" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.2"></circle><path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"></path></svg><span class="sr-only">Loading</span></span></div>
</div>

### Spinner usage

```tsx fragment
<Spinner />
<Button disabled><Spinner size="sm" /> Saving…</Button>
```

### Spinner props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>size</code></td><td><code>"sm" | "default" | "lg"</code></td><td><code>"default"</code></td><td>Sizing.</td></tr>
  <tr><td><code>label</code></td><td><code>string | null</code></td><td><code>"Loading"</code></td><td>Announced to screen readers.</td></tr>
  </tbody>
</table>

<a id="components-empty"></a>

## Empty

Empty-state block with an action.

### Empty installation

```sh
bun zt flow:add empty
```

Or import directly from the package: `import { Empty } from "@zerotal/flow-ui";`

### Empty preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="flex flex-col items-center justify-center px-6 py-12 text-center rounded-lg border border-dashed border-border"><p class="text-sm font-medium text-foreground">No orders yet</p><p class="mt-1 max-w-sm text-sm text-muted-foreground">Orders appear here as customers place them.</p><div class="mt-4 flex items-center gap-2"><button type="button" class="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-8 rounded-md px-3 text-xs">New order</button></div></div>
</div>

### Empty usage

```tsx fragment
<Empty
  icon={icon}
  title="No orders yet"
  description="Orders appear here as customers place them."
  action={<Button>New order</Button>}
/>
```

### Empty props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>title</code></td><td><code>node</code></td><td>—</td><td>What is missing.</td></tr>
  <tr><td><code>description</code></td><td><code>node</code></td><td>—</td><td>Why, or what to do about it.</td></tr>
  <tr><td><code>action</code></td><td><code>node</code></td><td>—</td><td>The next step — usually a button.</td></tr>
  <tr><td><code>bare</code></td><td><code>boolean</code></td><td>—</td><td>Drop the dashed border, inside a card that draws its own.</td></tr>
  </tbody>
</table>

<a id="components-kbd"></a>

## Kbd

Keyboard key (+ platform modifier).

### Kbd installation

```sh
bun zt flow:add kbd
```

Or import directly from the package: `import { Kbd } from "@zerotal/flow-ui";`

### Kbd preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="flex flex-wrap items-center gap-3"><span class="inline-flex items-center gap-1"><kbd class="pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground" x-data="{ mac: false }" x-init="mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)" x-text="mac ? '⌘' : 'Ctrl'">Ctrl</kbd><kbd class="pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">K</kbd></span><span class="inline-flex items-center gap-1"><kbd class="pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">⇧</kbd><kbd class="pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">↵</kbd></span></div>
</div>

### Kbd usage

```tsx fragment
<KbdMod /> <Kbd>K</Kbd>
```

### Kbd props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>children</code></td><td><code>node</code></td><td>—</td><td>The key. `&lt;KbdMod /&gt;` renders ⌘ or Ctrl per platform.</td></tr>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Extra classes, merged last (wins over defaults).</td></tr>
  </tbody>
</table>

<a id="components-accordion"></a>

## Accordion

Stacked collapsible sections.

### Accordion installation

```sh
bun zt flow:add accordion
```

Or import directly from the package: `import { Accordion } from "@zerotal/flow-ui";`

### Accordion preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="w-full max-w-md"><div x-data="{ active: 0 }" class="flow-accordion divide-y divide-border border-y border-border"><div class="flow-accordion-item" x-id="['flow-accordion']"><button type="button" x-on:click="active = active === 0 ? -1 : 0" :aria-expanded="active === 0" :data-open="active === 0 ? '' : null" :aria-controls="$id('flow-accordion')" class="flow-accordion-button flex w-full items-center justify-between gap-4 py-4 text-left text-sm font-medium transition-colors hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring [&amp;[data-open]&gt;svg]:rotate-180">Shipping</button><div :id="$id('flow-accordion')" x-show="active === 0" x-cloak :data-open="active === 0 ? '' : null" class="flow-accordion-panel pb-4 text-sm text-muted-foreground"><p>Ships in 2–3 days.</p></div></div><div class="flow-accordion-item" x-id="['flow-accordion']"><button type="button" x-on:click="active = active === 1 ? -1 : 1" :aria-expanded="active === 1" :data-open="active === 1 ? '' : null" :aria-controls="$id('flow-accordion')" class="flow-accordion-button flex w-full items-center justify-between gap-4 py-4 text-left text-sm font-medium transition-colors hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring [&amp;[data-open]&gt;svg]:rotate-180">Returns</button><div :id="$id('flow-accordion')" x-show="active === 1" x-cloak :data-open="active === 1 ? '' : null" class="flow-accordion-panel pb-4 text-sm text-muted-foreground"><p>30 days, no questions.</p></div></div></div></div>
</div>

### Accordion usage

```tsx fragment
<Accordion
  items={[
    { label: "Shipping", content: <p>Ships in 2–3 days.</p> },
    { label: "Returns", content: <p>30 days, no questions.</p> },
  ]}
/>
```

### Accordion props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>items</code></td><td><code>AccordionItem[]</code></td><td>—</td><td>Each with a label and its content.</td></tr>
  <tr><td><code>multiple</code></td><td><code>boolean</code></td><td>—</td><td>Allow several open at once.</td></tr>
  <tr><td><code>defaultIndex</code></td><td><code>number</code></td><td><code>-1</code></td><td>Which starts open.</td></tr>
  </tbody>
</table>

<a id="components-collapsible"></a>

## Collapsible

One section that opens and closes.

### Collapsible installation

```sh
bun zt flow:add collapsible
```

Or import directly from the package: `import { Collapsible } from "@zerotal/flow-ui";`

### Collapsible preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="w-full max-w-md"><div x-data="{ open: false }" x-id="['flow-disclosure']" class="flow-disclosure"><button type="button" x-on:click="open = !open" :aria-expanded="open" :data-open="open ? '' : null" :aria-controls="$id('flow-disclosure')" class="flow-disclosure-button inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-foreground transition-colors hover:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&amp;[data-open]&gt;svg]:rotate-180">Advanced</button><div :id="$id('flow-disclosure')" x-show="open" x-cloak :data-open="open ? '' : null" class="flow-disclosure-panel pt-2"><p class="text-sm text-muted-foreground">Rarely-changed settings live here.</p></div></div></div>
</div>

### Collapsible usage

```tsx fragment
<Collapsible label="Advanced">
  <Field label="Timeout">
    <Input />
  </Field>
</Collapsible>
```

### Collapsible props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>label</code></td><td><code>node</code></td><td>—</td><td>Text for the default trigger.</td></tr>
  <tr><td><code>trigger</code></td><td><code>node</code></td><td>—</td><td>A custom trigger instead.</td></tr>
  <tr><td><code>defaultOpen</code></td><td><code>boolean</code></td><td>—</td><td>Start open.</td></tr>
  </tbody>
</table>

<a id="components-scroll-area"></a>

## ScrollArea

Scrollable region with a styled bar.

### ScrollArea installation

```sh
bun zt flow:add scroll-area
```

Or import directly from the package: `import { ScrollArea } from "@zerotal/flow-ui";`

### ScrollArea preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="relative overflow-y-auto overflow-x-hidden [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&amp;::-webkit-scrollbar]:h-2 [&amp;::-webkit-scrollbar]:w-2 [&amp;::-webkit-scrollbar-track]:bg-transparent [&amp;::-webkit-scrollbar-thumb]:rounded-full [&amp;::-webkit-scrollbar-thumb]:bg-border [&amp;::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/40 h-32 w-full max-w-sm rounded-md border border-border p-3"><div class="space-y-2 text-sm"><p>Row 1</p><p>Row 2</p><p>Row 3</p><p>Row 4</p><p>Row 5</p><p>Row 6</p><p>Row 7</p><p>Row 8</p><p>Row 9</p><p>Row 10</p><p>Row 11</p><p>Row 12</p></div></div>
</div>

### ScrollArea usage

```tsx fragment
<ScrollArea class="h-72">…long list…</ScrollArea>
```

### ScrollArea props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>orientation</code></td><td><code>"vertical" | "horizontal" | "both"</code></td><td><code>"vertical"</code></td><td>Which way it scrolls.</td></tr>
  <tr><td><code>fade</code></td><td><code>boolean</code></td><td>—</td><td>Fade the content at the scrollable edges.</td></tr>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Extra classes, merged last (wins over defaults).</td></tr>
  </tbody>
</table>

<a id="components-resizable"></a>

## Resizable

Two panes with a draggable handle.

### Resizable installation

```sh
bun zt flow:add resizable
```

Or import directly from the package: `import { Resizable } from "@zerotal/flow-ui";`

### Resizable preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div x-data="{ size: 35, dragging: false, start(e) { this.dragging = true; e.target.setPointerCapture(e.pointerId); }, move(e) { if (!this.dragging) return; const box = $el.getBoundingClientRect(); const raw = ((e.clientX - box.left) / box.width) * 100; this.size = Math.min(90, Math.max(10, raw)); }, stop(e) { this.dragging = false; if (e.pointerId != null) e.target.releasePointerCapture?.(e.pointerId); }, nudge(by) { this.size = Math.min(90, Math.max(10, this.size + by)); } }" x-on:pointermove="move($event)" x-on:pointerup="stop($event)" class="flex w-full flex-row h-32 rounded-md border border-border"><div x-bind:style="`flex-basis:${size}%`" class="min-w-0 overflow-hidden"><div class="h-full bg-muted/40 p-3 text-sm">Sidebar</div></div><div role="separator" tabindex="0" aria-orientation="vertical" x-bind:aria-valuenow="Math.round(size)" aria-valuemin="10" aria-valuemax="90" aria-label="Resize panes" x-on:pointerdown="start($event)" x-on:keydown="if ($event.key === 'ArrowLeft') { $event.preventDefault(); nudge(-2) } if ($event.key === 'ArrowRight') { $event.preventDefault(); nudge(2) }" x-bind:class="dragging &amp;&amp; 'bg-primary'" class="group relative shrink-0 bg-border transition-colors hover:bg-primary/50 outline-none focus-visible:bg-primary w-px cursor-col-resize"><span class="absolute -inset-x-1.5 inset-y-0"></span></div><div class="min-w-0 flex-1 overflow-hidden"><div class="h-full p-3 text-sm">Content</div></div></div>
</div>

### Resizable usage

```tsx fragment
<Resizable start={<Tree />} end={<Editor />} defaultSize={30} />
```

### Resizable props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>start / end</code></td><td><code>node</code></td><td>—</td><td>The two panes.</td></tr>
  <tr><td><code>defaultSize</code></td><td><code>number</code></td><td><code>50</code></td><td>First pane's starting size, as a percentage.</td></tr>
  <tr><td><code>min</code></td><td><code>number</code></td><td><code>10</code></td><td>Smallest either pane may become.</td></tr>
  <tr><td><code>orientation</code></td><td><code>"horizontal" | "vertical"</code></td><td><code>"horizontal"</code></td><td>Split direction.</td></tr>
  </tbody>
</table>

<a id="components-carousel"></a>

## Carousel

Snap-scrolling strip with controls.

### Carousel installation

```sh
bun zt flow:add carousel
```

Or import directly from the package: `import { Carousel } from "@zerotal/flow-ui";`

### Carousel preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div x-data="{ atStart: true, atEnd: false, sync() { const el = $refs.track; this.atStart = el.scrollLeft &lt;= 1; this.atEnd = el.scrollLeft + el.clientWidth &gt;= el.scrollWidth - 1; }, page(dir) { $refs.track.scrollBy({ left: dir * $refs.track.clientWidth * 0.9, behavior: 'smooth' }); } }" x-init="sync()" role="region" aria-roledescription="carousel" aria-label="Carousel" class="relative"><div x-ref="track" x-on:scroll.debounce.50ms="sync()" class="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&amp;::-webkit-scrollbar]:hidden"><div class="shrink-0 snap-start w-40"><div class="flex h-24 items-center justify-center rounded-lg border border-border bg-muted/40 text-sm">Slide 1</div></div><div class="shrink-0 snap-start w-40"><div class="flex h-24 items-center justify-center rounded-lg border border-border bg-muted/40 text-sm">Slide 2</div></div><div class="shrink-0 snap-start w-40"><div class="flex h-24 items-center justify-center rounded-lg border border-border bg-muted/40 text-sm">Slide 3</div></div><div class="shrink-0 snap-start w-40"><div class="flex h-24 items-center justify-center rounded-lg border border-border bg-muted/40 text-sm">Slide 4</div></div><div class="shrink-0 snap-start w-40"><div class="flex h-24 items-center justify-center rounded-lg border border-border bg-muted/40 text-sm">Slide 5</div></div><div class="shrink-0 snap-start w-40"><div class="flex h-24 items-center justify-center rounded-lg border border-border bg-muted/40 text-sm">Slide 6</div></div></div><button type="button" aria-label="Previous" x-on:click="page(-1)" x-bind:disabled="atStart" class="absolute top-1/2 z-10 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background shadow-sm transition-opacity hover:bg-accent disabled:pointer-events-none disabled:opacity-0 left-0 -translate-x-1/2"><svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg></button><button type="button" aria-label="Next" x-on:click="page(1)" x-bind:disabled="atEnd" class="absolute top-1/2 z-10 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background shadow-sm transition-opacity hover:bg-accent disabled:pointer-events-none disabled:opacity-0 right-0 translate-x-1/2"><svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg></button></div>
</div>

### Carousel usage

```tsx fragment
<Carousel
  items={products.map((p) => (
    <ProductCard product={p} />
  ))}
/>
```

### Carousel props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>items</code></td><td><code>node[]</code></td><td>—</td><td>The slides.</td></tr>
  <tr><td><code>itemClass</code></td><td><code>string</code></td><td><code>"w-64 sm:w-72"</code></td><td>Width of each slide.</td></tr>
  <tr><td><code>hideControls</code></td><td><code>boolean</code></td><td>—</td><td>Swipe and scroll only.</td></tr>
  </tbody>
</table>

<a id="components-aspect-ratio"></a>

## AspectRatio

Fixed width-to-height box.

### AspectRatio installation

```sh
bun zt flow:add aspect-ratio
```

Or import directly from the package: `import { AspectRatio } from "@zerotal/flow-ui";`

### AspectRatio preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="w-64"><div style="aspect-ratio:1.7777777777777777" class="relative w-full overflow-hidden rounded-lg border border-border bg-muted/40"><div class="flex h-full items-center justify-center text-sm text-muted-foreground">16 / 9</div></div></div>
</div>

### AspectRatio usage

```tsx fragment
<AspectRatio ratio={16 / 9}>
  <img src={cover} class="h-full w-full object-cover" />
</AspectRatio>
```

### AspectRatio props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>ratio</code></td><td><code>number</code></td><td><code>1</code></td><td>Width ÷ height.</td></tr>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Extra classes, merged last (wins over defaults).</td></tr>
  </tbody>
</table>

<a id="components-item"></a>

## Item

Icon + title + description + action row.

### Item installation

```sh
bun zt flow:add item
```

Or import directly from the package: `import { Item } from "@zerotal/flow-ui";`

### Item preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="w-full max-w-md rounded-lg border border-border p-1"><div class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left"><span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">Team</span><span class="block truncate text-xs text-muted-foreground">4 members</span></span><span class="flex shrink-0 items-center gap-2"><span class="inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80">Owner</span></span></div><div class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground"><span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">Billing</span><span class="block truncate text-xs text-muted-foreground">Visa ending 4242</span></span></div></div>
</div>

### Item usage

```tsx fragment
<Item title="Team" description="4 members" action={<Button size="sm">Manage</Button>} />
```

### Item props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>title</code></td><td><code>node</code></td><td>—</td><td>The primary line.</td></tr>
  <tr><td><code>description</code></td><td><code>node</code></td><td>—</td><td>The supporting line.</td></tr>
  <tr><td><code>action</code></td><td><code>node</code></td><td>—</td><td>Trailing content.</td></tr>
  <tr><td><code>href</code></td><td><code>string</code></td><td>—</td><td>Makes the whole row a link.</td></tr>
  </tbody>
</table>

<a id="components-chart"></a>

## Chart

SVG line, area, bar and donut charts.

### Chart installation

```sh
bun zt flow:add chart
```

Or import directly from the package: `import { Chart } from "@zerotal/flow-ui";`

### Chart preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="w-full space-y-6"><figure class="relative w-full" x-data="flowChart({&quot;points&quot;:[{&quot;x&quot;:0.07333333333333333,&quot;label&quot;:&quot;Mon&quot;,&quot;values&quot;:[{&quot;label&quot;:&quot;Orders&quot;,&quot;value&quot;:&quot;12&quot;,&quot;color&quot;:&quot;var(--primary)&quot;}]},{&quot;x&quot;:0.2277777777777778,&quot;label&quot;:&quot;Tue&quot;,&quot;values&quot;:[{&quot;label&quot;:&quot;Orders&quot;,&quot;value&quot;:&quot;19&quot;,&quot;color&quot;:&quot;var(--primary)&quot;}]},{&quot;x&quot;:0.38222222222222224,&quot;label&quot;:&quot;Wed&quot;,&quot;values&quot;:[{&quot;label&quot;:&quot;Orders&quot;,&quot;value&quot;:&quot;14&quot;,&quot;color&quot;:&quot;var(--primary)&quot;}]},{&quot;x&quot;:0.5366666666666666,&quot;label&quot;:&quot;Thu&quot;,&quot;values&quot;:[{&quot;label&quot;:&quot;Orders&quot;,&quot;value&quot;:&quot;27&quot;,&quot;color&quot;:&quot;var(--primary)&quot;}]},{&quot;x&quot;:0.6911111111111111,&quot;label&quot;:&quot;Fri&quot;,&quot;values&quot;:[{&quot;label&quot;:&quot;Orders&quot;,&quot;value&quot;:&quot;22&quot;,&quot;color&quot;:&quot;var(--primary)&quot;}]},{&quot;x&quot;:0.8455555555555556,&quot;label&quot;:&quot;Sat&quot;,&quot;values&quot;:[{&quot;label&quot;:&quot;Orders&quot;,&quot;value&quot;:&quot;31&quot;,&quot;color&quot;:&quot;var(--primary)&quot;}]},{&quot;x&quot;:1,&quot;label&quot;:&quot;Sun&quot;,&quot;values&quot;:[{&quot;label&quot;:&quot;Orders&quot;,&quot;value&quot;:&quot;25&quot;,&quot;color&quot;:&quot;var(--primary)&quot;}]}]})" x-on:pointermove="onMove($event)" x-on:pointerleave="onLeave()"><svg viewBox="0 0 600 160" width="100%" height="160" preserveAspectRatio="none" role="img" aria-label="Orders: 12, 19, 14, 27, 22, 31, 25" class="overflow-visible"><line x1="44" y1="138" x2="600" y2="138" stroke="var(--border)" stroke-width="1"></line><text x="36" y="142" text-anchor="end" font-size="11" fill="var(--muted-foreground)">0</text><line x1="44" y1="103.5" x2="600" y2="103.5" stroke="var(--border)" stroke-width="1"></line><text x="36" y="107.5" text-anchor="end" font-size="11" fill="var(--muted-foreground)">13</text><line x1="44" y1="69" x2="600" y2="69" stroke="var(--border)" stroke-width="1"></line><text x="36" y="73" text-anchor="end" font-size="11" fill="var(--muted-foreground)">25</text><line x1="44" y1="34.5" x2="600" y2="34.5" stroke="var(--border)" stroke-width="1"></line><text x="36" y="38.5" text-anchor="end" font-size="11" fill="var(--muted-foreground)">38</text><line x1="44" y1="0" x2="600" y2="0" stroke="var(--border)" stroke-width="1"></line><text x="36" y="4" text-anchor="end" font-size="11" fill="var(--muted-foreground)">50</text><g transform="translate(44,0)"><path d="M0.00,104.88 L92.67,85.56 L185.33,99.36 L278.00,63.48 L370.67,77.28 L463.33,52.44 L556.00,69.00 L556,138 L0,138 Z" fill="var(--primary)" opacity="0.12"></path><path d="M0.00,104.88 L92.67,85.56 L185.33,99.36 L278.00,63.48 L370.67,77.28 L463.33,52.44 L556.00,69.00" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" x-bind:style="`stroke-dasharray:2000;stroke-dashoffset:${ready ? 0 : 2000};transition:stroke-dashoffset .7s ease-out`"></path></g><text x="44" y="154" text-anchor="middle" font-size="11" fill="var(--muted-foreground)">Mon</text><text x="136.66666666666669" y="154" text-anchor="middle" font-size="11" fill="var(--muted-foreground)">Tue</text><text x="229.33333333333334" y="154" text-anchor="middle" font-size="11" fill="var(--muted-foreground)">Wed</text><text x="322" y="154" text-anchor="middle" font-size="11" fill="var(--muted-foreground)">Thu</text><text x="414.6666666666667" y="154" text-anchor="middle" font-size="11" fill="var(--muted-foreground)">Fri</text><text x="507.33333333333337" y="154" text-anchor="middle" font-size="11" fill="var(--muted-foreground)">Sat</text><text x="600" y="154" text-anchor="middle" font-size="11" fill="var(--muted-foreground)">Sun</text></svg><div x-show="hover &gt;= 0" x-cloak class="pointer-events-none absolute inset-y-0 w-px bg-border" x-bind:style="`left:${tipX}px`"></div><div x-show="hover &gt;= 0" x-cloak x-transition.opacity class="pointer-events-none absolute top-2 z-10 min-w-32 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-md" x-bind:style="`left:${tipX}px`"><p class="mb-1 font-medium" x-text="tip()?.label"></p><template x-for="row in (tip()?.values ?? [])" :key="row.label"><span class="flex items-center gap-1.5"><span class="h-2 w-2 shrink-0 rounded-sm" x-bind:style="`background:${row.color}`"></span><span class="text-muted-foreground" x-text="row.label"></span><span class="ml-auto font-medium tabular-nums" x-text="row.value"></span></span></template></div></figure><figure class="flex items-center gap-6"><svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="Series: 82, 24, 6"><path d="M70,2 A68,68 0 1 1 2.4275697272595096,77.61358437502494 L28.1050932309009,74.72042231251547 A42.16,42.16 0 1 0 70,27.840000000000003 Z" fill="var(--primary)"></path><path d="M2.4275697272595096,77.61358437502494 A68,68 0 0 1 47.54102378704863,5.815933539031008 L56.07543474797015,30.20587879419923 A42.16,42.16 0 0 0 28.1050932309009,74.72042231251547 Z" fill="var(--flow-toast-success, #16a34a)"></path><path d="M47.54102378704863,5.815933539031008 A68,68 0 0 1 69.99999999999999,2 L69.99999999999999,27.840000000000003 A42.16,42.16 0 0 0 56.07543474797015,30.20587879419923 Z" fill="var(--flow-toast-warning, #d97706)"></path></svg><figcaption class="space-y-1.5 text-sm"><span class="flex items-center gap-2"><span class="h-2.5 w-2.5 shrink-0 rounded-sm" style="background:var(--primary)"></span><span class="text-muted-foreground">Paid</span><span class="ml-auto font-medium tabular-nums">82</span></span><span class="flex items-center gap-2"><span class="h-2.5 w-2.5 shrink-0 rounded-sm" style="background:var(--flow-toast-success, #16a34a)"></span><span class="text-muted-foreground">Pending</span><span class="ml-auto font-medium tabular-nums">24</span></span><span class="flex items-center gap-2"><span class="h-2.5 w-2.5 shrink-0 rounded-sm" style="background:var(--flow-toast-warning, #d97706)"></span><span class="text-muted-foreground">Refunded</span><span class="ml-auto font-medium tabular-nums">6</span></span></figcaption></figure></div>
</div>

### Chart usage

```tsx fragment
<Chart type="line" labels={days} datasets={[{ label: "Orders", data: counts }]} />
<Chart type="donut" labels={["Paid","Pending"]} datasets={[{ data: [82, 18] }]} />
```

### Chart props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>type</code></td><td><code>"line" | "area" | "bar" | "donut"</code></td><td><code>"line"</code></td><td>Chart kind.</td></tr>
  <tr><td><code>labels</code></td><td><code>string[]</code></td><td>—</td><td>Axis or legend labels.</td></tr>
  <tr><td><code>datasets</code></td><td><code>ChartDataset[]</code></td><td>—</td><td>One or more series.</td></tr>
  <tr><td><code>height</code></td><td><code>number</code></td><td><code>220</code></td><td>Drawing height; width is fluid.</td></tr>
  <tr><td><code>format</code></td><td><code>(n: number) =&gt; string</code></td><td>—</td><td>Formats axis values and the accessible summary.</td></tr>
  </tbody>
</table>

<a id="components-typography"></a>

## Prose

Prose wrapper + heading helpers.

### Prose installation

```sh
bun zt flow:add typography
```

Or import directly from the package: `import { Prose } from "@zerotal/flow-ui";`

### Prose preview

<div class="not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10">
<div class="text-foreground [&amp;_h1]:mt-8 [&amp;_h1]:scroll-m-20 [&amp;_h1]:text-3xl [&amp;_h1]:font-semibold [&amp;_h1]:tracking-tight [&amp;_h2]:mt-8 [&amp;_h2]:scroll-m-20 [&amp;_h2]:border-b [&amp;_h2]:border-border [&amp;_h2]:pb-2 [&amp;_h2]:text-2xl [&amp;_h2]:font-semibold [&amp;_h3]:mt-6 [&amp;_h3]:scroll-m-20 [&amp;_h3]:text-xl [&amp;_h3]:font-semibold [&amp;_p]:leading-7 [&amp;_p:not(:first-child)]:mt-4 [&amp;_a]:font-medium [&amp;_a]:text-primary [&amp;_a]:underline [&amp;_a]:underline-offset-4 [&amp;_ul]:my-4 [&amp;_ul]:ml-6 [&amp;_ul]:list-disc [&amp;_ol]:my-4 [&amp;_ol]:ml-6 [&amp;_ol]:list-decimal [&amp;_li]:mt-2 [&amp;_blockquote]:mt-4 [&amp;_blockquote]:border-l-2 [&amp;_blockquote]:border-border [&amp;_blockquote]:pl-4 [&amp;_blockquote]:italic [&amp;_code]:rounded [&amp;_code]:bg-muted [&amp;_code]:px-[0.3rem] [&amp;_code]:py-[0.2rem] [&amp;_code]:font-mono [&amp;_code]:text-sm [&amp;_pre]:mt-4 [&amp;_pre]:overflow-x-auto [&amp;_pre]:rounded-lg [&amp;_pre]:border [&amp;_pre]:border-border [&amp;_pre]:bg-muted [&amp;_pre]:p-4 [&amp;_pre_code]:bg-transparent [&amp;_pre_code]:p-0 [&amp;_hr]:my-8 [&amp;_hr]:border-border [&amp;_table]:w-full [&amp;_table]:text-sm [&amp;_th]:border-b [&amp;_th]:border-border [&amp;_th]:px-3 [&amp;_th]:py-2 [&amp;_th]:text-left [&amp;_td]:border-b [&amp;_td]:border-border [&amp;_td]:px-3 [&amp;_td]:py-2 [&amp;_img]:rounded-lg max-w-md"><h2>A rendered document</h2><p>Prose styles its descendants, for content that arrives as a blob — Markdown, a CMS field, a rich-text column.</p><ul><li>Headings, lists and quotes</li><li>Inline <code>code</code> and code blocks</li></ul></div>
</div>

### Prose usage

```tsx fragment
<Prose dangerouslySetInnerHTML={{ __html: rendered }} />
<H1>Page title</H1>
<Muted>Last updated yesterday</Muted>
```

### Prose props

<table>
  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
  <tr><td><code>children</code></td><td><code>node</code></td><td>—</td><td>Markup you did not author — Prose styles its descendants.</td></tr>
  <tr><td><code>class</code></td><td><code>string</code></td><td>—</td><td>Extra classes, merged last (wins over defaults).</td></tr>
  </tbody>
</table>

<!-- END GENERATED COMPONENTS -->

## Testing

Set your suite up once as described in [Testing](/docs/testing). A `flow-ui`
component is a plain function returning a node, so it tests like any other
[view](/docs/view#testing) — render it and assert on the string.

```typescript
// tests/components/Button.test.ts
import { test, expect } from "bun:test";
import { Button } from "@zerotal/flow-ui";

test("renders the variant's classes", () => {
  const html = String(Button({ variant: "destructive", children: "Delete" }));

  expect(html).toContain("Delete");
  expect(html).toContain("destructive");
});
```

**Test your own components, not the library's.** The twenty components ship with
their own suite; a test asserting that `Button` renders a `<button>` re-tests
someone else's work and breaks when they restyle. What earns a test is the
component _you_ composed from them, and the props you pass it.

**Copy-in components are yours the moment you run `flow:add`.** Once the source
lives in your repo, it is application code — it changes when you edit it, and
nothing upstream will catch a regression you introduce:

```typescript fragment
// tests/components/StatusBadge.test.ts
import { test, expect } from "bun:test";
import { StatusBadge } from "../../resources/components/StatusBadge.tsx";

test("an overdue invoice is flagged", () => {
  const html = String(StatusBadge({ status: "overdue" }));

  expect(html).toContain("Overdue");
  expect(html).toContain("bg-red"); // whatever your theme maps it to
});
```

**Assert behaviour, not class strings, wherever you can.** A test pinned to
`bg-red-500` fails on a palette change that broke nothing. Prefer the visible
text, an `aria-` attribute, or a `data-` hook you control.

> **Note** — Interactive behaviour — a dropdown opening, a dialog trapping focus
> — needs a real browser. See [Browser Tests](/docs/testing/browser); rendering
> assertions stop at the markup the server produced.

## References

The full export surface of `@zerotal/flow-ui`:

| Export                                                                                                    | Kind       | Description                                                                           |
| --------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------- |
| `FlowUiProvider`                                                                                          | provider   | Registers the `flow:list` / `flow:add` / `flow:init` commands.                        |
| `COMPONENTS`, `UTILS`, `findComponent`                                                                    | registry   | The manifest behind `flow:add`.                                                       |
| `cn(...classes)`                                                                                          | util       | Merge class strings (clsx + tailwind-merge).                                          |
| `gva(base, config)`                                                                                       | util       | Build token-backed variant class functions.                                           |
| `Button`, `Badge`, `Card` (+ parts), `Input`, `Textarea`, `Label`                                         | components | Styled leaf and composite components.                                                 |
| `Separator`, `Skeleton`, `Avatar`                                                                         | components | Styled leaf components.                                                               |
| `Switch`, `Checkbox`, `Select`, `RadioGroup`                                                              | components | Themed wrappers over Flow's headless primitives.                                      |
| `Dialog`, `Sheet`, `DropdownMenu` (+ parts), `Tabs`, `Alert`, `Tooltip`, `Table`                          | components | Themed interactive components.                                                        |
| `Disclosure`, `Accordion`, `Popover`, `Listbox`, `Combobox`, `Field`, `Fieldset`, `Legend`, `Description` | re-exports | Headless [Flow](/docs/flow) primitives, re-exported so flow-ui stays a single import. |

CLI commands (registered by `FlowUiProvider`):

| Command     | Signature                                                 | Description                               |
| ----------- | --------------------------------------------------------- | ----------------------------------------- |
| `flow:init` | `flow:init [--dir <path>] [--css <path>]`                 | Set up the shared utils and theme import. |
| `flow:add`  | `flow:add <name[,name]> [--all] [--force] [--dir <path>]` | Copy component source into your app.      |
| `flow:list` | `flow:list`                                               | List every component available to add.    |

## Next steps

- [Flow](/docs/flow) — the server-driven component framework these wrap.
- [Validator](/docs/validator) — validate the form fields you bind with `Input` and `Select`.
- [Assets](/docs/assets) — build the Tailwind CSS that powers the theme tokens.
