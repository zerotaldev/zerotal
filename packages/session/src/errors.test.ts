import { describe, it, expect } from "bun:test";
import { ZerotalError } from "@zerotal/core";
import { CookieDriver } from "./drivers/CookieDriver.ts";
import {
  SessionError,
  SessionSecretMissingError,
  SessionDriverMissingError,
  SessionCookieOverflowError,
} from "./errors.ts";

describe("session errors", () => {
  it("CookieDriver without a secret throws SessionSecretMissingError", () => {
    expect(() => new CookieDriver("")).toThrow(SessionSecretMissingError);
  });
  it("errors extend SessionError/ZerotalError with stable codes", () => {
    expect(new SessionSecretMissingError()).toBeInstanceOf(SessionError);
    expect(new SessionSecretMissingError()).toBeInstanceOf(ZerotalError);
    expect(new SessionSecretMissingError().code).toBe("E_SESSION_SECRET_MISSING");
    expect(new SessionDriverMissingError().code).toBe("E_SESSION_DRIVER_MISSING");
    expect(new SessionCookieOverflowError(5000, 4096).code).toBe("E_SESSION_COOKIE_OVERFLOW");
    expect(new SessionCookieOverflowError(5000, 4096)).toBeInstanceOf(SessionError);
  });
});
