import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _receiveUpload } from "./receive.ts";

/**
 * The upload endpoint used to call `request.formData()`, which buffers the whole body, and then
 * copy the file into another buffer to store it. It now streams the file part to disk.
 */

let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "zt-receive-test-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A multipart request whose body arrives `chunk` bytes at a time. */
async function upload(form: FormData, chunk = 7): Promise<Request> {
  const encoded = new Request("http://localhost/__flow/upload", { method: "POST", body: form });
  const type = encoded.headers.get("content-type")!;
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(bytes.slice(i, i + chunk));
      controller.close();
    },
  });
  return new Request("http://localhost/__flow/upload", {
    method: "POST",
    headers: { "content-type": type },
    body,
  });
}

function formWith(
  contents: string | Uint8Array<ArrayBuffer>,
  name = "notes.txt",
  type = "text/plain",
) {
  const form = new FormData();
  form.append("note", "a field before the file");
  form.append("file", new File([contents], name, { type }));
  form.append("after", "and one after");
  return form;
}

describe("receiving an upload", () => {
  it("writes the file part to disk, byte for byte, across chunk boundaries", async () => {
    const contents = new Uint8Array(5000).map((_, i) => (i * 31) % 256);
    for (const chunk of [1, 7, 64, 4096]) {
      const result = await _receiveUpload(
        await upload(formWith(contents, "pic.png", "image/png"), chunk),
        1_000_000,
        "file",
        dir,
      );
      if (!result.ok) throw new Error(result.error);
      expect(result.file.name).toBe("pic.png");
      expect(result.file.type).toBe("image/png");
      expect(result.file.size).toBe(contents.length);
      expect(new Uint8Array(await Bun.file(result.file.path).arrayBuffer())).toEqual(contents);
      await rm(result.file.path);
    }
  });

  it("keeps a file whose bytes look like the start of a boundary", async () => {
    const contents = "line\r\n--not-the-boundary\r\n--";
    const result = await _receiveUpload(await upload(formWith(contents)), 1000, "file", dir);
    if (!result.ok) throw new Error(result.error);
    expect(await Bun.file(result.file.path).text()).toBe(contents);
    await rm(result.file.path);
  });

  it("stops at the size limit and leaves nothing behind", async () => {
    const before = await readdir(dir);
    const result = await _receiveUpload(
      await upload(formWith("x".repeat(2000))),
      1000,
      "file",
      dir,
    );
    expect(result).toEqual({ ok: false, status: 422, error: "File exceeds the size limit." });
    expect(await readdir(dir)).toEqual(before);
  });

  it("answers 422 when there is no file, or it is empty", async () => {
    const none = new FormData();
    none.append("file", "just text, no filename");
    expect(await _receiveUpload(await upload(none), 1000, "file", dir)).toMatchObject({
      ok: false,
      status: 422,
    });
    expect(await _receiveUpload(await upload(formWith("")), 1000, "file", dir)).toMatchObject({
      ok: false,
      status: 422,
    });
  });

  it("answers 400 for a body that is not multipart, or is cut short", async () => {
    const json = new Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(await _receiveUpload(json, 1000, "file", dir)).toMatchObject({ status: 400 });

    const full = await upload(formWith("hello"));
    const type = full.headers.get("content-type")!;
    const bytes = new Uint8Array(await full.arrayBuffer());
    const truncated = new Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": type },
      body: bytes.slice(0, bytes.length - 20),
    });
    expect(await _receiveUpload(truncated, 1000, "file", dir)).toMatchObject({ status: 400 });
  });
});
