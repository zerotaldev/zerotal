# @zerotal/flow-ui

> Themeable components for Flow — re-theme by overriding CSS variables, not by editing components.

Styled wrappers compose Flow's accessible **headless primitives**; all classes are driven by token-backed variants, so you re-theme by overriding CSS variables. You can also "own the code" and copy components into your app via the `flow` CLI.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add @zerotal/flow-ui
```

## Install the theme

After Tailwind in your app's CSS:

```css
@import "tailwindcss";
@import "@zerotal/flow-ui/theme.css";
```

This registers the design tokens (`--background`, `--primary`, `--border`, `--radius`, …)
under `:root` (light) and `.dark`, and maps them to Tailwind utilities via `@theme inline`
(`bg-background`, `text-foreground`, `border-border`, `ring-ring`, `rounded-md`, …). Toggle
dark mode by adding the `.dark` class to `<html>`. The default palette is a **neutral** greyscale.

## Use components

```tsx
import { Button } from "@zerotal/flow-ui";

<Button onClick={this.save}>Save</Button>
<Button variant="destructive" size="sm" onClick={() => (this.open = true)}>Delete</Button>
<Button variant="outline" class="w-full">Full width</Button>
```

Every component forwards `onClick`/`flow:*` directives and arbitrary attrs to the underlying
element, so server actions and client expressions work exactly as in plain Flow. A `class`
prop is always merged **last** (via `cn` → tailwind-merge), so your overrides win.

## Own the code — the `flow` CLI

Prefer to copy components into your app instead of importing the
package? Register the provider once, then scaffold:

```ts
// bootstrap/providers.ts
import { FlowUiProvider } from "@zerotal/flow-ui";
const providers = [/* … */ FlowUiProvider];
```

```sh
bun zt flow:list                  # browse the 20 components
bun zt flow:init                  # drop cn/gva utils + wire the theme import
bun zt flow:add button,card,dialog  # copy components into app/flow/components/ui/
bun zt flow:add --all             # copy everything
bun zt flow:add button --force    # overwrite an existing file
bun add clsx tailwind-merge          # the copied cn util needs these (the CLI reminds you)
```

Copied files land in `app/flow/components/ui/` with the shared utils in `ui/lib/`;
their `../utils/*` imports are rewritten to the local `./lib/*` automatically. You own
and edit the result — you own the code outright.

## Utilities

- `cn(...inputs)` — `clsx` + `tailwind-merge`; conflicting Tailwind utilities resolve so the
  last one wins.
- `gva(base, config)` — a tiny `class-variance-authority` clone: `variants`, `defaultVariants`,
  and `compoundVariants`. Used to author component variant maps.

## Status

Shipped:

- **Foundation:** `cn`, `gva`, theme tokens (neutral + dark).
- **Leaf components:** `Button`, `Badge`, `Card` (+ `CardHeader`/`CardTitle`/`CardDescription`/
  `CardContent`/`CardFooter`), `Input`, `Textarea`, `Label`, `Separator`, `Skeleton`, `Avatar`.
- **Restyles over headless/native primitives:** `Switch`, `Checkbox`, `Select`, `RadioGroup`.
- **Standalone token-themed builds** (over Flow's proven Alpine/`flow:*` directives + client
  runtimes `flowMenu`/`flowTabs`): `Dialog`, `Sheet`, `DropdownMenu` (+ `Item`/`Label`/`Separator`),
  `Tabs`, `Alert` (+ `AlertTitle`/`AlertDescription`), `Tooltip`, `Table`. These are built fresh
  rather than wrapping Flow's `Modal`/`Drawer`/`Dropdown`/etc., which bake literal gray colours
  and append `class` by string concat, so they can't be re-themed by wrapping.
- **Re-exports:** the remaining flow headless primitives (`Listbox`, `Combobox`, `Popover`,
  `Accordion`, `Disclosure`, `Field`, `Fieldset`, …) so this is a single import surface.

- **CLI + registry (Phase 3):** `flow:list` / `flow:init` / `flow:add` copy components into an
  app (the "own the code" model), via `FlowUiProvider` + the `registry`.
- **Docs site (Phase 4):** `bun run docs:gen` generates a doc page per component into
  `docs/components/` (install · live preview · usage · props), served by the docs app with the
  flow-ui theme wired in. Doc specs + pure markdown renderers live in `src/docs/`.
- **Showcase migration (Phase 5):** the example app's `ComponentsPage` is built entirely from
  flow-ui, covered by an SSR integration test.

All planned phases (0–5) are complete.

## Scripts

```sh
bun test        # unit tests
bun run typecheck
```

## Documentation

- [Component reference](../../docs/components) — one page per component (install, preview, usage, props)
