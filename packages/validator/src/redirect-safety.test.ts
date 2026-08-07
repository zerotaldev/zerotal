import { describe, it, expect } from "bun:test";
import { safeRedirectPath } from "@zerotal/core";

/**
 * Regression guard for the open redirect in `validate()` and `FormRequest`.
 *
 * Both built their redirect-back target as `ctx.request.headers.get("Referer") ?? "/"` with no
 * origin check, while every other redirect in the framework routes through `safeRedirectPath`.
 * A GET route with a validation rule and `Referer: https://evil.example/` returned
 * `303 Location: https://evil.example/`. No CSRF token is involved, so a plain
 * `<a href="https://app.com/search">` on an attacker's page bounced the victim straight off-site
 * under the app's own domain — the standard primitive for making a phishing page look
 * legitimate.
 */
describe("Referer is origin-checked before being used as a redirect target", () => {
  const origin = "https://app.example";

  it("accepts a Referer on the app's own origin", () => {
    expect(safeRedirectPath("https://app.example/search?q=1", origin)).toBe(
      "https://app.example/search?q=1",
    );
  });

  it("rejects an off-origin Referer, so the caller falls back to '/'", () => {
    for (const evil of [
      "https://evil.example/",
      "http://app.example/", // scheme differs — different origin
      "https://app.example.evil.com/",
      "https://evil.example/app.example",
      "//evil.example/",
    ]) {
      const target = safeRedirectPath(evil, origin) ?? "/";
      expect(target).toBe("/");
    }
  });

  it("rejects a missing or unparseable Referer", () => {
    for (const value of [null, undefined, "", "not a url", "javascript:alert(1)"]) {
      expect(safeRedirectPath(value, origin) ?? "/").toBe("/");
    }
  });
});
