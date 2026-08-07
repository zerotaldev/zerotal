import { describe, it, expect, beforeAll } from "bun:test";
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

const data = {
  tmpPath: "flow-tmp/abc.pdf",
  originalName: "notes.pdf",
  mime: "application/pdf",
  size: 1234,
};

describe("upload references", () => {
  it("makeSignedRef → isUploadRef → fromSignedRef round-trips", () => {
    const ref = makeSignedRef(data);
    expect(isUploadRef(ref)).toBe(true);
    const tuf = TemporaryUploadedFile.fromSignedRef(ref);
    expect(tuf).not.toBeNull();
    expect(tuf!.name).toBe("notes.pdf");
    expect(tuf!.extension()).toBe("pdf");
    expect(tuf!.isImage()).toBe(false);
  });

  it("rejects a tampered reference (bad signature → null)", () => {
    const ref = makeSignedRef(data);
    const forged = { ...ref, tmpPath: "flow-tmp/evil.pdf" };
    expect(TemporaryUploadedFile.fromSignedRef(forged)).toBeNull();
  });

  it("rejects a tampered originalName (extension is signed → null)", () => {
    const ref = makeSignedRef(data);
    // Same valid signature, but the filename (and thus store() extension) swapped.
    const forged = { ...ref, originalName: "notes.html" };
    expect(TemporaryUploadedFile.fromSignedRef(forged)).toBeNull();
  });

  it("rejects a tampered tempDisk (disk selection is signed → null)", () => {
    const ref = makeSignedRef(data);
    // Redirecting reads/writes to another disk must invalidate the signature.
    const forged = { ...ref, tempDisk: "s3" };
    expect(TemporaryUploadedFile.fromSignedRef(forged)).toBeNull();
  });

  it("extension() strips unsafe characters from the name", () => {
    const ref = makeSignedRef({ ...data, tmpPath: "flow-tmp/x", originalName: "a.p h p!" });
    const tuf = TemporaryUploadedFile.fromSignedRef(ref);
    expect(tuf!.extension()).toBe("php");
  });

  it("resolveUploadValue wraps a single ref, passes plain values through", () => {
    const ref = makeSignedRef(data);
    expect(resolveUploadValue(ref)).toBeInstanceOf(TemporaryUploadedFile);
    expect(resolveUploadValue("just a string")).toBe("just a string");
    expect(resolveUploadValue(42)).toBe(42);
  });

  it("resolveUploadValue handles arrays (multiple files), dropping forged ones", () => {
    const good = makeSignedRef({ ...data, tmpPath: "flow-tmp/a.png", mime: "image/png" });
    const forged = { ...makeSignedRef(data), tmpPath: "flow-tmp/x.exe" };
    const out = resolveUploadValue([good, forged]) as unknown[];
    expect(out.length).toBe(1);
    expect(out[0]).toBeInstanceOf(TemporaryUploadedFile);
  });

  it("trusted ref (from snapshot) rebuilds without a signature", () => {
    const tuf = TemporaryUploadedFile.fromTrustedRef(data);
    expect(tuf.toRef()).toEqual(data);
  });
});
