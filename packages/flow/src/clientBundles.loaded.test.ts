/**
 * The client bundles build from source in a process that has already loaded the client.
 *
 * On Bun 1.3, `Bun.build` refuses a file the process has already loaded through another
 * path, so once anything imported `client/bridge.ts` the CSP runtime stopped building, and a
 * checkout served pages with no runtime at all. This file imports the bridge first, the way a
 * test or a dev tool might, and then asks for every bundle.
 */
import { describe, expect, it } from "bun:test";
import { _parseSocketListener } from "./client/bridge.ts";
import { _CLIENT_BUNDLE_NAMES, _loadClientBundle } from "./clientBundles.ts";

describe("a process that has loaded the client", () => {
  it("still builds every bundle from source", async () => {
    // The import above is the point; this keeps it from being dropped as unused.
    expect(typeof _parseSocketListener).toBe("function");
    for (const name of _CLIENT_BUNDLE_NAMES) {
      const loaded = await _loadClientBundle(name, true);
      expect({ name, ok: loaded.ok, from: loaded.ok && loaded.from }).toEqual({
        name,
        ok: true,
        from: "source",
      });
    }
  }, 180_000);
});
