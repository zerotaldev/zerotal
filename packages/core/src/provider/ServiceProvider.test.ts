import { describe, it, expect } from "bun:test";
import { ServiceProvider } from "./ServiceProvider.ts";
import type { Application } from "../application/Application.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";

// Minimal mock app — constructor only stores the reference
const mockApp = {} as Application;

// Concrete provider that inherits all default implementations
class ConcreteProvider extends ServiceProvider {}

const ctx = {} as HttpContext;

describe("ServiceProvider — default lifecycle hooks", () => {
  it("onRegister() runs without error", () => {
    const p = new ConcreteProvider(mockApp);
    expect(() => p.onRegister()).not.toThrow();
  });

  it("onBooting() resolves", async () => {
    const p = new ConcreteProvider(mockApp);
    await expect(p.onBooting()).resolves.toBeUndefined();
  });

  it("onBooted() resolves", async () => {
    const p = new ConcreteProvider(mockApp);
    await expect(p.onBooted()).resolves.toBeUndefined();
  });

  it("onStarting() resolves", async () => {
    const p = new ConcreteProvider(mockApp);
    await expect(p.onStarting()).resolves.toBeUndefined();
  });

  it("onStarted() resolves", async () => {
    const p = new ConcreteProvider(mockApp);
    await expect(p.onStarted()).resolves.toBeUndefined();
  });

  it("onStopping() resolves", async () => {
    const p = new ConcreteProvider(mockApp);
    await expect(p.onStopping()).resolves.toBeUndefined();
  });

  it("onStopped() resolves", async () => {
    const p = new ConcreteProvider(mockApp);
    await expect(p.onStopped()).resolves.toBeUndefined();
  });
});

describe("ServiceProvider — per-request hooks", () => {
  it("onRequestReceived() resolves", async () => {
    const p = new ConcreteProvider(mockApp);
    await expect(p.onRequestReceived(ctx)).resolves.toBeUndefined();
  });

  it("onRequestProcessed() resolves", async () => {
    const p = new ConcreteProvider(mockApp);
    await expect(p.onRequestProcessed(ctx)).resolves.toBeUndefined();
  });

  it("onResponseSent() resolves", async () => {
    const p = new ConcreteProvider(mockApp);
    await expect(p.onResponseSent(ctx)).resolves.toBeUndefined();
  });
});

describe("ServiceProvider — replContext()", () => {
  it("returns an empty object by default", () => {
    const p = new ConcreteProvider(mockApp);
    expect(p.replContext()).toEqual({});
  });
});
