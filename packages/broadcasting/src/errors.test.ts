import { describe, it, expect } from "bun:test";
import { ZerotalError } from "@zerotal/core";
import {
  BroadcastError,
  BroadcastProviderNotRegisteredError,
  MissingChannelParameterError,
} from "./errors.ts";

describe("broadcasting errors", () => {
  it("extend BroadcastError/ZerotalError with stable codes", () => {
    const a = new BroadcastProviderNotRegisteredError();
    const b = new MissingChannelParameterError("userId");
    for (const e of [a, b]) {
      expect(e).toBeInstanceOf(BroadcastError);
      expect(e).toBeInstanceOf(ZerotalError);
    }
    expect(a.code).toBe("E_BROADCAST_NOT_REGISTERED");
    expect(b.code).toBe("E_BROADCAST_MISSING_PARAM");
    expect(b.message).toContain("userId");
  });
});
