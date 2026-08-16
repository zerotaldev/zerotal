import { describe, it, expect } from "bun:test";
import { analyseHeaders, splitFolded } from "./HeaderProbe.ts";

const URL_UNDER_TEST = "https://app.example.com/";

/** Build a Headers with `name` sent twice — what a proxy plus an app produces. */
function twice(name: string, first: string, second: string): Headers {
  const headers = new Headers();
  headers.append(name, first);
  headers.append(name, second);
  return headers;
}

const findingFor = (headers: Headers, header: string) =>
  analyseHeaders(URL_UNDER_TEST, headers).find((finding) => finding.header === header);

describe("splitFolded", () => {
  it("splits the comma-joined form fetch hands back", () => {
    expect(splitFolded("DENY, SAMEORIGIN")).toEqual(["DENY", "SAMEORIGIN"]);
  });

  it("drops empty segments and surrounding space", () => {
    expect(splitFolded(" nosniff , , nosniff ")).toEqual(["nosniff", "nosniff"]);
  });
});

describe("analyseHeaders", () => {
  it("says nothing about a clean response", () => {
    const headers = new Headers({
      "X-Frame-Options": "SAMEORIGIN",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    expect(analyseHeaders(URL_UNDER_TEST, headers)).toEqual([]);
  });

  it("fails a header sent twice with different values", () => {
    // The zerotal.dev deploy: DENY from the proxy, SAMEORIGIN from the app.
    // Browsers do not agree on which wins.
    const finding = findingFor(twice("X-Frame-Options", "DENY", "SAMEORIGIN"), "X-Frame-Options");
    expect(finding?.ok).toBe(false);
    expect(finding?.conflicting).toBe(true);
    expect(finding?.values).toEqual(["DENY", "SAMEORIGIN"]);
    expect(finding?.message).toContain("DENY / SAMEORIGIN");
    expect(finding?.fix).toContain("one place");
  });

  it("warns rather than fails when the duplicates agree", () => {
    const finding = findingFor(
      twice("X-Content-Type-Options", "nosniff", "nosniff"),
      "X-Content-Type-Options",
    );
    expect(finding?.ok).toBe(false);
    // Harmless right now, and a conflict as soon as one side is edited — so it
    // is worth saying, and not worth failing a deploy over.
    expect(finding?.conflicting).toBe(false);
  });

  it("treats a case difference as agreement, not conflict", () => {
    const finding = findingFor(twice("X-Frame-Options", "DENY", "deny"), "X-Frame-Options");
    expect(finding?.conflicting).toBe(false);
  });

  it("reports every duplicated header, not just the first", () => {
    const headers = new Headers();
    headers.append("X-Frame-Options", "DENY");
    headers.append("X-Frame-Options", "SAMEORIGIN");
    headers.append("Strict-Transport-Security", "max-age=31536000");
    headers.append("Strict-Transport-Security", "max-age=0");

    const findings = analyseHeaders(URL_UNDER_TEST, headers);
    expect(findings.map((finding) => finding.header).sort()).toEqual([
      "Strict-Transport-Security",
      "X-Frame-Options",
    ]);
    expect(findings.every((finding) => finding.conflicting)).toBe(true);
  });

  it("flags two CSPs, because a browser enforces their intersection", () => {
    const finding = findingFor(
      twice("Content-Security-Policy", "default-src 'self'", "script-src 'self' cdn.example.com"),
      "Content-Security-Policy",
    );
    expect(finding?.conflicting).toBe(true);
    expect(finding?.message).toContain("intersection");
  });

  it("leaves a single CSP alone, semicolons and all", () => {
    const headers = new Headers({
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; img-src *",
    });
    expect(analyseHeaders(URL_UNDER_TEST, headers)).toEqual([]);
  });

  /**
   * The restraint that keeps the check usable. `Permissions-Policy` and
   * `Referrer-Policy` both take comma-separated lists, so a duplicate is
   * indistinguishable from correct syntax. A probe that flagged a valid
   * `Permissions-Policy` would be switched off within a week — and then it would
   * not be there to catch the `X-Frame-Options` either.
   */
  it("does not mistake legitimate commas for duplication", () => {
    const headers = new Headers({
      "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
      "Referrer-Policy": "no-referrer, strict-origin-when-cross-origin",
    });
    expect(analyseHeaders(URL_UNDER_TEST, headers)).toEqual([]);
  });

  it("carries the url through, so a report can say which response it read", () => {
    const finding = findingFor(twice("X-Frame-Options", "DENY", "SAMEORIGIN"), "X-Frame-Options");
    expect(finding?.url).toBe(URL_UNDER_TEST);
  });
});
