/**
 * Global test preload (referenced from the root `bunfig.toml`).
 *
 * Test code is trusted: fixtures and setup routinely `create()` models with
 * full attribute sets and no `fillable` declaration. Models guard every
 * attribute by default (see `BaseModel` mass-assignment), so we disable that
 * guard process-wide for the test run — exactly as a framework's base TestCase
 * would. Explicit `fillable` / `guarded` lists are still honoured, so tests that
 * assert those semantics remain meaningful; tests covering the guarded-by-default
 * throw simply call `BaseModel.reguard()` in their own setup.
 *
 * **Do not let a security control depend on this being off.** A control that only holds
 * while models are guarded is untestable here by construction — the 2026-07 audit found
 * exactly that with tenant injection, which was fill-if-absent and therefore relied on the
 * mass-assignment guard to stop a client-supplied `tenant_id`. `Tenantable` now writes the
 * tenant column authoritatively, so it holds with the guard off, and
 * `tenancy/src/cross-tenant.security.test.ts` proves it under this preload.
 */
import { BaseModel } from "../packages/orm/src/index.ts";

BaseModel.unguard();
