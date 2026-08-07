import { describe, it, expect } from "bun:test";
import { ZerotalError } from "@zerotal/core";
import { CacheManager } from "./CacheManager.ts";
import { CacheError, CacheSerializationError, CacheDeserializationError } from "./errors.ts";
import type { CacheDriver } from "./drivers/CacheDriver.ts";

const fake = (raw: string | null = null): CacheDriver =>
  ({
    async get() {
      return raw;
    },
    async set() {},
    async del() {},
    async has() {
      return false;
    },
    async flush() {},
    async increment() {
      return 0;
    },
    async decrement() {
      return 0;
    },
  }) as unknown as CacheDriver;

describe("cache errors", () => {
  it("throws CacheSerializationError for an unserializable value", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const m = new CacheManager(fake());
    await expect(m.set("k", circular)).rejects.toBeInstanceOf(CacheSerializationError);
  });
  it("throws CacheDeserializationError for a corrupt cached value", async () => {
    const m = new CacheManager(fake("{not json"));
    await expect(m.get("k")).rejects.toBeInstanceOf(CacheDeserializationError);
  });
  it("errors extend CacheError and ZerotalError with stable codes", () => {
    const e = new CacheSerializationError("k", new Error("x"));
    expect(e).toBeInstanceOf(CacheError);
    expect(e).toBeInstanceOf(ZerotalError);
    expect(e.code).toBe("E_CACHE_SERIALIZATION");
    expect(new CacheDeserializationError("k", null).code).toBe("E_CACHE_DESERIALIZATION");
  });
});
