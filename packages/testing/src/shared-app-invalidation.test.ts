/**
 * A file that boots the app with a `setup` callback must not leave the next file
 * without one.
 *
 * `createTestApp(bootstrap, setup)` opts out of *sharing* — `setup` registers
 * routes, and those cannot be added twice to a running server — and
 * `FlowBrowser.serve` always passes one. But "not shared" was implemented as "not
 * cached", which made the app invisible to everything else, and the `Application`
 * behind it is not private at all: `bootstrap/app.ts` is module-cached, so every
 * later file's `bootstrap()` returns that same instance.
 *
 * So its `close()` ran the full provider teardown, `DatabaseProvider.onStopping`
 * cleared the process-global connection resolver, and the next file got the same
 * dead `Application` back — `Application.create()` short-circuits on a module-cached
 * app, so the providers never re-registered and nothing put the resolver back. Every
 * query from then on raised
 *
 *   [Zerotal ORM] No database connection. Is DatabaseProvider registered?
 *
 * in files that had done nothing wrong. It read as a CI-only flake because the
 * exposing order — a browser-driven file before an ordinary one — is alphabetical
 * on Windows and arbitrary readdir order on Linux.
 */
import { describe, it, expect, afterAll } from "bun:test";
import { Application, createFacade } from "@zerotal/core";
import { createTestApp, closeSharedTestApps } from "./TestApp.ts";

/** Something only reachable through the container, so "still alive" is observable. */
class Marker {
  ok(): boolean {
    return true;
  }
}

declare module "@zerotal/core" {
  interface ContainerBindings {
    "test.invalidation.marker": Marker;
  }
}

const Mark = createFacade("test.invalidation.marker");

/** Stands in for a module-cached `bootstrap/app.ts`: same instance every call. */
let cached: Application | undefined;
function bootstrap(): Application {
  if (!cached) {
    cached = Application.create({ env: "test" }).useConfig({});
    cached.container.singleton("test.invalidation.marker", () => new Marker());
  }
  return cached;
}

afterAll(async () => {
  await closeSharedTestApps();
  Application._resetInstance();
  cached = undefined;
});

describe("createTestApp — a setup-booted app is still the shared Application", () => {
  it("leaves the app usable for the file that runs next", async () => {
    // What `FlowBrowser.serve` does, and what every app-booting file in a
    // browser-heavy suite does: boot with a `setup`.
    const withSetup = await createTestApp(bootstrap, () => {});
    // Pre-resolve, the way a provider's onBooted would.
    await withSetup.app.container.make("test.invalidation.marker");
    expect(Mark.ok()).toBe(true);

    // What that file's afterAll does.
    await withSetup.close();

    // What the next file's beforeAll does. Before the fix the setup-booted app was
    // never cached, so this took the fresh path and got the module-cached
    // `Application` back *stopped* — `Application.create()` short-circuits, the
    // providers never re-register, and nothing puts the connection resolver back.
    const next = await createTestApp(bootstrap);

    // Now it is found and handed back alive, rather than re-booted from a corpse.
    expect(next).toBe(withSetup);
    expect(Mark.ok()).toBe(true);
  });
});
