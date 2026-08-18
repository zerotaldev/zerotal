// This package is for browsers, and its documented import could not be bundled
// for one.
//
// `import { Socket } from "@zerotal/client"` reached `ClientProvider` →
// `@zerotal/core` (root) → `CommandRunner` → the built-in CLI commands, one of
// which does `await import("bun")`. That is a resolution-time error, so
// tree-shaking never got the chance to drop the half nobody wanted: one
// server-only export made the whole package unusable in the place it was written
// for. `bun zt inertia:build` said `✖ Bundle failed` and the real cause was two
// layers down in a bundler log.
//
// A unit test cannot see any of this — every module imports fine under Bun. So
// this one runs the bundler.

import { describe, it, expect } from "bun:test";
import pkg from "../package.json" with { type: "json" };

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

async function bundles(entry: string): Promise<{ ok: boolean; why: string }> {
  const result = await Bun.build({
    entrypoints: [`${ROOT}/src/${entry}`],
    target: "browser",
    throw: false,
  });
  return { ok: result.success, why: String(result.logs[0] ?? "").split("\n")[0] };
}

describe("the browser entry", () => {
  it("bundles for a browser", async () => {
    const { ok, why } = await bundles("browser.ts");
    expect(ok, `browser.ts must bundle for target:"browser" — ${why}`).toBe(true);
  });

  it("Socket bundles on its own too", async () => {
    // The subpath the guide taught while the root was broken. It stays supported.
    const { ok, why } = await bundles("Socket.ts");
    expect(ok, `Socket.ts must bundle — ${why}`).toBe(true);
  });

  it("the exports map sends browsers to that entry", async () => {
    // The file being clean is half of it; the map has to point there, or the
    // documented import resolves to the server barrel again.
    const root = (pkg as { exports: Record<string, unknown> }).exports["."];
    expect(root).toMatchObject({ browser: "./src/browser.ts", default: "./src/index.ts" });
  });

  it("the browser entry keeps up with the barrel", async () => {
    // Two entries means two places to add an export to, and forgetting the
    // second is silent: browsers just cannot import the new thing. Only the
    // genuinely server-side names may be missing.
    const SERVER_ONLY = new Set(["ClientProvider", "Client", "ClientConfig"]);
    const index = await import("./index.ts");
    const browser = await import("./browser.ts");

    const missing = Object.keys(index)
      .filter((name) => !SERVER_ONLY.has(name))
      .filter((name) => !(name in browser));

    expect(missing, `browser.ts is missing: ${missing.join(", ")}`).toEqual([]);
    // And it must not have quietly re-admitted the server half.
    for (const name of SERVER_ONLY) expect(name in browser).toBe(false);
  });

  it("the server barrel is still the default, provider and all", async () => {
    // The browser condition must not have quietly removed anything from Bun and
    // Node consumers — `ClientProvider` is how the package is registered.
    const index = await import("./index.ts");
    expect(typeof index.ClientProvider).toBe("function");
    expect(typeof index.createApiClient).toBe("function");
    expect(typeof index.Socket).toBe("function");
  });
});
