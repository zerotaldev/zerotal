/**
 * The security boundary, tested by consequence.
 *
 * 32 lines standing between a user's prompt and a log line that outlives the
 * request and gets shipped somewhere else. Small enough to look safe; the failure
 * here is silent and permanent, because a prompt that reached a log cannot be
 * unshipped.
 */
import { describe, it, expect } from "bun:test";
import { redactPrompt } from "./redact.ts";
import { AiConfig } from "./config.ts";

describe("redactPrompt — redaction on", () => {
  it("emits shape and no content", () => {
    const prompt = "Reset the password for ada@example.com";
    const out = redactPrompt(prompt, true);

    expect(out).toBe("[redacted 38 chars]");
    // The point of the test: nothing recognisable from the prompt survives.
    expect(out).not.toContain("ada@example.com");
    expect(out).not.toContain("password");
  });

  it("reports the real length, not the truncated one", () => {
    // The count is the whole diagnostic value of a redacted row — a wrong one is
    // worse than none, because it reads as information.
    for (const n of [0, 1, 199, 200, 201, 40_000]) {
      expect(redactPrompt("x".repeat(n), true)).toBe(`[redacted ${n} chars]`);
    }
  });

  it("leaks nothing from a prompt that is entirely one secret", () => {
    const secret = "sk-ant-api03-abcdefghijklmnop";
    expect(redactPrompt(secret, true)).not.toContain("sk-ant");
  });

  it("says something sane for an empty prompt", () => {
    // Not "[redacted  chars]" or "[redacted undefined chars]" — either reads as a
    // bug in the framework rather than as an empty prompt.
    expect(redactPrompt("", true)).toBe("[redacted 0 chars]");
  });

  it("does not let a multi-byte prompt disagree with itself", () => {
    // `.length` is UTF-16 units. The number just has to be stable and honest about
    // the string it was given, not a byte count that surprises someone.
    const prompt = "café 🎉";
    expect(redactPrompt(prompt, true)).toBe(`[redacted ${prompt.length} chars]`);
  });
});

describe("redactPrompt — redaction off", () => {
  it("truncates at 200 characters", () => {
    const preview = redactPrompt("x".repeat(500), false);

    // 200 kept plus the ellipsis. A 40 KB system prompt on every monitor row is
    // its own problem, which is why "off" still truncates.
    expect(preview).toHaveLength(201);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("leaves a short prompt exactly as it was, with no ellipsis", () => {
    expect(redactPrompt("hello", false)).toBe("hello");
  });

  it("does not add an ellipsis at exactly the limit", () => {
    const exact = "x".repeat(200);
    expect(redactPrompt(exact, false)).toBe(exact);
  });
});

describe("the default", () => {
  it("is on", () => {
    // The one assertion here that is about policy rather than behaviour. A prompt
    // in a log cannot be recalled, so the default has to be the safe one — and a
    // default that silently flips is the kind of regression nobody notices until
    // the logs are already elsewhere.
    expect(AiConfig({ drivers: {} }).redact).toBe(true);
  });
});
