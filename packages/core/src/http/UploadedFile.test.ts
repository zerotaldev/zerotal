import { describe, it, expect } from "bun:test";
import { UploadedFile } from "./UploadedFile.ts";
import { HttpContext } from "../pipeline/HttpContext.ts";

// ── Helper ────────────────────────────────────────────────────────────────────

function makeFile(name: string, content: string, type = "text/plain"): File {
  return new File([content], name, { type });
}

function multipartRequest(fields: Record<string, string | File>): Request {
  const fd = new FormData();
  for (const [key, val] of Object.entries(fields)) fd.append(key, val);
  return new Request("http://localhost/upload", { method: "POST", body: fd });
}

// ── UploadedFile: properties ──────────────────────────────────────────────────

describe("UploadedFile — properties", () => {
  it("exposes originalName, mimeType, size", () => {
    const f = new UploadedFile(makeFile("photo.jpg", "fake-jpeg", "image/jpeg"));
    expect(f.originalName).toBe("photo.jpg");
    expect(f.mimeType).toBe("image/jpeg");
    expect(f.size).toBe(9); // 'fake-jpeg'.length
  });

  it("extension() returns lowercase extension without dot", () => {
    expect(new UploadedFile(makeFile("Report.PDF", "x", "application/pdf")).extension()).toBe(
      "pdf",
    );
    expect(new UploadedFile(makeFile("avatar.PNG", "x", "image/png")).extension()).toBe("png");
    expect(new UploadedFile(makeFile("noext", "x")).extension()).toBe("");
  });
});

// ── UploadedFile: isValid() ───────────────────────────────────────────────────

describe("UploadedFile — isValid()", () => {
  it("returns true for a file with no constraints", () => {
    expect(new UploadedFile(makeFile("a.txt", "hello")).isValid()).toBe(true);
  });

  it("returns false for an empty file", () => {
    expect(new UploadedFile(makeFile("empty.txt", "")).isValid()).toBe(false);
  });

  it("respects maxSize in bytes", () => {
    const f = new UploadedFile(makeFile("a.txt", "12345")); // 5 bytes
    expect(f.isValid({ maxSize: 10 })).toBe(true);
    expect(f.isValid({ maxSize: 4 })).toBe(false);
  });

  it("respects mimes allowlist", () => {
    const f = new UploadedFile(makeFile("img.png", "x", "image/png"));
    expect(f.isValid({ mimes: ["image/jpeg", "image/png"] })).toBe(true);
    expect(f.isValid({ mimes: ["image/jpeg"] })).toBe(false);
  });

  it("combines maxSize and mimes", () => {
    const f = new UploadedFile(makeFile("img.png", "12345", "image/png"));
    expect(f.isValid({ maxSize: 10, mimes: ["image/png"] })).toBe(true);
    expect(f.isValid({ maxSize: 3, mimes: ["image/png"] })).toBe(false); // too big
    expect(f.isValid({ maxSize: 10, mimes: ["image/jpeg"] })).toBe(false); // wrong type
  });
});

// ── UploadedFile: bytes() / text() ───────────────────────────────────────────

describe("UploadedFile — bytes() / text()", () => {
  it("bytes() returns the raw content as Uint8Array", async () => {
    const f = new UploadedFile(makeFile("a.txt", "hello"));
    const buf = await f.bytes();
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(buf)).toBe("hello");
  });

  it("text() returns the content as a string", async () => {
    expect(await new UploadedFile(makeFile("a.txt", "world")).text()).toBe("world");
  });
});

// ── UploadedFile: store() ─────────────────────────────────────────────────────

describe("UploadedFile — store()", () => {
  it("stores the file to the given disk and returns the path", async () => {
    const stored: Record<string, Uint8Array> = {};
    const fakeDisk = {
      put: async (p: string, c: Uint8Array) => {
        stored[p] = c;
      },
      url: (p: string) => `/storage/${p}`,
    };

    // Real PDF magic bytes — store() names the file from what it *is*, not what the
    // client called it.
    const body = "%PDF-1.7 data";
    const f = new UploadedFile(makeFile("doc.pdf", body, "application/pdf"));
    const path = await f.store("uploads", fakeDisk);

    expect(path.startsWith("uploads/")).toBe(true);
    expect(path.endsWith(".pdf")).toBe(true);
    expect(stored[path]).toBeDefined();
    expect(new TextDecoder().decode(stored[path])).toBe(body);
  });

  it("uses a custom filename when provided", async () => {
    const stored: Record<string, Uint8Array> = {};
    const fakeDisk = {
      put: async (p: string, c: Uint8Array) => {
        stored[p] = c;
      },
      url: (p: string) => p,
    };

    const path = await new UploadedFile(makeFile("x.png", "px")).store(
      "imgs",
      fakeDisk,
      "logo.png",
    );
    expect(path).toBe("imgs/logo.png");
  });

  it("trims trailing slashes from directory", async () => {
    const stored: Record<string, Uint8Array> = {};
    const fakeDisk = {
      put: async (p: string, c: Uint8Array) => {
        stored[p] = c;
      },
      url: (p: string) => p,
    };

    const path = await new UploadedFile(makeFile("f.txt", "x")).store(
      "uploads/",
      fakeDisk,
      "f.txt",
    );
    expect(path).toBe("uploads/f.txt");
  });

  it("storeAndGetUrl() returns the disk URL", async () => {
    const fakeDisk = { put: async () => {}, url: (p: string) => `https://cdn.example.com/${p}` };
    const url = await new UploadedFile(makeFile("img.jpg", "x")).storeAndGetUrl(
      "avatars",
      fakeDisk,
      "me.jpg",
    );
    expect(url).toBe("https://cdn.example.com/avatars/me.jpg");
  });
});

// ── HttpContext.file() / files() ──────────────────────────────────────────────

describe("HttpContext.file()", () => {
  it("returns an UploadedFile for a multipart file field", async () => {
    const req = multipartRequest({ avatar: makeFile("photo.jpg", "jpeg-data", "image/jpeg") });
    const ctx = new HttpContext(req, {});
    const f = await ctx.file("avatar");

    expect(f).toBeInstanceOf(UploadedFile);
    expect(f!.originalName).toBe("photo.jpg");
    expect(f!.mimeType).toBe("image/jpeg");
  });

  it("returns null when the field is absent", async () => {
    const req = multipartRequest({ other: makeFile("x.txt", "x") });
    const ctx = new HttpContext(req, {});
    expect(await ctx.file("missing")).toBeNull();
  });

  it("returns null for a text field (not a file)", async () => {
    const req = multipartRequest({ name: "Alice" });
    const ctx = new HttpContext(req, {});
    expect(await ctx.file("name")).toBeNull();
  });

  it("returns null for non-multipart requests", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "val" }),
    });
    const ctx = new HttpContext(req, {});
    expect(await ctx.file("key")).toBeNull();
  });
});

describe("HttpContext.files()", () => {
  it("returns an array of UploadedFile for multiple files on the same field", async () => {
    const fd = new FormData();
    fd.append("docs", makeFile("a.pdf", "A", "application/pdf"));
    fd.append("docs", makeFile("b.pdf", "B", "application/pdf"));
    const req = new Request("http://localhost/", { method: "POST", body: fd });
    const ctx = new HttpContext(req, {});

    const files = await ctx.files("docs");
    expect(files).toHaveLength(2);
    expect(files[0]!.originalName).toBe("a.pdf");
    expect(files[1]!.originalName).toBe("b.pdf");
  });

  it("returns an empty array when field is absent", async () => {
    const req = multipartRequest({ other: makeFile("x.txt", "x") });
    const ctx = new HttpContext(req, {});
    expect(await ctx.files("missing")).toEqual([]);
  });
});

// ── HttpContext.body() multipart text fields ──────────────────────────────────

describe("HttpContext.body() — multipart / url-encoded", () => {
  it("extracts text fields from multipart form", async () => {
    const req = multipartRequest({ name: "Alice", age: "30" });
    const ctx = new HttpContext(req, {});
    const b = await ctx.body<{ name: string; age: string }>();
    expect(b.name).toBe("Alice");
    expect(b.age).toBe("30");
  });

  it("does not include file fields in body()", async () => {
    const req = multipartRequest({ title: "Post", attachment: makeFile("f.pdf", "x") });
    const ctx = new HttpContext(req, {});
    const b = await ctx.body();
    expect(b["title"]).toBe("Post");
    expect("attachment" in b).toBe(false);
  });

  it("shares the formData cache between body() and file()", async () => {
    const req = multipartRequest({ label: "cover", image: makeFile("img.png", "x", "image/png") });
    const ctx = new HttpContext(req, {});

    const b = await ctx.body();
    const f = await ctx.file("image");
    expect(b["label"]).toBe("cover");
    expect(f).toBeInstanceOf(UploadedFile);
  });
});

// ── Uploads do not trust what the client says a file is ──────────────────────

describe("UploadedFile — client claims are not evidence", () => {
  function recordingDisk() {
    const stored: Record<string, { bytes: Uint8Array; contentType?: string }> = {};
    return {
      stored,
      disk: {
        put: async (p: string, c: Uint8Array, o?: { contentType?: string }) => {
          stored[p] = { bytes: c, contentType: o?.contentType };
        },
        url: (p: string) => p,
      },
    };
  }

  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  it("does not store an HTML payload as .html served as text/html", async () => {
    // The stored-XSS shape: both the extension and the Content-Type are attacker-chosen.
    const { stored, disk } = recordingDisk();
    const evil = new File(["<script>alert(1)</script>"], "x.html", { type: "text/html" });

    const path = await new UploadedFile(evil).store("avatars", disk);

    expect(path.endsWith(".html")).toBe(false);
    expect(stored[path]!.contentType).not.toContain("html");
    expect(stored[path]!.contentType).toBe("application/octet-stream");
  });

  it("names and types the file from its bytes, ignoring a mismatched claim", async () => {
    const { stored, disk } = recordingDisk();
    const png = new File([PNG], "totally-a-document.pdf", { type: "application/pdf" });

    const path = await new UploadedFile(png).store("uploads", disk);

    expect(path.endsWith(".png")).toBe(true);
    expect(stored[path]!.contentType).toBe("image/png");
  });

  it("strips smuggling characters out of the client's extension", () => {
    // The dangerous characters are gone; what remains is inert text, and store() does not
    // use it for naming anyway.
    expect(new UploadedFile(makeFile("x.php%00", "c")).extension()).toBe("php00");
    expect(new UploadedFile(makeFile("x.p/../../etc", "c")).extension()).toBe("etc");
    expect(new UploadedFile(makeFile("x.a b", "c")).extension()).toBe("ab");
    expect(new UploadedFile(makeFile("x.PNG", "c")).extension()).toBe("png");
    expect(new UploadedFile(makeFile("noext", "c")).extension()).toBe("");
  });

  it("keeps an explicit filename but still types the file honestly", async () => {
    const { stored, disk } = recordingDisk();
    const evil = new File(["<script>alert(1)</script>"], "x.html", { type: "text/html" });

    const path = await new UploadedFile(evil).store("docs", disk, "report.pdf");

    expect(path).toBe("docs/report.pdf");
    expect(stored[path]!.contentType).toBe("application/octet-stream");
  });

  it("detectType() reports the verdict without storing anything", async () => {
    const png = await new UploadedFile(new File([PNG], "a.txt")).detectType();
    expect(png).toEqual({ contentType: "image/png", extension: "png", recognised: true });

    const text = await new UploadedFile(makeFile("a.png", "just words")).detectType();
    expect(text.recognised).toBe(false);
  });
});
