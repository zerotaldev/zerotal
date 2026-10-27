# Changelog — @zerotal/validator

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Fixed

- **A field key reads as words in every default message.** The fluent API wrote the raw key
  ("The first_name field must not exceed 3 characters.") and the pipe-string engine a humanised one
  ("The first name field…"), so the same field and failure read differently depending on the
  syntax, and the fluent one, which `validate()` and every example use, put `snake_case` in a
  sentence addressed to the person filling in the form. Both engines now use one label, and so do
  the cross-field rules (`requiredWith` and the others name their fields as words) and the
  `unique` and `exists` messages. A message passed to a rule is unchanged. An app whose tests
  assert a default message for a field with an underscore will see the new wording. Closes #28.

## [1.9.0] — 2026-08-29

### Documented

- **Every promised export is documented.** The `docs-coverage` gate reads `maturity: stable` as a
  promise about a package's exports, and measures how much of that promise is written down. It
  was 798 gaps across the suite; it is now zero. This package's share is covered on its own
  pages — types named, options shapes described, and the decisions behind them recorded where
  somebody looking for them will find them.

## [1.7.3] — 2026-08-20

### Fixed

- **An optional `number` or `date` reads `""` as absence.** An HTML `<select>` has one way to
  say "none" — `<option value="">` — and it sends the empty string. `r.number().optional()`
  refused it, so a form with an optional assignee could not be submitted _without_ one: the
  single case the field was optional for. The message named a field the reader never touched,
  which is the part that made it expensive to find.

  It is now read as no value. The field is skipped, or set to `null` when the rule is also
  `nullable()` — because clearing is what that option means, and skipping would leave the
  previous value in place while reporting success. This mirrors how an explicit `null` on a
  `nullable()` field already behaves.

  Narrow on purpose: `string` still keeps `""`, where it may be a value someone meant, and the
  remaining types wait for a case that needs them. Nothing that validated before stops doing so.

## [1.5.0] — 2026-08-15

### Fixed

- **`Infer<>` resolves `array` and `object` to their contents.** Both inferred
  `unknown`, which is worse than it sounds: the idiomatic `data.ids ?? []` turns
  `unknown` into `{}`, so the error the user sees is
  `Property 'map' does not exist on type '{}'` — pointing at the array they just
  validated, with nothing to suggest the validator is where the type was lost.
  `r.array(r.number())` is now `number[]`, `r.object({ … })` is the shape it was
  given, and both nest to any depth. `nullable()` widens at every level rather
  than only the top one.

  `r.object()`'s shape parameter is inferred directly instead of through a
  `Schema` constraint, which is what makes the field types reachable at all.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Notes

- Conforms to the Zerotal package conventions (provider in `src/provider/`, PascalCase config factory, `ZerotalError`-based errors, test coverage).
