import { describe, it, expect } from "bun:test";
import { ClientProvider, Client } from "./provider/ClientProvider.ts";
import { ClientConfig } from "./config.ts";
import { ApiClient } from "./ApiClient.ts";

// ── ClientConfig ──────────────────────────────────────────────────────────────

describe("ClientConfig", () => {
  it("returns a fresh, deep-equal copy of the options (not the same reference)", () => {
    const opts = { baseUrl: "https://api.example.com", headers: { "X-Foo": "bar" } };
    const result = ClientConfig(opts);
    expect(result).toEqual(opts);
    expect(result).not.toBe(opts);
  });

  it("accepts empty options", () => {
    expect(ClientConfig({})).toEqual({});
  });

  it("preserves all ApiClientConfig fields", () => {
    const onError = () => {};
    const opts = { baseUrl: "/api", headers: { Auth: "x" }, onError };
    const result = ClientConfig(opts);
    expect(result.baseUrl).toBe("/api");
    expect(result.onError).toBe(onError);
  });
});

// ── Client facade export ──────────────────────────────────────────────────────

describe("Client facade", () => {
  it("is exported from ClientProvider", () => {
    // createFacade returns an object; just assert it exists
    expect(Client).toBeDefined();
  });
});

// ── ClientProvider ────────────────────────────────────────────────────────────

function makeProvider(singleton: (name: string, factory: (c: unknown) => unknown) => void) {
  const mockApp = { container: { singleton } };
  return new (ClientProvider as unknown as new (app: unknown) => ClientProvider)(mockApp);
}

describe("ClientProvider", () => {
  it('onRegister() registers a "client" singleton', () => {
    let registeredName = "";
    const provider = makeProvider((name) => {
      registeredName = name;
    });
    provider.onRegister();
    expect(registeredName).toBe("client");
  });

  it("singleton factory creates an ApiClient from config", async () => {
    let factory!: (c: unknown) => Promise<unknown>;
    const provider = makeProvider((_, f) => {
      factory = f as typeof factory;
    });
    provider.onRegister();

    const mockConfig = { get: (_path: string) => ({ baseUrl: "/api" }) };
    const mockContainer = { make: async () => mockConfig };

    const client = await factory(mockContainer);
    expect(client).toBeInstanceOf(ApiClient);
  });

  it("singleton factory falls back to {} when config returns undefined", async () => {
    let factory!: (c: unknown) => Promise<unknown>;
    const provider = makeProvider((_, f) => {
      factory = f as typeof factory;
    });
    provider.onRegister();

    const mockConfig = { get: () => undefined };
    const mockContainer = { make: async () => mockConfig };

    const client = await factory(mockContainer);
    expect(client).toBeInstanceOf(ApiClient);
  });
});
