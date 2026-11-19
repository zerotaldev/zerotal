/**
 * The publisher's report of how each package authenticated.
 *
 * The npm token is deleted on the strength of this report, so it has to be
 * wrong in the safe direction: a publish counts as trusted publishing only when
 * npm said the exchange succeeded, never because nothing said otherwise.
 *
 * The log lines are the ones npm 11's `lib/utils/oidc.js` writes.
 */
import { describe, it, expect } from "bun:test";
import {
  canAuthenticate,
  describeAuthEnvironment,
  readPublishLog,
  supportsTrustedPublishing,
} from "./publish-auth.ts";

const NOTICE =
  "npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access";

describe("readPublishLog", () => {
  it("reports trusted publishing when the exchange succeeded", () => {
    const log = readPublishLog(
      [
        "npm verbose cli /usr/local/bin/node /usr/local/bin/npm",
        "npm http fetch POST 201 https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/@zerotal%2fcore 210ms",
        "npm verbose oidc Successfully retrieved and set token",
        NOTICE,
      ].join("\n"),
    );
    expect(log.auth).toEqual({ kind: "trusted-publishing" });
  });

  it("reports the token, with npm's reason, when the exchange failed", () => {
    const log = readPublishLog(
      [
        "npm verbose oidc Failed token exchange request with body message: no trusted publisher configured",
        NOTICE,
      ].join("\n"),
    );
    expect(log.auth).toEqual({
      kind: "token",
      reason: "Failed token exchange request with body message: no trusted publisher configured",
    });
  });

  it("reports the token when npm never tried", () => {
    // npm 10, or a job without id-token: write: no oidc line at all.
    expect(readPublishLog(NOTICE).auth).toEqual({
      kind: "token",
      reason: "npm did not attempt an OIDC exchange",
    });
  });

  it("keeps the exchange when only provenance set-up failed after it", () => {
    const log = readPublishLog(
      [
        "npm verbose oidc Successfully retrieved and set token",
        "npm verbose oidc Failed to set provenance with message: 404",
      ].join("\n"),
    );
    expect(log.auth.kind).toBe("trusted-publishing");
  });

  it("shows npm's normal output and drops the verbose detail", () => {
    const log = readPublishLog(
      [
        "npm verbose title npm publish",
        "npm info using npm@11.6.1",
        "npm http fetch GET 200 https://registry.npmjs.org/@zerotal%2fcore 80ms",
        "npm verbose oidc Successfully retrieved and set token",
        NOTICE,
        "npm error code E403",
        "",
      ].join("\n"),
    );
    expect(log.shown).toEqual([NOTICE, "npm error code E403"]);
  });

  it("reads coloured output", () => {
    const log = readPublishLog(
      "\x1b[34mnpm\x1b[39m verbose oidc Successfully retrieved and set token",
    );
    // Colour is stripped for matching only; a coloured line never reaches `shown` here
    // because it is verbose detail.
    expect(log.auth.kind).toBe("trusted-publishing");
    expect(log.shown).toEqual([]);
  });
});

describe("supportsTrustedPublishing", () => {
  it("starts at npm 11.5.1", () => {
    expect(supportsTrustedPublishing("10.9.4")).toBe(false);
    expect(supportsTrustedPublishing("11.5.0")).toBe(false);
    expect(supportsTrustedPublishing("11.5.1")).toBe(true);
    expect(supportsTrustedPublishing("11.6.1")).toBe(true);
  });
});

describe("the auth environment", () => {
  it("can publish with a token on any npm", () => {
    const env = { npmVersion: "10.9.4", hasToken: true, hasIdToken: false };
    expect(canAuthenticate(env)).toBe(true);
    expect(describeAuthEnvironment(env)).toBe(
      "npm 10.9.4 predates trusted publishing (11.5.1); NODE_AUTH_TOKEN is set",
    );
  });

  it("can publish without a token only through trusted publishing", () => {
    expect(canAuthenticate({ npmVersion: "11.6.1", hasToken: false, hasIdToken: true })).toBe(true);
    expect(canAuthenticate({ npmVersion: "10.9.4", hasToken: false, hasIdToken: true })).toBe(
      false,
    );
    expect(canAuthenticate({ npmVersion: "11.6.1", hasToken: false, hasIdToken: false })).toBe(
      false,
    );
    expect(canAuthenticate({ npmVersion: undefined, hasToken: false, hasIdToken: true })).toBe(
      false,
    );
  });

  it("says when the job has no OIDC token", () => {
    expect(
      describeAuthEnvironment({ npmVersion: "11.6.1", hasToken: false, hasIdToken: false }),
    ).toBe("npm 11.6.1: no OIDC token (the job needs id-token: write); NODE_AUTH_TOKEN is not set");
  });
});
