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

  it("accepts a from address written as 'Name <address>'", () => {
    for (const address of ["App <app@test.local>", '"App, Inc." <app@test.local>']) {
      expect(() => NotificationConfig({ mail: { from: { address, name: "X" } } })).not.toThrow();
    }
  });

  it("rejects 'Name <address>' whose address is not an address", () => {
    expect(() =>
      NotificationConfig({ mail: { from: { address: "App <nope>", name: "X" } } }),
    ).toThrow("is not an email address");
  });

  it("rejects at boot a from address that every send would refuse", () => {
    for (const address of [
      "app@test.local\r\nRSET",
      " app@test.local",
      "App <app@test.local\r\nRSET>",
      "App\r\nBcc: spy@test.local <app@test.local>",
      "App <app@test.local",
      "App <<app@test.local>>",
    ]) {
      let caught: unknown;
      try {
        NotificationConfig({ mail: { from: { address, name: "X" } } });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(NotificationConfigError);
      expect((caught as Error).message).toContain("mail.from.address");
      expect((caught as Error).message).not.toMatch(/[\r\n]/);
    }
  });

  it("rejects at boot a from name with a line break, naming mail.from.name", () => {
    const breaks = ["\r\n", "\n", ...[0x85, 0x2028, 0x2029].map((c) => String.fromCharCode(c))];
    for (const lineBreak of breaks) {
      let caught: unknown;
      try {
        NotificationConfig({
          mail: { from: { address: "app@test.local", name: `App${lineBreak}Bcc: spy@test.local` } },
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(NotificationConfigError);
      expect((caught as Error).message).toContain("mail.from.name");
      expect((caught as Error).message).not.toContain("mail.from.address");
      expect((caught as Error).message).not.toContain("spy@test.local");
    }
  });

  it("accepts a from name with quotes, a comma or angle brackets", () => {
    expect(() =>
      NotificationConfig({
        mail: { from: { address: "app@test.local", name: 'Acme "Billing", <Support>' } },
      }),
    ).not.toThrow();
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
