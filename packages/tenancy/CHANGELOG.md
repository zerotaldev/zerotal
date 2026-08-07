# Changelog — @zerotal/tenancy

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `beta`**

## [Unreleased]

## [1.0.0] — 2026-08-05

_First public release._

### Changed

- Moved service provider to `src/provider/`.
- Config factory renamed to `TenancyConfig` (PascalCase) with a deprecated `tenancyConfig` alias.
- Added test suite covering tenant isolation.
