# Changelog — @zerotal/tenancy

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

### Added

- **`EnsureTenancyMiddleware` and `TenantStoragePathError` are documented.** Both were
  public and neither appeared in the guide. `EnsureTenancyMiddleware` is the difference
  between _resolving_ a tenant and _insisting_ on one — the guide now shows it composed
  after `TenancyMiddleware`, and says why registering it alone fails every request.
  `TenantStoragePathError` is the cross-tenant traversal guard: `LocalDriver` confines
  paths to the disk root rather than the tenant directory, so a key containing `..`
  reached a sibling tenant's folder and passed the driver's own check. The rejection
  happens at the prefixing layer, and that is now written down where someone handling
  upload errors will find it.

### Changed

- **Maturity is now `stable`** — the public API follows SemVer strictly for the rest of
  the 1.x line. All 22 promised exports are documented, and the property that actually
  matters here — that one tenant cannot read another's rows, files or cache — is covered
  by a dedicated cross-tenant security suite rather than inferred from unit tests.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

## [1.0.0] — 2026-08-05

_First public release._

### Changed

- Moved service provider to `src/provider/`.
- Config factory renamed to `TenancyConfig` (PascalCase) with a deprecated `tenancyConfig` alias.
- Added test suite covering tenant isolation.
