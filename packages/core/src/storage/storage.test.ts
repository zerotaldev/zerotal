import { describe, it, expect, afterAll, beforeAll, beforeEach } from "bun:test";
import { rm } from "node:fs/promises";
import { StorageManager } from "./StorageManager.ts";
import { StorageConfig } from "./config.ts";
import { LocalDriver } from "./drivers/LocalDriver.ts";
import { S3Driver } from "./drivers/S3Driver.ts";

// ── Test root directory ───────────────────────────────────────────────────────
//
// Every local disk must live inside the storage root, so the suite moves that
// root to its own scratch directory instead of writing into the real one.
const SCRATCH = `.tmp-storage-test-${Date.now()}`;
Bun.env["ZT_STORAGE_ROOT"] = SCRATCH;
const TEST_ROOT = `${SCRATCH}/disk`;

afterAll(async () => {
  await rm(SCRATCH, { recursive: true, force: true }).catch(() => {});
});

// ── LocalDriver ───────────────────────────────────────────────────────────────

describe("LocalDriver", () => {
  const driver = new LocalDriver(TEST_ROOT, "/files");

  it("put() writes a file and get() reads it back", async () => {
    await driver.put("hello.txt", "Hello, Zerotal!");
    const content = await driver.get("hello.txt");
    expect(content).toBe("Hello, Zerotal!");
  });

  it("put() writes a Uint8Array and getBuffer() reads it back", async () => {
    const bytes = new TextEncoder().encode("binary data");
    await driver.put("data.bin", bytes);
    const buf = await driver.getBuffer("data.bin");
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(buf!)).toBe("binary data");
  });

  it("exists() returns true for existing files", async () => {
    await driver.put("exists.txt", "yes");
    expect(await driver.exists("exists.txt")).toBe(true);
  });

  it("exists() returns false for missing files", async () => {
    expect(await driver.exists("no-such-file.txt")).toBe(false);
  });

  it("get() returns null for missing files", async () => {
    expect(await driver.get("missing.txt")).toBeNull();
  });

  it("getBuffer() returns null for missing files", async () => {
    expect(await driver.getBuffer("missing.bin")).toBeNull();
  });

  it("delete() removes a file", async () => {
    await driver.put("to-delete.txt", "bye");
    expect(await driver.exists("to-delete.txt")).toBe(true);
    await driver.delete("to-delete.txt");
    expect(await driver.exists("to-delete.txt")).toBe(false);
  });

  it("delete() does not throw for missing files", async () => {
    await expect(driver.delete("does-not-exist.txt")).resolves.toBeUndefined();
  });

  it("url() returns urlBase + path", () => {
    expect(driver.url("avatars/alice.jpg")).toBe("/files/avatars/alice.jpg");
  });

  it("url() without urlBase returns /path", () => {
    const noBase = new LocalDriver(TEST_ROOT);
    expect(noBase.url("photos/x.png")).toBe("/photos/x.png");
  });

  it("handles nested paths (creates parent dirs via Bun.write)", async () => {
    await driver.put("nested/deep/file.txt", "deep content");
    const content = await driver.get("nested/deep/file.txt");
    expect(content).toBe("deep content");
  });

  it("copy() duplicates a file", async () => {
    await driver.put("original.txt", "original content");
    await driver.copy("original.txt", "copy.txt");
    expect(await driver.get("copy.txt")).toBe("original content");
    expect(await driver.exists("original.txt")).toBe(true); // original still exists
  });

  it("move() renames a file and removes the source", async () => {
    await driver.put("before.txt", "move me");
    await driver.move("before.txt", "after.txt");
    expect(await driver.get("after.txt")).toBe("move me");
    expect(await driver.exists("before.txt")).toBe(false);
  });

  it("size() returns byte count for existing file", async () => {
    const content = "hello size";
    await driver.put("sized.txt", content);
    const bytes = await driver.size("sized.txt");
    expect(bytes).toBe(new TextEncoder().encode(content).byteLength);
  });

  it("size() returns null for missing file", async () => {
    expect(await driver.size("no-file.txt")).toBeNull();
  });

  it("lastModified() returns a timestamp for existing file", async () => {
    await driver.put("dated.txt", "data");
    const ts = await driver.lastModified("dated.txt");
    expect(ts).toBeTypeOf("number");
    expect(ts!).toBeGreaterThan(0);
  });

  it("lastModified() returns null for missing file", async () => {
    expect(await driver.lastModified("ghost.txt")).toBeNull();
  });

  it("temporaryUrl() returns a URL with signature and expiry", async () => {
    Bun.env["APP_KEY"] = "test-storage-key";
    const url = await driver.temporaryUrl("private/doc.pdf", 300);
    expect(url).toContain("expires=");
    expect(url).toContain("signature=");
    expect(url).toContain("private/doc.pdf");

    // Round-trips through the matching verifier.
    const params = new URL(`http://x${url.slice(url.indexOf("/files") + 6)}`).searchParams;
    const ok = LocalDriver.verifyTemporaryUrl(
      "private/doc.pdf",
      Number(params.get("expires")),
      params.get("signature")!,
    );
    expect(ok).toBe(true);
  });

  it("temporaryUrl() throws when APP_KEY is unset", async () => {
    const prev = Bun.env["APP_KEY"];
    delete Bun.env["APP_KEY"];
    try {
      await expect(driver.temporaryUrl("x.pdf", 60)).rejects.toThrow();
    } finally {
      if (prev !== undefined) Bun.env["APP_KEY"] = prev;
    }
  });

  it("rejects path traversal that escapes the disk root", async () => {
    await expect(driver.get("../../etc/passwd")).rejects.toThrow();
    await expect(driver.put("../escape.txt", "x")).rejects.toThrow();
  });
});

// ── StorageManager ────────────────────────────────────────────────────────────

describe("StorageManager", () => {
  const manager = new StorageManager(
    StorageConfig({
      default: "local",
      disks: {
        local: { driver: "local", root: `${TEST_ROOT}/manager`, url: "/storage" },
      },
    }),
  );

  it("disk() returns a StorageDriver for the default disk", () => {
    const driver = manager.disk();
    expect(typeof driver.put).toBe("function");
    expect(typeof driver.get).toBe("function");
  });

  it('disk("local") returns the configured local driver', async () => {
    await manager.disk("local").put("test.txt", "manager test");
    const content = await manager.disk("local").get("test.txt");
    expect(content).toBe("manager test");
  });

  it("disk() caches the driver instance", () => {
    const d1 = manager.disk("local");
    const d2 = manager.disk("local");
    expect(d1).toBe(d2);
  });

  it('disk("unknown") throws a descriptive error', () => {
    let threw = false;
    try {
      manager.disk("unknown");
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("verifyTemporaryUrl round-trips a locally-signed URL and rejects tampering", async () => {
    Bun.env["APP_KEY"] = "test-storage-key";
    const url = await manager.disk("local").temporaryUrl("private/report.pdf", 300);
    // verifyTemporaryUrlFor accepts a valid signed URL for the matching path…
    expect(manager.verifyTemporaryUrlFor("private/report.pdf", `http://x/${url}`)).toBe(true);
    // …and rejects a mismatched path or a broken signature.
    expect(manager.verifyTemporaryUrlFor("private/other.pdf", `http://x/${url}`)).toBe(false);
    expect(manager.verifyTemporaryUrl("private/report.pdf", 9999999999, "bad")).toBe(false);
  });
});

// ── StorageConfig factory ─────────────────────────────────────────────────────

describe("StorageConfig", () => {
  it("returns defaults when called with no args", () => {
    const cfg = StorageConfig();
    expect(cfg.default).toBe("local");
    expect(cfg.disks["local"]?.driver).toBe("local");
    expect(cfg.disks["public"]?.driver).toBe("local");
  });

  it("merges custom disks with defaults", () => {
    const cfg = StorageConfig({
      disks: {
        s3: { driver: "s3", key: "k", secret: "s", region: "us-east-1", bucket: "my-bucket" },
      },
    });
    expect(cfg.disks["s3"]?.driver).toBe("s3");
    expect(cfg.disks["local"]?.driver).toBe("local");
  });

  it("overrides default disk", () => {
    const cfg = StorageConfig({ default: "public" });
    expect(cfg.default).toBe("public");
  });
});

// ── StorageProvider — onRegister() / onBooting() ─────────────────────────────

describe("StorageProvider — onRegister() / onBooting()", () => {
  it('registers a "storage" singleton that returns a StorageManager', async () => {
    const { StorageProvider } = await import("../provider/StorageProvider.ts");

    const singletonFns = new Map<string, () => unknown>();
    const configManager = {
      get: (_key: string, fallback: unknown) => fallback,
    };
    const app = {
      container: {
        singleton(key: string, fn: () => unknown) {
          singletonFns.set(key, fn);
        },
        makeSync(key: string) {
          if (key === "config") return configManager;
          const factory = singletonFns.get(key);
          return factory ? factory() : undefined;
        },
        async make(key: string) {
          return this.makeSync(key);
        },
      },
      // The provider mounts serving middleware for every disk that declares
      // `serve`, which the default config does for `public`.
      registered: [] as unknown[],
      useOnce(mw: unknown) {
        this.registered.push(mw);
      },
    };

    const provider = new (
      StorageProvider as unknown as new (app: unknown) => {
        onRegister(): void;
        onBooting(): Promise<void>;
      }
    )(app);

    provider.onRegister();
    expect(singletonFns.has("storage")).toBe(true);

    // The singleton factory should produce a StorageManager
    const manager = singletonFns.get("storage")!();
    expect(manager).toBeInstanceOf(StorageManager);
  });

  it("onBooting() eagerly resolves the storage singleton", async () => {
    const { StorageProvider } = await import("../provider/StorageProvider.ts");

    let makeCallCount = 0;
    const configManager = { get: (_: string, fb: unknown) => fb };
    const app = {
      container: {
        singleton(_key: string, fn: () => unknown) {
          (this as unknown as Record<string, unknown>)._factory = fn;
        },
        makeSync(key: string) {
          if (key === "config") return configManager;
          const factory = (this as unknown as Record<string, unknown>)._factory as
            (() => unknown) | undefined;
          return factory ? factory() : undefined;
        },
        async make(_key: string) {
          makeCallCount++;
          const factory = (this as unknown as Record<string, unknown>)._factory as
            (() => unknown) | undefined;
          return factory ? factory() : undefined;
        },
      },
      registered: [] as unknown[],
      useOnce(mw: unknown) {
        this.registered.push(mw);
      },
    };

    const provider = new (
      StorageProvider as unknown as new (app: unknown) => {
        onRegister(): void;
        onBooting(): Promise<void>;
      }
    )(app);

    provider.onRegister();
    await provider.onBooting();
    expect(makeCallCount).toBe(1);
  });
});

// ── S3Driver — URL generation (no actual HTTP) ────────────────────────────────

describe("S3Driver — url()", () => {
  it("returns AWS S3 URL by default", () => {
    const driver = new S3Driver("key", "secret", "us-east-1", "my-bucket");
    expect(driver.url("photos/test.jpg")).toContain("my-bucket");
    expect(driver.url("photos/test.jpg")).toContain("test.jpg");
  });

  it("returns custom urlBase when configured", () => {
    const driver = new S3Driver(
      "key",
      "secret",
      "auto",
      "my-bucket",
      undefined,
      "https://cdn.example.com",
    );
    expect(driver.url("image.png")).toBe("https://cdn.example.com/image.png");
  });

  it("uses custom endpoint for R2", () => {
    const driver = new S3Driver(
      "key",
      "secret",
      "auto",
      "my-bucket",
      "https://abc.r2.cloudflarestorage.com",
    );
    expect(driver.url("file.txt")).toContain("my-bucket");
    expect(driver.url("file.txt")).toContain("file.txt");
  });
});

// ── S3Driver — HTTP operations via a local mock S3 server ─────────────────────
//
// Strategy: spin up a Bun.serve() that behaves like S3 (path-style URLs,
// minimal HEAD/GET/PUT/DELETE semantics). S3Driver is pointed at the mock
// endpoint via its constructor. No real AWS credentials or network needed.
//
// Bun.S3Client sends signed requests; the mock server does not verify the
// signature — it just inspects method + path and responds with S3-compatible
// status codes and headers.

describe("S3Driver — HTTP operations (mock server)", () => {
  const BUCKET = "test-bucket";
  // In-memory object store: key → content bytes
  const store = new Map<string, Uint8Array>();

  let server: ReturnType<typeof Bun.serve>;
  let driver: S3Driver;

  beforeAll(() => {
    server = Bun.serve({
      port: 0, // random available port
      async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url);
        // Path-style: /<bucket>/<key>  →  strip leading /<bucket>/
        const prefix = `/${BUCKET}/`;
        const key = url.pathname.startsWith(prefix)
          ? url.pathname.slice(prefix.length)
          : url.pathname.slice(1);

        switch (req.method) {
          case "PUT": {
            const buf = await req.arrayBuffer();
            store.set(key, new Uint8Array(buf));
            return new Response("", { status: 200 });
          }
          case "GET": {
            const body = store.get(key);
            if (!body) return new Response("", { status: 404 });
            return new Response(body, {
              status: 200,
              headers: { "Content-Type": "application/octet-stream" },
            });
          }
          case "HEAD": {
            const body = store.get(key);
            if (!body) return new Response("", { status: 404 });
            return new Response("", {
              status: 200,
              headers: {
                "Content-Length": String(body.byteLength),
                "Last-Modified": new Date("2026-01-01").toUTCString(),
                "Content-Type": "application/octet-stream",
              },
            });
          }
          case "DELETE": {
            store.delete(key);
            return new Response("", { status: 204 });
          }
          default:
            return new Response("", { status: 405 });
        }
      },
    });

    driver = new S3Driver(
      "test-key",
      "test-secret",
      "us-east-1",
      BUCKET,
      `http://localhost:${server.port}`,
    );
  });

  afterAll(() => {
    server.stop();
  });

  beforeEach(() => {
    store.clear();
  });

  it("put() uploads content and get() retrieves it", async () => {
    await driver.put("hello.txt", "Hello S3!");
    const content = await driver.get("hello.txt");
    expect(content).toBe("Hello S3!");
  });

  it("put() uploads a Uint8Array and getBuffer() retrieves bytes", async () => {
    const bytes = new TextEncoder().encode("binary content");
    await driver.put("data.bin", bytes);
    const buf = await driver.getBuffer("data.bin");
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(buf!)).toBe("binary content");
  });

  it("get() returns null for a missing key", async () => {
    const result = await driver.get("nonexistent.txt");
    expect(result).toBeNull();
  });

  it("exists() returns true after put()", async () => {
    await driver.put("check.txt", "x");
    expect(await driver.exists("check.txt")).toBe(true);
  });

  it("exists() returns false for a missing key", async () => {
    expect(await driver.exists("ghost.txt")).toBe(false);
  });

  it("delete() removes the object", async () => {
    await driver.put("remove.txt", "bye");
    await driver.delete("remove.txt");
    expect(await driver.exists("remove.txt")).toBe(false);
  });

  it("size() returns the byte length of the stored object", async () => {
    const payload = "twelve bytes";
    await driver.put("sized.txt", payload);
    const sz = await driver.size("sized.txt");
    expect(sz).toBe(new TextEncoder().encode(payload).byteLength);
  });

  it("size() returns null for a missing key", async () => {
    expect(await driver.size("missing.txt")).toBeNull();
  });

  it("lastModified() returns a timestamp for an existing object", async () => {
    await driver.put("ts.txt", "x");
    const ts = await driver.lastModified("ts.txt");
    expect(typeof ts).toBe("number");
    expect(ts).toBeGreaterThan(0);
  });

  it("copy() duplicates an object", async () => {
    await driver.put("src.txt", "source content");
    await driver.copy("src.txt", "dst.txt");
    expect(await driver.get("dst.txt")).toBe("source content");
    expect(await driver.get("src.txt")).toBe("source content");
  });

  it("move() copies then deletes the source", async () => {
    await driver.put("move-src.txt", "moving");
    await driver.move("move-src.txt", "move-dst.txt");
    expect(await driver.get("move-dst.txt")).toBe("moving");
    expect(await driver.exists("move-src.txt")).toBe(false);
  });

  it("temporaryUrl() returns a presigned URL string", async () => {
    await driver.put("presign.txt", "x");
    const url = await driver.temporaryUrl("presign.txt", 300);
    expect(typeof url).toBe("string");
    expect(url).toContain("presign.txt");
  });
});
