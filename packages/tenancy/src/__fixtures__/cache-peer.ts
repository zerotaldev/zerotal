/**
 * The entry `optionalPeers.test.ts` bundles and runs, standing in for a compiled app.
 *
 * It reads a tenant's cache, which is what loads `@zerotal/cache`, and prints one JSON line
 * describing how that went: the error's class, code and the peer it names, or `null` when the
 * read got past loading the package.
 */
import { TenantContext } from "../TenantContext.ts";
import { tenantCache } from "../tenantStorage.ts";

/** The parts of an error the test asserts on. */
function describeError(error: unknown): Record<string, unknown> {
  const e = error as { code?: unknown; missing?: { peer?: unknown; install?: unknown } };
  return {
    threw: error instanceof Error ? error.constructor.name : typeof error,
    code: e.code ?? null,
    peer: e.missing?.peer ?? null,
    install: e.missing?.install ?? null,
    message: error instanceof Error ? error.message : String(error),
  };
}

const tenant = { id: 1, slug: "acme", name: "Acme", isActive: true };

let cache: Record<string, unknown> | null = null;
try {
  await TenantContext.run(tenant, () => tenantCache().get("stats"));
} catch (error) {
  cache = describeError(error);
}

console.log(JSON.stringify({ cache }));
