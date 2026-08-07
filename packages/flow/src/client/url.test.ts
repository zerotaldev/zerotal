import { describe, it, expect } from "bun:test";
import { buildUrlWithQuery } from "./url.ts";

const BASE = "https://app.test/users?search=john&status=active&page=2";

describe("buildUrlWithQuery", () => {
  it("updates an existing query param and preserves the rest", () => {
    expect(buildUrlWithQuery(BASE, { query: { page: 3 } })).toBe(
      "https://app.test/users?search=john&status=active&page=3",
    );
  });

  it("adds a new query param", () => {
    expect(buildUrlWithQuery(BASE, { query: { sort: "name" } })).toBe(
      "https://app.test/users?search=john&status=active&page=2&sort=name",
    );
  });

  it("removes params with null / undefined / empty-string values", () => {
    expect(buildUrlWithQuery(BASE, { query: { status: null } })).toBe(
      "https://app.test/users?search=john&page=2",
    );
    expect(buildUrlWithQuery(BASE, { query: { status: undefined } })).toBe(
      "https://app.test/users?search=john&page=2",
    );
    expect(buildUrlWithQuery(BASE, { query: { search: "" } })).toBe(
      "https://app.test/users?status=active&page=2",
    );
  });

  it("mixes add / update / remove in one call", () => {
    expect(buildUrlWithQuery(BASE, { query: { search: "", page: 1, sort: "name" } })).toBe(
      "https://app.test/users?status=active&page=1&sort=name",
    );
  });

  it("stringifies non-string values", () => {
    expect(buildUrlWithQuery(BASE, { query: { page: 0, active: false } })).toBe(
      "https://app.test/users?search=john&status=active&page=0&active=false",
    );
  });

  it("does not treat 0 or false as removal", () => {
    const url = new URL(buildUrlWithQuery(BASE, { query: { page: 0 } }));
    expect(url.searchParams.get("page")).toBe("0");
  });

  it("sets and clears the hash", () => {
    expect(buildUrlWithQuery(BASE, { hash: "section-2" })).toBe(`${BASE}#section-2`);
    expect(buildUrlWithQuery(`${BASE}#old`, { hash: "" })).toBe(BASE);
  });

  it("leaves the hash untouched when omitted", () => {
    expect(buildUrlWithQuery(`${BASE}#keep`, { query: { page: 5 } })).toBe(
      "https://app.test/users?search=john&status=active&page=5#keep",
    );
  });

  it("returns the base URL unchanged with no options", () => {
    expect(buildUrlWithQuery(BASE)).toBe(BASE);
  });
});
