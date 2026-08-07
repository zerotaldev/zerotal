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

```tsx
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

```ts
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

## Button

Clickable button with variants and sizes. Everything else — `onClick`, `type`, `disabled`, `flow:*` directives — passes straight through to the underlying `<button>`.

```tsx
// in a Flow component
<Button onClick={this.save}>Save</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>
```

| Prop      | Type                                                                          | Default     | Description                                      |
| --------- | ----------------------------------------------------------------------------- | ----------- | ------------------------------------------------ |
| `variant` | `"default" \| "destructive" \| "outline" \| "secondary" \| "ghost" \| "link"` | `"default"` | Visual style.                                    |
| `size`    | `"default" \| "sm" \| "lg" \| "icon"`                                         | `"default"` | Sizing.                                          |
| `type`    | `"button" \| "submit" \| "reset"`                                             | `"button"`  | Native button type.                              |
| `class`   | `string`                                                                      | —           | Extra classes, merged last (wins over defaults). |

## Badge

Small status pill with variants.

```tsx
// in a Flow component
<Badge>New</Badge>
<Badge variant="secondary">Beta</Badge>
<Badge variant="destructive">Overdue</Badge>
<Badge variant="outline">Draft</Badge>
```

| Prop      | Type                                                     | Default     | Description    |
| --------- | -------------------------------------------------------- | ----------- | -------------- |
| `variant` | `"default" \| "secondary" \| "destructive" \| "outline"` | `"default"` | Visual style.  |
| `class`   | `string`                                                 | —           | Extra classes. |

## Card

Surface container with composable header / title / description / content / footer parts.

```tsx
// in a Flow component
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

| Prop       | Type     | Default | Description                                                                                 |
| ---------- | -------- | ------- | ------------------------------------------------------------------------------------------- |
| `class`    | `string` | —       | Extra classes on the surface.                                                               |
| `children` | `node`   | —       | Compose with `CardHeader` / `CardTitle` / `CardDescription` / `CardContent` / `CardFooter`. |

## Input

Themed text input. It forwards everything to the underlying `<input>`, so Flow's two-way binding works exactly as on a bare input: `value={this.form.email}` emits `flow:model`.

```tsx
// in a Flow component
<Field label="Email">
  <Input value={this.form.email} placeholder="you@example.com" />
</Field>
```

| Prop    | Type          | Default  | Description                                                     |
| ------- | ------------- | -------- | --------------------------------------------------------------- |
| `value` | `bound state` | —        | Two-way bind to an `@expose` / form field (emits `flow:model`). |
| `type`  | `string`      | `"text"` | Native input type.                                              |
| `class` | `string`      | —        | Extra classes.                                                  |

## Textarea

Themed multi-line input. Forwards everything to `<textarea>`, so `value` binds two-way like a bare textarea.

```tsx
// in a Flow component
<Textarea value={this.form.bio} placeholder="Tell us about yourself" rows={4} />
```

| Prop    | Type          | Default | Description                                |
| ------- | ------------- | ------- | ------------------------------------------ |
| `value` | `bound state` | —       | Two-way bind to an `@expose` / form field. |
| `class` | `string`      | —       | Extra classes.                             |

## Label

Form label that wraps the headless `Label`, keeping the `flow-label` hook and any `<Field>` id wiring.

```tsx
// in a Flow component
<Label for="email">Email</Label>
```

| Prop    | Type     | Default | Description            |
| ------- | -------- | ------- | ---------------------- |
| `for`   | `string` | —       | Associated control id. |
| `class` | `string` | —       | Extra classes.         |

## Separator

Horizontal or vertical divider. Decorative (ARIA-hidden) by default.

```tsx
// in a Flow component
<Separator />
<Separator orientation="vertical" class="h-6" />
```

| Prop          | Type                         | Default        | Description                                                |
| ------------- | ---------------------------- | -------------- | ---------------------------------------------------------- |
| `orientation` | `"horizontal" \| "vertical"` | `"horizontal"` | Divider direction.                                         |
| `decorative`  | `boolean`                    | `true`         | ARIA-hidden when decorative; semantic separator otherwise. |
| `class`       | `string`                     | —              | Extra classes.                                             |

## Skeleton

Pulsing loading placeholder. Size and shape come from utility classes.

```tsx
// in a Flow component
<Skeleton class="h-12 w-12 rounded-full" />
<Skeleton class="h-4 w-48" />
```

| Prop    | Type     | Default | Description                   |
| ------- | -------- | ------- | ----------------------------- |
| `class` | `string` | —       | Size and shape via utilities. |

## Avatar

Circular avatar with an image and a fallback. Flow renders on the server, so there is no client-side image-load fallback — pass `src` to show the image and `fallback` (e.g. initials) shown when `src` is absent.

```tsx
// in a Flow component
<Avatar src={user.avatarUrl} alt={user.name} fallback="AL" />
<Avatar fallback="GH" />
```

| Prop       | Type             | Default | Description                                      |
| ---------- | ---------------- | ------- | ------------------------------------------------ |
| `src`      | `string \| null` | —       | Image URL; falls back to `fallback` when absent. |
| `fallback` | `node`           | —       | Shown when there's no image (e.g. initials).     |
| `alt`      | `string`         | `""`    | Image alt text.                                  |

## Switch

On/off toggle bound to a boolean. Composes Flow's headless Switch (`role="switch"`, server-synced).

```tsx
// in a Flow component
<Switch bind={this.notifications} />
```

| Prop    | Type              | Default | Description                            |
| ------- | ----------------- | ------- | -------------------------------------- |
| `bind`  | `@expose boolean` | —       | Two-way bound boolean (server-synced). |
| `class` | `string`          | —       | Extra classes on the track.            |

## Checkbox

Checkbox bound to a boolean. Composes Flow's headless Checkbox (`role="checkbox"`, server-synced).

```tsx
// in a Flow component
<Checkbox bind={this.agree} />
```

| Prop    | Type              | Default | Description            |
| ------- | ----------------- | ------- | ---------------------- |
| `bind`  | `@expose boolean` | —       | Two-way bound boolean. |
| `class` | `string`          | —       | Extra classes.         |

## Select

Native select bound to a value. Composes Flow's headless Select (a styled native `<select>` bound via `flow:model`).

```tsx
// in a Flow component
<Select bind={this.country} options={[{ label: "Canada", value: "ca" }]} />
```

| Prop          | Type                 | Default | Description                         |
| ------------- | -------------------- | ------- | ----------------------------------- |
| `bind`        | `@expose value`      | —       | Two-way bound value (`flow:model`). |
| `options`     | `{ label, value }[]` | —       | Option list.                        |
| `placeholder` | `string`             | —       | Optional empty first option.        |

## RadioGroup

Segmented radio set bound to a value. Composes Flow's headless RadioGroup (`role="radiogroup"`, arrow-key roving).

```tsx
// in a Flow component
<RadioGroup bind={this.plan} options={[{ label: "Pro", value: "pro" }]} />
```

| Prop          | Type                 | Default | Description          |
| ------------- | -------------------- | ------- | -------------------- |
| `bind`        | `@expose value`      | —       | Two-way bound value. |
| `options`     | `{ label, value }[]` | —       | Option list.         |
| `optionClass` | `string`             | —       | Per-option classes.  |

## Dialog

Modal dialog, focus-trapped while open. Toggle visibility with a bound `@expose` boolean.

```tsx
// in a Flow component
<Button onClick={() => (this.open = true)}>Edit profile</Button>

<Dialog show={this.open} title="Edit profile" description="Make changes here.">
  <form onSubmit={this.save} class="flex flex-col gap-3">
    <Field label="Name"><Input value={this.form.name} /></Field>
    <Button type="submit">Save</Button>
  </form>
</Dialog>
```

| Prop          | Type              | Default | Description                                   |
| ------------- | ----------------- | ------- | --------------------------------------------- |
| `show`        | `@expose boolean` | —       | Visibility (focus-trapped while open).        |
| `title`       | `node`            | —       | Dialog title (wires `aria-labelledby`).       |
| `description` | `node`            | —       | Supporting text (`aria-describedby`).         |
| `onClose`     | `handler`         | —       | Server action/handler invoked on close.       |
| `closable`    | `boolean`         | `true`  | Show the × and allow backdrop / Escape close. |

## Sheet

Edge-anchored slide-over panel — the `<Dialog>` cousin that slides in from a screen edge.

```tsx
// in a Flow component
<Button onClick={() => (this.open = true)}>Open</Button>

<Sheet show={this.open} side="right" title="Edit profile">…</Sheet>
```

| Prop       | Type                                     | Default   | Description                                   |
| ---------- | ---------------------------------------- | --------- | --------------------------------------------- |
| `show`     | `@expose boolean`                        | —         | Visibility (focus-trapped while open).        |
| `side`     | `"left" \| "right" \| "top" \| "bottom"` | `"right"` | Edge to slide from.                           |
| `title`    | `node`                                   | —         | Header title.                                 |
| `closable` | `boolean`                                | `true`    | Show the × and allow backdrop / Escape close. |

## DropdownMenu

Keyboard-navigable menu (Down/Up/Home/End/Enter/Escape, click-outside close). Compose items with `DropdownMenuItem`, `DropdownMenuLabel`, and `DropdownMenuSeparator`.

```tsx
// in a Flow component
<DropdownMenu label="Options">
  <DropdownMenuLabel>My account</DropdownMenuLabel>
  <DropdownMenuItem onClick={this.profile}>Profile</DropdownMenuItem>
  <DropdownMenuSeparator />
  <DropdownMenuItem variant="destructive" onClick={this.signOut}>
    Sign out
  </DropdownMenuItem>
</DropdownMenu>
```

| Prop      | Type                | Default  | Description                                |
| --------- | ------------------- | -------- | ------------------------------------------ |
| `label`   | `node`              | —        | Default trigger label (or pass `trigger`). |
| `trigger` | `node`              | —        | Custom trigger (overrides `label`).        |
| `align`   | `"left" \| "right"` | `"left"` | Panel alignment.                           |

## Tabs

Tabbed panels with a pill tablist and roving arrow-key navigation.

```tsx
// in a Flow component
<Tabs
  items={[
    { label: "Account", content: <AccountForm /> },
    { label: "Password", content: <PasswordForm /> },
  ]}
/>
```

| Prop    | Type                          | Default | Description            |
| ------- | ----------------------------- | ------- | ---------------------- |
| `items` | `{ label, content, name? }[]` | —       | Tabs and their panels. |
| `class` | `string`                      | —       | Extra classes.         |

## Alert

Inline alert with title and description. Optionally dismissible (client-only, no round-trip).

```tsx
// in a Flow component
<Alert title="Heads up!">You can add components to your app.</Alert>
<Alert variant="destructive" title="Error">Something went wrong.</Alert>
```

| Prop          | Type                         | Default     | Description                        |
| ------------- | ---------------------------- | ----------- | ---------------------------------- |
| `variant`     | `"default" \| "destructive"` | `"default"` | Visual style and ARIA role.        |
| `title`       | `node`                       | —           | Bold title line.                   |
| `dismissible` | `boolean`                    | `false`     | Show a client-only dismiss button. |

## Tooltip

Hover/focus tooltip. Wraps a single child and wires `aria-describedby`.

```tsx
// in a Flow component
<Tooltip content="Add to library">
  <Button size="icon">+</Button>
</Tooltip>
```

| Prop        | Type                | Default | Description      |
| ----------- | ------------------- | ------- | ---------------- |
| `content`   | `node`              | —       | Tooltip text.    |
| `placement` | `"top" \| "bottom"` | `"top"` | Bubble position. |

## Table

URL-sortable data table. Clicking a sortable header navigates to `?sortBy=key&sortDir=asc|desc` — pair it with `@url sortBy` / `@url sortDir` and sort rows server-side in `render()`.

```tsx
// in a Flow component
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

| Prop                 | Type                               | Default | Description                                           |
| -------------------- | ---------------------------------- | ------- | ----------------------------------------------------- |
| `columns`            | `TableColumn[]`                    | —       | Column defs (`key`, `label`, `sortable?`, `render?`). |
| `rows`               | `T[]`                              | —       | Row data.                                             |
| `sortBy` / `sortDir` | `@url state`                       | —       | Bind to URL sort state for sortable headers.          |
| `hover`              | `boolean`                          | —       | Highlight rows on hover.                              |
| `params`             | `Record<string, string \| number>` | —       | Extra query params to keep in sort links.             |

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

```typescript
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
