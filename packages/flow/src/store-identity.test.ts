import { describe, it, expect, beforeEach } from "bun:test";
import { clientStore, defineStore, initClientStore } from "./store.ts";

type G = typeof globalThis & { Alpine?: unknown; __flowStoreInit?: unknown };

/** A minimal stand-in for Alpine's store registry: one reactive-enough named store map. */
function fakeAlpine() {
  const stores: Record<string, Record<string, unknown>> = {};
  return {
    stores,
    store(name: string, value?: Record<string, unknown>): Record<string, unknown> | undefined {
      if (value !== undefined) stores[name] = value;
      return stores[name];
    },
  };
}

/** Make Alpine appear on the global WITHOUT touching any queued defineStore() state. */
function setAlpine(A: unknown): void {
  (globalThis as G).Alpine = A;
}

describe("client store — backed by Alpine's store", () => {
  beforeEach(() => {
    delete (globalThis as G).Alpine;
    delete (globalThis as G).__flowStoreInit;
  });

  it("queues defineStore() before Alpine exists, then applies it on init", () => {
    defineStore({ ui: { dark: true, sidebar: false } }); // Alpine absent → queued
    const A = fakeAlpine();
    setAlpine(A);
    initClientStore(A);
    const s = A.store("flow") as Record<string, Record<string, unknown>>;
    expect(s["ui"]!["dark"]).toBe(true);
    expect(s["ui"]!["sidebar"]).toBe(false);
  });

  it("defineStore() after Alpine exists seeds the flow store directly", () => {
    const A = fakeAlpine();
    setAlpine(A);
    defineStore({ cart: { count: 3 } });
    expect((A.store("flow") as Record<string, Record<string, unknown>>)["cart"]!["count"]).toBe(3);
  });

  it("clientStore() returns the same Alpine store object across calls", () => {
    const A = fakeAlpine();
    setAlpine(A);
    initClientStore(A);
    expect(clientStore()).toBe(A.store("flow"));
    expect(clientStore()).toBe(clientStore());
  });

  it("initClientStore registers the store once and never replaces it", () => {
    const A = fakeAlpine();
    setAlpine(A);
    const first = initClientStore(A);
    (first as Record<string, unknown>)["ui"] = { dark: true };
    const second = initClientStore(A);
    expect(second).toBe(first); // same object — not re-registered
    expect((second as Record<string, Record<string, unknown>>)["ui"]!["dark"]).toBe(true);
  });

  it("defineStore never clobbers a value already set (defaults only)", () => {
    const A = fakeAlpine();
    setAlpine(A);
    initClientStore(A);
    (A.store("flow") as Record<string, Record<string, unknown>>)["ui"] = { dark: true };
    defineStore({ ui: { dark: false, sidebar: true } });
    const s = A.store("flow") as Record<string, Record<string, unknown>>;
    expect(s["ui"]!["dark"]).toBe(true); // existing wins
    expect(s["ui"]!["sidebar"]).toBe(true); // missing default filled
  });

  it("clientStore() is a safe empty object before Alpine is ready", () => {
    expect(clientStore()).toEqual({});
  });
});
