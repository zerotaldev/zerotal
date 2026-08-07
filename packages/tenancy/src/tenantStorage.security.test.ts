import { describe, it, expect } from "bun:test";
import { TenantContext } from "./TenantContext.ts";
import { tenantDisk } from "./tenantStorage.ts";
import { TenantStoragePathError } from "./errors.ts";

/**
 * Regression guard for cross-tenant file access.
 *
 * `tenantDisk()` prefixed keys with `tenants/<slug>/`, but LocalDriver._fullPath confines paths
 * to the *disk root*, not the tenant directory — so `../victim/invoice.txt` from tenant `acme`
 * resolved to `<root>/tenants/victim/invoice.txt`, passed the driver's own traversal check, and
 * read another tenant's file. The proxy also prefixed only the first argument, so
 * `copy("mine.txt", "tenants/victim/pwned.txt")` wrote outside the tenant entirely.
 */

/** A driver stub that records the paths it is handed, so we assert on what actually escapes. */
function recordingDriver() {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return Promise.resolve(undefined);
    };
  return {
    calls,
    driver: {
      get: record("get"),
      put: record("put"),
      delete: record("delete"),
      exists: record("exists"),
      url: record("url"),
      copy: record("copy"),
      move: record("move"),
    },
  };
}

function inTenant<T>(slug: string, fn: () => T): T {
  return TenantContext.run({ id: 1, slug } as never, fn);
}

/** Build a tenant disk backed by the recording driver. */
function diskFor(slug: string) {
  const { calls, driver } = recordingDriver();
  const manager = { disk: () => driver } as never;
  return { calls, disk: () => inTenant(slug, () => tenantDisk(undefined, manager)) };
}

describe("tenantDisk() path confinement", () => {
  it("prefixes an ordinary key with the tenant directory", async () => {
    const { calls, disk } = diskFor("acme");
    await disk().put("logo.png", "data");
    expect(calls[0]!.args[0]).toBe("tenants/acme/logo.png");
  });

  it("rejects ../ traversal out of the tenant directory", () => {
    const { disk } = diskFor("acme");
    for (const evil of [
      "../victim/invoice.txt",
      "a/../../victim/invoice.txt",
      "../../../../etc/passwd",
      "..",
    ]) {
      expect(() => disk().get(evil)).toThrow(TenantStoragePathError);
    }
  });

  it("rejects absolute paths and backslash-escaped traversal", () => {
    const { disk } = diskFor("acme");
    for (const evil of ["/etc/passwd", "..\\victim\\invoice.txt", "a\\..\\..\\victim.txt"]) {
      expect(() => disk().get(evil)).toThrow(TenantStoragePathError);
    }
  });

  it("prefixes BOTH arguments of copy() and move()", async () => {
    const { calls, disk } = diskFor("acme");

    await disk().copy("mine.txt", "also-mine.txt");
    expect(calls[0]!.args[0]).toBe("tenants/acme/mine.txt");
    // The destination used to be passed through unprefixed, so a caller could write directly
    // into `tenants/victim/`.
    expect(calls[0]!.args[1]).toBe("tenants/acme/also-mine.txt");

    await disk().move("a.txt", "b.txt");
    expect(calls[1]!.args).toEqual(["tenants/acme/a.txt", "tenants/acme/b.txt"]);
  });

  it("rejects a traversing destination on copy()", () => {
    const { disk } = diskFor("acme");
    expect(() => disk().copy("mine.txt", "../victim/pwned.txt")).toThrow(TenantStoragePathError);
  });

  it("keeps two tenants in separate directories", async () => {
    const a = diskFor("acme");
    const b = diskFor("globex");
    await a.disk().put("report.pdf", "x");
    await b.disk().put("report.pdf", "y");
    expect(a.calls[0]!.args[0]).toBe("tenants/acme/report.pdf");
    expect(b.calls[0]!.args[0]).toBe("tenants/globex/report.pdf");
  });
});
