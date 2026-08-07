import { describe, it, expect } from "bun:test";
import { URLSigner } from "./URLSigner.ts";

// The high-level `Url.sign()/verify()` facade (which derives the secret from APP_KEY)
// is tested in ../http/url.test.ts. This file covers the low-level signer primitive.

describe("URLSigner", () => {
  const SECRET = "test-secret-key-32-chars-long!!";

  it("throws when constructed with an empty secret", () => {
    expect(() => new URLSigner("")).toThrow("[URLSigner]");
  });

  it("sign() returns a URL with signature and expires params", () => {
    const signer = new URLSigner(SECRET);
    const url = signer.sign("https://example.com/verify", { email: "a@b.com" });
    const parsed = new URL(url);
    expect(parsed.searchParams.has("signature")).toBe(true);
    expect(parsed.searchParams.has("expires")).toBe(true);
    expect(parsed.searchParams.get("email")).toBe("a@b.com");
  });

  it("verify() returns true for a fresh signed URL", () => {
    const signer = new URLSigner(SECRET);
    const url = signer.sign("https://example.com/verify", { email: "x@y.com" }, 60);
    expect(signer.verify(url)).toBe(true);
  });

  it("verify() returns false for a tampered signature", () => {
    const signer = new URLSigner(SECRET);
    const url = signer.sign("https://example.com/v");
    const tampered = url.replace(/signature=[a-f0-9]+/, "signature=deadbeef00");
    expect(signer.verify(tampered)).toBe(false);
  });

  it("verify() returns false for an expired URL", () => {
    const signer = new URLSigner(SECRET);
    const url = signer.sign("https://example.com/v", {}, -1);
    expect(signer.verify(url)).toBe(false);
  });

  it("verify() returns false when signature param is missing", () => {
    const signer = new URLSigner(SECRET);
    const url = signer.sign("https://example.com/v");
    const noSig = url.replace(/&?signature=[^&]+/, "");
    expect(signer.verify(noSig)).toBe(false);
  });

  it("verify() returns false for a completely invalid URL", () => {
    const signer = new URLSigner(SECRET);
    expect(signer.verify("not-a-url")).toBe(false);
  });

  it("verify() is order-independent for extra query params", () => {
    const signer = new URLSigner(SECRET);
    const url = new URL(signer.sign("https://example.com/v", { b: "2", a: "1" }));
    expect(signer.verify(url.toString())).toBe(true);
  });

  it("different secrets produce different signatures", () => {
    const a = new URLSigner("secret-a");
    const b = new URLSigner("secret-b");
    const url = a.sign("https://example.com/v");
    expect(b.verify(url)).toBe(false);
  });
});
