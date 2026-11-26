/**
 * What a shared app's providers subscribe to at boot must still be heard in the next file.
 *
 * `resetTestState()` clears every `FrameworkEvents` subscription between files, and a module-cached
 * app is re-adopted by the next file without booting again, so nothing subscribed again. The
 * logger's `[HTTP]` 4xx warnings and the auth audit trail printed in the first test file of a run
 * and in none after it (found by the 1.18.2 starter walk: `zt test a.test.ts b.test.ts` showed no
 * warnings from `b`, which printed them when run alone).
 *
 * Two files are simulated in one process as `shared-app-client-state.test.ts` does.
 */
import { describe, it, expect, afterAll } from "bun:test";
import {
  Application,
  FrameworkEvents,
  RequestHandled,
  Router,
  ServiceProvider,
} from "@zerotal/core";
import { createTestApp, type TestApp } from "./TestApp.ts";

const heard: string[] = [];

/** Subscribes at boot, as `LogProvider` does. */
class ListeningProvider extends ServiceProvider {
  override async onBooted(): Promise<void> {
    FrameworkEvents.on(RequestHandled, () => {
      heard.push("handled");
    });
  }
}

let cached: Application | undefined;
function bootstrap(): Application {
  if (!cached) {
    cached = Application.create({ env: "test", providers: [ListeningProvider] }).useConfig({});
    Router.get("/a", () => new Response("a"));
    Router.get("/b", () => new Response("b"));
  }
  return cached;
}

let fileB: TestApp | undefined;

afterAll(async () => {
  await fileB?.close();
  Application._resetInstance();
  cached = undefined;
});

describe("framework-event subscriptions on a shared app", () => {
  it("are heard in the file that booted the app", async () => {
    const fileA = await createTestApp(bootstrap);
    await fileA.get("/a");
    await fileA.close(); // what file A's afterAll does

    expect(heard).toHaveLength(1);
  });

  it("are still heard in the next file, which re-adopts it", async () => {
    fileB = await createTestApp(bootstrap); // what file B's beforeAll does
    await fileB.get("/b");

    expect(heard).toHaveLength(2);
  });
});
