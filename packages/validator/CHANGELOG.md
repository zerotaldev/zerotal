# Changelog — @zerotal/validator

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

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
