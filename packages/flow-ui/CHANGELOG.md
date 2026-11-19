# Changelog — @zerotal/flow-ui

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Changed

- **BREAKING:** `flowUiHead()` loads Tailwind v4's browser build instead of the Tailwind v3 Play
  CDN. The script is `@tailwindcss/browser@4.3.5` from `cdn.jsdelivr.net`, pinned and loaded with an
  integrity hash, and the theme reaches it as a `<style type="text/tailwindcss">` (`@theme inline`,
  a `dark` variant on a `.dark` ancestor, the 1400px `container`) rather than a
  `tailwind.config = { … }` script. The components were already written against Tailwind v4 (the
  class model `tailwind-merge` uses), so the CDN now generates what they ask for: a checked
  `Switch` and `Checkbox` fill in, `aria-invalid` fields turn red, and `Input` gets its `shadow-xs`.
  The default border colour in dark mode is now the dark `--border` token; under the v3 CDN its
  preflight overrode the token with a light grey. An app must change two things if they apply:
  - A Content-Security-Policy that allows `https://cdn.tailwindcss.com` for the head must allow
    `https://cdn.jsdelivr.net` instead.
  - The app's own markup under `flowUiHead()` is now compiled by Tailwind v4. Rename the v3
    classes whose meaning moved: `shadow-sm` → `shadow-xs`, `blur-sm` → `blur-xs`,
    `backdrop-blur-sm` → `backdrop-blur-xs`, `drop-shadow-sm` → `drop-shadow-xs`, bare `ring` →
    `ring-3` (v4's is 1px and `currentColor`), `outline-none` → `outline-hidden`, and
    `bg-opacity-*` / `text-opacity-*` / `border-opacity-*` → an opacity modifier such as
    `bg-black/50`. Stacked variants now read left to right (`hover:file:` → `file:hover:`).
    `hover:` applies only on devices that can hover, and the default palette (`red-500`,
    `amber-500`, `gray-*`) is v4's, which is close to v3's but not identical.
- The head's base rules (token borders, the body background and colour) sit in Tailwind's `base`
  layer when the CDN is on, so a utility such as `border-primary` still beats them; v4 emits every
  utility inside a cascade layer, and an unlayered rule would win. The layer also keeps v3's grey
  placeholders, pointer cursor on buttons and centred `<dialog>`. Without the CDN (`stylesheet`
  set) the head and `flowTokensCss()` emit the same unlayered CSS as before.
- Components use the v4 names for what they rendered under v3: `shadow-sm` → `shadow-xs`,
  `outline-none` → `outline-hidden`, `bg-gradient-to-*` → `bg-linear-to-*` (`ScrollArea`), and the
  `Slider` thumb grows on `hover:[&::-webkit-slider-thumb]:scale-110`. A copied-in component in an
  app's own Tailwind v4 build renders a lighter shadow than before, matching the CDN.

### Added

- `flowTailwindCss()`: the theme as Tailwind v4 CSS, exactly what the head hands the CDN. Put it
  after `@import "tailwindcss";` in a v4 build, with `flowTokensCss()`, to match the CDN look.
  `flowTailwindConfig()` still returns the v3 config, for an app whose build is on Tailwind v3.

## [1.16.4] — 2026-11-17

### Changed

- **`clsx` is no longer a dependency.** `cn()` flattened its input with `clsx` before handing it to
  `tailwind-merge`; the flattening is twenty lines and now lives in `utils/cn.ts`, with the same
  output for every input: strings and non-zero numbers kept, `false`, `null`, `undefined`, `0`,
  `""` and bigints dropped, arrays flattened at any depth, and an object contributing each key whose
  value is truthy. A test compares it with `clsx` 2.1.1 case by case. `ClassValue` keeps its shape.
  `tailwind-merge` stays: it is the one dependency, and what makes a caller's class win over the
  component's. `flow:add` and `flow:init` now ask a copy-in app for `tailwind-merge` only; an app that
  already added `clsx` for the copied `lib/cn.ts` can remove it once it has copied the new one, or
  keep it, since the old file still works.
- The `gva()` header no longer calls it dependency-free. It adds none of its own, but its result
  goes through `cn()` and so needs `tailwind-merge`.

## [1.15.2] — 2026-10-23

### Changed

- **`tailwind-merge` is now `^3.7.0`** (was `^3.3.1`). It is what the `cn` helper uses to
  drop a class that a later one overrides. The range stays within 3.x.

## [1.9.0] — 2026-08-29

### Added

- **The type surface is documented.** Every component exports the type of its own props —
  `ButtonProps`, `DialogProps`, and 59 more — and none of them was named anywhere a reader
  would look, though wrapping a component is the usual reason to want one. `docs/components.md`
  now names them, with a worked wrapper, alongside the option unions a prop takes
  (`SelectOption`, `PopoverSide`, `ToastPosition`, …), the sub-components (`AlertTitle`,
  `DropdownMenuShortcut`, the prose set), the `cva` variant configs a wrapper can reuse, and the
  theming exports.

### Changed

- **INTERNAL: nine helpers are marked `@internal`** — the calendar's date maths (`monthGrid`,
  `shiftMonth`, `isoDay`, `formatDay`, `paginationRange`) and the `flow:add` machinery
  (`resolveSource`, `rewriteImports`, `withDependencies`, `UtilEntry`). Still exported, still
  working; they were never something an app calls.

## [1.7.4] — 2026-08-21

### Added

- **`<Icon name="inbox" />` — 2,060 icons, bundled, typed by name.** The set ships inside this
  package, so there is nothing to install and no generator to run: a fresh app gets
  autocomplete over every name and a compile error on a typo (`Type '"inbxo"' is not
assignable to type 'IconName'. Did you mean '"inbox"'?`). Rendered on the server as inline
  SVG, so there is no icon font, no sprite, no request per glyph, and nothing for a strict CSP
  to block.

  Icons are sized in `em` and painted in `currentColor` — they inherit the text they sit in
  until `class="size-5 text-red-600"` says otherwise. Decorative by default and hidden from
  screen readers; `label` announces one that carries the meaning, which is the case for an icon
  that is the only content of a button.

  `registerIcons()` adds your own, and `CustomIconRegistry` declares them to the compiler. A
  registered name shadows a bundled one, so substituting a drawing does not mean renaming every
  call site. See [Icons](/docs/flow/icons).

  The bundled set is [Lucide](https://lucide.dev), ISC-licensed — which is why it can be shipped
  at all. Sets under stricter terms are deliberately not vendored: Font Awesome Free is CC BY
  4.0 and would put an attribution obligation on every app installing Flow, and Pro may not be
  redistributed at all. `registerIcons()` is the route for a set you are entitled to.

## [1.5.0] — 2026-08-15

### Added

- **The component reference documents all 53 components, and cannot drift again.**
  The page covered 20 of them. Nothing failed when a component shipped without a
  section, so the gap grew quietly — and a SemVer promise over an undocumented
  surface is not one anyone can use, which is what kept this package out of
  `stable`.

  The material was already here: `registry.ts` knows every component and
  `src/docs/spec.tsx` carries a usage example, a rendered preview and a props
  table for each. What was missing was the generator that turns them into the
  page — `scripts/generate-docs.ts` referenced in `render.ts` had never been
  written. It exists now, and every component gained install instructions, a live
  preview and a props table in the process.

  `bun run docs:components:check` fails when the page is out of date and runs in
  CI, so a component added without a spec is a red build rather than a silent
  hole. Only the region between the generated markers is rewritten, so the
  hand-written guide around it — setup, theming, copy-in vs import, testing —
  is preserved.

### Changed

- **Maturity is now `stable`** — the public API follows SemVer strictly for the rest
  of the 1.x line. The documentation gate is closed, and closed durably: the reference
  is generated from the registry and gated in CI rather than maintained by hand, which
  is what stops it regressing to a third of the surface again.

  The supporting evidence: every one of the 53 components is asserted to render
  (`docs.test.tsx` checks each spec preview produces non-empty HTML), 119 tests cover
  behaviour on top of that, the API surface is snapshotted and CI-diffed, there has
  never been a breaking change, and both dependencies — `@zerotal/core` and
  `@zerotal/flow` — are themselves stable.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Fixed

- **`Dialog`/`Sheet` resolve their `show` binding from the compiler's `__flowBinds`.** They now consult `_injectedBindKey(props, "show")` before value-based resolution, so a dialog or sheet with bound children (e.g. a `Checkbox`/`Input` inside) binds reliably instead of degrading to unbound when the bound props share a value. Matches the flow bind-name injection pass; no API change.

### Notes

- Conforms to the Zerotal package conventions (provider in `src/provider/`, PascalCase config factory, `ZerotalError`-based errors, test coverage).
