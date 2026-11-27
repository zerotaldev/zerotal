import { describe, it, expect, beforeAll } from "bun:test";
import { HttpContext, RequestContext } from "@zerotal/core";
import {
  makeSignedRef,
  isUploadRef,
  resolveUploadValue,
  TemporaryUploadedFile,
} from "./TemporaryUploadedFile.ts";

beforeAll(() => {
  // Signing requires APP_KEY.
  (Bun.env as Record<string, string>)["APP_KEY"] = "test-app-key-for-uploads";
});

/** Run `fn` as a request from user `id`, which is how `$set` resolves a ref. */
function asUser<T>(id: number, fn: () => T): T {
  const ctx = HttpContext.fake("http://localhost/");
  Reflect.set(ctx, "user", { id });
  return RequestContext.run(ctx, fn);
}

const data = {
  tmpPath: "flow-tmp/abc.pdf",
  originalName: "notes.pdf",
  mime: "application/pdf",
  size: 1234,
};

describe("upload references", () => {
  it("makeSignedRef → isUploadRef → fromSignedRef round-trips", () => {
    const ref = makeSignedRef(data, { sub: "7" });
    expect(isUploadRef(ref)).toBe(true);
    const tuf = TemporaryUploadedFile.fromSignedRef(ref, "7");
    expect(tuf).not.toBeNull();
    expect(tuf!.name).toBe("notes.pdf");
    expect(tuf!.extension()).toBe("pdf");
    expect(tuf!.isImage()).toBe(false);
  });

  it("rejects a tampered reference (bad signature → null)", () => {
    const ref = makeSignedRef(data, { sub: "7" });
    const forged = { ...ref, tmpPath: "flow-tmp/evil.pdf" };
    expect(TemporaryUploadedFile.fromSignedRef(forged, "7")).toBeNull();
  });

  it("rejects a tampered originalName (extension is signed → null)", () => {
    const ref = makeSignedRef(data, { sub: "7" });
    // Same valid signature, but the filename (and thus store() extension) swapped.
    const forged = { ...ref, originalName: "notes.html" };
    expect(TemporaryUploadedFile.fromSignedRef(forged, "7")).toBeNull();
  });

  it("rejects a tampered tempDisk (disk selection is signed → null)", () => {
    const ref = makeSignedRef(data, { sub: "7" });
    // Redirecting reads/writes to another disk must invalidate the signature.
    const forged = { ...ref, tempDisk: "s3" };
    expect(TemporaryUploadedFile.fromSignedRef(forged, "7")).toBeNull();
  });

  it("extension() strips unsafe characters from the name", () => {
    const ref = makeSignedRef(
      { ...data, tmpPath: "flow-tmp/x", originalName: "a.p h p!" },
      { sub: "7" },
    );
    const tuf = TemporaryUploadedFile.fromSignedRef(ref, "7");
    expect(tuf!.extension()).toBe("php");
  });

  it("resolveUploadValue wraps a single ref, passes plain values through", () => {
    const ref = makeSignedRef(data, { sub: "7" });
    expect(asUser(7, () => resolveUploadValue(ref))).toBeInstanceOf(TemporaryUploadedFile);
    expect(resolveUploadValue("just a string")).toBe("just a string");
    expect(resolveUploadValue(42)).toBe(42);
  });

  it("resolveUploadValue handles arrays (multiple files), dropping forged ones", () => {
    const good = makeSignedRef(
      { ...data, tmpPath: "flow-tmp/a.png", mime: "image/png" },
      { sub: "7" },
    );
    const forged = { ...makeSignedRef(data, { sub: "7" }), tmpPath: "flow-tmp/x.exe" };
    const out = asUser(7, () => resolveUploadValue([good, forged])) as unknown[];
    expect(out.length).toBe(1);
    expect(out[0]).toBeInstanceOf(TemporaryUploadedFile);
  });

  it("is issued to the signed-in user, and refused on another user's $set", () => {
    const ref = asUser(7, () => makeSignedRef(data));
    expect(ref.sub).toBe("7");
    expect(asUser(7, () => resolveUploadValue(ref))).toBeInstanceOf(TemporaryUploadedFile);
    expect(asUser(8, () => resolveUploadValue(ref))).toBeNull();
    expect(resolveUploadValue(ref)).toBeNull(); // a guest
  });

  it("refuses a tampered owner (sub is signed → null)", () => {
    const ref = makeSignedRef(data, { sub: "7" });
    expect(TemporaryUploadedFile.fromSignedRef({ ...ref, sub: "8" }, "8")).toBeNull();
  });

  it("expires, and the expiry is signed", () => {
    const expired = makeSignedRef(data, { sub: "7", ttlSeconds: -1 });
    expect(TemporaryUploadedFile.fromSignedRef(expired, "7")).toBeNull();
    const extended = { ...expired, exp: expired.exp + 3600 };
    expect(TemporaryUploadedFile.fromSignedRef(extended, "7")).toBeNull();
  });

  it("refuses a 1.18 reference with no owner or expiry", () => {
    const { sub: _sub, exp: _exp, ...old } = makeSignedRef(data, { sub: "7" });
    expect(isUploadRef(old)).toBe(true);
    expect(TemporaryUploadedFile.fromSignedRef(old as never, "7")).toBeNull();
  });

  it("cannot be issued without a user", () => {
    expect(() => makeSignedRef(data)).toThrow(/signed-in user/);
  });

  it("trusted ref (from snapshot) rebuilds without a signature", () => {
    const tuf = TemporaryUploadedFile.fromTrustedRef(data);
    expect(tuf.toRef()).toEqual(data);
  });
});
