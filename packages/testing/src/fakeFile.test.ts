import { describe, it, expect } from "bun:test";
import { UploadedFile } from "@zerotal/core/http";
import { fakeFile } from "./fakeFile.ts";

/** Read the leading bytes of a File. */
async function head(file: File, n: number): Promise<number[]> {
  return [...new Uint8Array(await file.slice(0, n).arrayBuffer())];
}

describe("fakeFile", () => {
  it("create() carries the exact contents and declared type", async () => {
    const file = fakeFile.create("rows.csv", "a,b\n1,2", "text/csv");

    expect(file.name).toBe("rows.csv");
    expect(file.type).toBe("text/csv");
    expect(await file.text()).toBe("a,b\n1,2");
  });

  it("sized() produces a file of exactly that many bytes", () => {
    expect(fakeFile.sized("big.bin", 4096).size).toBe(4096);
  });

  it("image() writes a real PNG signature", async () => {
    expect(await head(fakeFile.image(), 8)).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });

  it("image() encodes the requested dimensions in the IHDR", async () => {
    const bytes = new Uint8Array(
      await fakeFile.image("a.png", { width: 64, height: 32 }).arrayBuffer(),
    );
    // IHDR data starts at byte 16: 8-byte signature + 4 length + 4 type.
    const view = new DataView(bytes.buffer, 16, 8);
    expect(view.getUint32(0)).toBe(64);
    expect(view.getUint32(4)).toBe(32);
  });

  it("builds files the framework's own sniffing recognises", async () => {
    // This is the point of building real bytes: `UploadedFile.store()` names and
    // types a file from what it sniffs, never from what the upload claimed.
    const cases: Array<[File, string]> = [
      [fakeFile.image("a.png"), "image/png"],
      [fakeFile.jpeg("a.jpg"), "image/jpeg"],
      [fakeFile.gif("a.gif"), "image/gif"],
      [fakeFile.pdf("a.pdf"), "application/pdf"],
    ];

    for (const [file, expected] of cases) {
      const detected = await new UploadedFile(file).detectType();
      expect(detected.contentType).toBe(expected);
      expect(detected.recognised).toBe(true);
    }
  });

  it("a placeholder of empty bytes is NOT recognised — which is why these are real", async () => {
    const detected = await new UploadedFile(fakeFile.sized("fake.png", 128)).detectType();
    expect(detected.recognised).toBe(false);
  });
});

describe("UploadedFile.fake()", () => {
  it("reports the declared name, type, and size", () => {
    const file = UploadedFile.fake("avatar.png", { type: "image/png", size: 1024 });

    expect(file.originalName).toBe("avatar.png");
    expect(file.mimeType).toBe("image/png");
    expect(file.size).toBe(1024);
    expect(file.extension()).toBe("png");
  });

  it("satisfies the validation rules it was built to satisfy", () => {
    const file = UploadedFile.fake("a.png", { type: "image/png", size: 1024 });

    expect(file.isValid({ maxSize: 2048, mimes: ["image/png"] })).toBe(true);
    expect(file.isValid({ maxSize: 512 })).toBe(false);
    expect(file.isValid({ mimes: ["image/jpeg"] })).toBe(false);
  });

  it("accepts explicit content, including a real file from fakeFile", async () => {
    const withText = UploadedFile.fake("a.txt", { content: "hello" });
    expect(await withText.text()).toBe("hello");

    const withReal = UploadedFile.fake("a.png", { content: fakeFile.image("a.png") });
    expect((await withReal.detectType()).contentType).toBe("image/png");
  });
});
