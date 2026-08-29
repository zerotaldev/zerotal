# Changelog — @zerotal/flow-ui

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

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
