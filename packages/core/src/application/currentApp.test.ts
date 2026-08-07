import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { currentApp, tryCurrentApp, withApp, setDefaultApp } from "./currentApp.ts";
import type { Application } from "./Application.ts";

// The accessor only stores/returns references, so plain objects stand in for apps.
const appA = { id: "A" } as unknown as Application;
const appB = { id: "B" } as unknown as Application;

// The default app is process-global and `Application.boot()` sets it, so any
// other test file that boots one leaves it set. Clearing *before* each test as
// well as after means these assertions establish their own precondition rather
// than inheriting whatever ran first — the file order differs between platforms.
beforeEach(() => setDefaultApp(undefined));
afterEach(() => setDefaultApp(undefined));

describe("currentApp", () => {
  it("has no current app until a default is set", () => {
    expect(tryCurrentApp()).toBeUndefined();
    expect(() => currentApp()).toThrow(/No current application/);
  });

  it("resolves the process default once set", () => {
    setDefaultApp(appA);
    expect(currentApp()).toBe(appA);
    expect(tryCurrentApp()).toBe(appA);
  });

  it("clears back to no-app when the default is unset", () => {
    setDefaultApp(appA);
    setDefaultApp(undefined);
    expect(tryCurrentApp()).toBeUndefined();
    expect(() => currentApp()).toThrow();
  });

  describe("withApp", () => {
    it("overrides the default within the scope, and restores after", () => {
      setDefaultApp(appA);
      const inside = withApp(appB, () => currentApp());
      expect(inside).toBe(appB);
      expect(currentApp()).toBe(appA); // outside the scope, back to the default
    });

    it("keeps the override across awaits (async-scoped)", async () => {
      setDefaultApp(appA);
      const inside = await withApp(appB, async () => {
        await Promise.resolve();
        return currentApp();
      });
      expect(inside).toBe(appB);
      expect(currentApp()).toBe(appA);
    });

    it("provides a current app even when there is no process default", () => {
      expect(tryCurrentApp()).toBeUndefined();
      const inside = withApp(appB, () => currentApp());
      expect(inside).toBe(appB);
      expect(tryCurrentApp()).toBeUndefined(); // scope was confined
    });
  });
});
