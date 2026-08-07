import { describe, it, expect } from "bun:test";
import { NotificationConfig, validateNotificationConfig } from "./config.ts";
import { NotificationConfigError } from "./errors.ts";

describe("NotificationConfig — defaults", () => {
  it("works with no arguments", () => {
    const cfg = NotificationConfig();
    expect(cfg.database.table).toBe("notifications");
    expect(cfg.mail.driver).toBe("log");
  });

  it("merges partial overrides", () => {
    const cfg = NotificationConfig({ database: { table: "user_notifications" } });
    expect(cfg.database.table).toBe("user_notifications");
    expect(cfg.mail.driver).toBe("log");
  });
});

describe("validateNotificationConfig", () => {
  it("rejects an unknown mail driver", () => {
    expect(() => NotificationConfig({ mail: { driver: "carrier-pigeon" as never } })).toThrow(
      NotificationConfigError,
    );
  });

  it("rejects the resend driver without an api key", () => {
    expect(() => NotificationConfig({ mail: { driver: "resend" } })).toThrow(
      "mail.resend.apiKey is empty",
    );
  });

  it("accepts the resend driver with a key", () => {
    expect(() =>
      NotificationConfig({ mail: { driver: "resend", resend: { apiKey: "re_123" } } }),
    ).not.toThrow();
  });

  it("rejects the smtp driver without a host", () => {
    expect(() => NotificationConfig({ mail: { driver: "smtp", smtp: { host: "" } } })).toThrow(
      "mail.smtp.host is empty",
    );
  });

  it("rejects a username with no password", () => {
    expect(() =>
      NotificationConfig({
        mail: { driver: "smtp", smtp: { host: "mail.test", username: "u", password: "" } },
      }),
    ).toThrow("mail.smtp.password is empty");
  });

  it("rejects a from address that is not an address", () => {
    expect(() => NotificationConfig({ mail: { from: { address: "nope", name: "X" } } })).toThrow(
      "is not an email address",
    );
  });

  it("rejects twilio without its credential block", () => {
    expect(() => NotificationConfig({ sms: { driver: "twilio" } })).toThrow(
      "sms.twilio is missing",
    );
  });

  it("rejects vonage without its credential block", () => {
    expect(() => NotificationConfig({ sms: { driver: "vonage" } })).toThrow(
      "sms.vonage is missing",
    );
  });

  it("rejects an unknown sms driver", () => {
    expect(() => NotificationConfig({ sms: { driver: "smoke-signal" as never } })).toThrow(
      "Unknown SMS driver",
    );
  });

  it("accepts a fully specified sms block", () => {
    expect(() =>
      NotificationConfig({
        sms: {
          driver: "twilio",
          twilio: { accountSid: "AC", authToken: "t", from: "+15550000000" },
        },
      }),
    ).not.toThrow();
  });

  it("is exported for validating a config built elsewhere", () => {
    const cfg = NotificationConfig();
    cfg.mail.driver = "resend";
    expect(() => validateNotificationConfig(cfg)).toThrow(NotificationConfigError);
  });
});
