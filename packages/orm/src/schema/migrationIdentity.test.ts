/**
 * A migration is recorded under a name, and a name is a thing people rename.
 *
 * Renaming a file makes an applied migration look pending: the runner tries it again
 * and fails on `table already exists` — a failed boot, with an error that names a
 * table rather than the rename that caused it.
 *
 * An app renumbered `001_` to `0001_` to match this framework's own scaffold
 * convention — exactly what a careful person does — and would have made all nine of
 * its production migrations look unrun. They caught it by reading.
 */
import { describe, it, expect } from "bun:test";
import { _refuseLikelyRenames } from "./MigrationRunner.ts";
import type { MigrationEntry } from "./MigrationRunner.ts";

const entry = (name: string): MigrationEntry =>
  ({ name, migration: { async up() {}, async down() {} } }) as MigrationEntry;

describe("_refuseLikelyRenames", () => {
  it("refuses a renumbered migration rather than re-running it", () => {
    expect(() =>
      _refuseLikelyRenames([entry("0001_create_users")], new Set(["001_create_users"])),
    ).toThrow(/already run/);
  });

  it("names both spellings, so the reader can see what happened", () => {
    let message = "";
    try {
      _refuseLikelyRenames([entry("0010_add_tenant_limits")], new Set(["010_add_tenant_limits"]));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("0010_add_tenant_limits");
    expect(message).toContain("010_add_tenant_limits");
  });

  it("offers the pin that makes the new filename permanent", () => {
    let message = "";
    try {
      _refuseLikelyRenames([entry("0001_create_users")], new Set(["001_create_users"]));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('static override id = "001_create_users"');
  });

  it("allows a genuinely new migration", () => {
    expect(() =>
      _refuseLikelyRenames([entry("002_add_posts")], new Set(["001_create_users"])),
    ).not.toThrow();
  });

  it("allows a migration that has simply not run yet", () => {
    expect(() => _refuseLikelyRenames([entry("001_create_users")], new Set())).not.toThrow();
  });

  it("does not fire on a name that is only an ordinal", () => {
    // `0001` and `001` strip to nothing; two empty strings are not evidence.
    expect(() => _refuseLikelyRenames([entry("0001")], new Set(["001"]))).not.toThrow();
  });

  it("does not fire when the names are already identical", () => {
    // Identical means it is not pending at all, but the guard must not trip on it.
    expect(() =>
      _refuseLikelyRenames([entry("001_create_users")], new Set(["001_create_users"])),
    ).not.toThrow();
  });

  it("catches a rename in the other direction too", () => {
    expect(() =>
      _refuseLikelyRenames([entry("1_create_users")], new Set(["0001_create_users"])),
    ).toThrow(/already run/);
  });

  it("catches a separator change as well as a digit change", () => {
    expect(() =>
      _refuseLikelyRenames([entry("001-create_users")], new Set(["001_create_users"])),
    ).toThrow(/already run/);
  });
});
