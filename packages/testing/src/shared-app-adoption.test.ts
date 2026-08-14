/**
 * The second test file in a process must get a *usable* app.
 *
 * `createTestApp()`'s shared-app path adopted the app and then called
 * `resetTestState()`, which calls `Application._resetInstance()` — undoing the
 * adoption it had just performed. The second file in a run was therefore handed
 * an app whose scope had been torn down, and the first facade it touched threw
 * `E_FACADE_BEFORE_BOOT`.
 *
 * What made it expensive to diagnose is that *each file passed in isolation*: the
 * failure attaches to whichever file happens to sort second, so it reads as a bug
 * in that file rather than in the harness. This file reproduces the sequence
 * without needing two real files — the shared-app cache is keyed by the
 * `Application`, so calling `createTestApp()` twice with the same bootstrap is
 * exactly the path a second file takes.
 */
import { describe, it, expect, afterAll } from "bun:test";
import { Application, createFacade, currentApp } from "@zerotal/core";
import { createTestApp, type TestApp } from "./TestApp.ts";

/** Something only reachable through the container, so a facade genuinely resolves. */
class Greeter {
  greet(): string {
    return "hello";
  }
}

declare module "@zerotal/core" {
  interface ContainerBindings {
    "test.greeter": Greeter;
  }
}

const Greet = createFacade("test.greeter");

/**
 * Stands in for a module-cached `bootstrap/app.ts`: the module body runs once,
 * so the same instance — with the same registrations — comes back every call.
 */
let cached: Application | undefined;
function bootstrap(): Application {
  if (!cached) {
    cached = Application.create({ env: "test" }).useConfig({});
    cached.container.singleton("test.greeter", () => new Greeter());
  }
  return cached;
}

let first: TestApp;
let second: TestApp;

afterAll(async () => {
  await second?.close();
  await first?.close();
  Application._resetInstance();
  cached = undefined;
});

describe("createTestApp — a second file in the same process", () => {
  it("hands back an adopted app, so facades resolve", async () => {
    first = await createTestApp(bootstrap);
    // Pre-resolve, the way a provider's onBooted would.
    await first.app.container.make("test.greeter");
    expect(Greet.greet()).toBe("hello");

    // What the first file's afterAll does.
    await first.close();

    // What the second file's beforeAll does.
    second = await createTestApp(bootstrap);

    // The bug: the app was adopted and then immediately un-adopted, so this threw.
    expect(() => currentApp()).not.toThrow();
    expect(currentApp()).toBe(first.app);
    expect(Greet.greet()).toBe("hello");
  });

  it("returns the same shared TestApp rather than booting a second one", () => {
    expect(second).toBe(first);
  });
});
