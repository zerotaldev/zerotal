import { describe, it, expect } from "bun:test";
import { ConfigManager } from "@zerotal/core/config";
import { SocialConfig, validateSocialConfig } from "./config.ts";

const ctx = (isProduction: boolean) => ({
  namespace: "social",
  isProduction,
  config: new ConfigManager(),
});

const github = { clientId: "id", clientSecret: "secret", redirectUrl: "https://app.test/cb" };

describe("validateSocialConfig", () => {
  it("passes an empty config and a fully-credentialed provider", () => {
    expect(validateSocialConfig(undefined, ctx(true))).toEqual([]);
    expect(validateSocialConfig(SocialConfig(), ctx(true))).toEqual([]);
    expect(validateSocialConfig(SocialConfig({ github }), ctx(true))).toEqual([]);
  });

  it("flags empty credentials — the unset-env-var case", () => {
    const cfg = SocialConfig({
      github: { clientId: "", clientSecret: "", redirectUrl: "" },
    });
    const issues = validateSocialConfig(cfg, ctx(false)) ?? [];
    expect(issues).toHaveLength(3);
    expect(issues.every((i) => i.level === "error")).toBe(true);
    expect(issues.some((i) => i.message.includes("social.github.clientId"))).toBe(true);
    expect(issues.some((i) => i.message.includes("social.github.clientSecret"))).toBe(true);
    expect(issues.some((i) => i.message.includes("social.github.redirectUrl"))).toBe(true);
  });

  it("accepts Apple's teamId/keyId/privateKey in place of a client secret", () => {
    const apple = {
      clientId: "com.myapp.service",
      redirectUrl: "https://app.test/cb",
      teamId: "TEAM123456",
      keyId: "KEY1234567",
      privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    };
    expect(validateSocialConfig(SocialConfig({ apple }), ctx(true))).toEqual([]);

    const partial = SocialConfig({
      apple: { clientId: "com.myapp.service", redirectUrl: "https://app.test/cb", teamId: "T" },
    });
    const issues = validateSocialConfig(partial, ctx(false)) ?? [];
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("teamId/keyId/privateKey");
  });

  it("warns on an http:// callback in production only", () => {
    const cfg = SocialConfig({
      github: { ...github, redirectUrl: "http://app.test/cb" },
    });
    expect(validateSocialConfig(cfg, ctx(false))).toEqual([]);
    const issues = validateSocialConfig(cfg, ctx(true)) ?? [];
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe("warning");
    expect(issues[0]!.message).toContain("https://");
  });

  it("checks every configured provider, including custom keys", () => {
    const cfg = SocialConfig({
      github,
      keycloak: { clientId: "", clientSecret: "s", redirectUrl: "https://app.test/cb" },
    });
    const issues = validateSocialConfig(cfg, ctx(false)) ?? [];
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("social.keycloak.clientId");
  });
});
