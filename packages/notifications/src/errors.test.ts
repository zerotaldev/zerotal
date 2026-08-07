import { describe, it, expect } from "bun:test";
import { ZerotalError } from "@zerotal/core";
import {
  NotificationError,
  UnknownNotificationChannelError,
  NotificationChannelNotConfiguredError,
} from "./errors.ts";

describe("notifications errors", () => {
  it("extend NotificationError/ZerotalError with stable codes", () => {
    const u = new UnknownNotificationChannelError("telepathy");
    const c = new NotificationChannelNotConfiguredError("slack", "Add slack config.");
    for (const e of [u, c]) {
      expect(e).toBeInstanceOf(NotificationError);
      expect(e).toBeInstanceOf(ZerotalError);
    }
    expect(u.code).toBe("E_NOTIFICATION_UNKNOWN_CHANNEL");
    expect(u.message).toContain("telepathy");
    expect(c.code).toBe("E_NOTIFICATION_CHANNEL_NOT_CONFIGURED");
    expect(c.message).toContain("Add slack config.");
  });
});
