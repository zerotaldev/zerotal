/**
 * `/__flow/upload` end to end: a real server, a real multipart request.
 *
 * The endpoint streams the file to disk and answers with a reference issued to the signed-in
 * user. The pieces are tested on their own (`receive.test.ts`, `uploads.test.ts`); this is the
 * route itself, so a change to how the request body reaches the handler cannot pass unnoticed.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application, HttpContext, RequestContext } from "@zerotal/core";
import type { NextFn } from "@zerotal/core";
import { StorageProvider } from "@zerotal/core/storage";
import { FlowProvider } from "../provider/FlowProvider.ts";
import { TemporaryUploadedFile, type UploadRef } from "./TemporaryUploadedFile.ts";

/** Signs every request in as user 7 when it carries `x-test-user`, as an auth middleware would. */
class TestUser {
  async handle(ctx: HttpContext, next: NextFn): Promise<Response | void> {
    if (ctx.request.headers.get("x-test-user")) Reflect.set(ctx, "user", { id: 7 });
    return next();
  }
}

let app: Application;
let base = "";
let storage = "";
const saved = { root: Bun.env["ZT_STORAGE_ROOT"], key: Bun.env.APP_KEY, env: Bun.env.APP_ENV };

beforeAll(async () => {
  storage = await mkdtemp(join(tmpdir(), "zt-upload-endpoint-"));
  Bun.env["ZT_STORAGE_ROOT"] = storage;
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
  Bun.env.APP_ENV = "test";

  Application._resetInstance();
  app = Application.create({ env: "web", providers: [StorageProvider, FlowProvider] });
  app.use([TestUser]);
  await app.boot();
  await app.start(0);
  const server = (app as unknown as { _static?: { port: number } })._static;
  base = `http://localhost:${server?.port}`;
}, 60_000);

afterAll(async () => {
  await app?.close?.();
  Application._resetInstance();
  await rm(storage, { recursive: true, force: true });
  for (const [name, value] of [
    ["ZT_STORAGE_ROOT", saved.root],
    ["APP_KEY", saved.key],
    ["APP_ENV", saved.env],
  ] as const) {
    if (value === undefined) delete Bun.env[name];
    else Bun.env[name] = value;
  }
});

function upload(contents: string, signedIn = true): Promise<Response> {
  const form = new FormData();
  form.append("file", new File([contents], "notes.txt", { type: "text/plain" }));
  return fetch(`${base}/__flow/upload`, {
    method: "POST",
    body: form,
    headers: { origin: base, ...(signedIn ? { "x-test-user": "1" } : {}) },
  });
}

describe("POST /__flow/upload", () => {
  it("stores the file and answers with a reference issued to the uploader", async () => {
    const res = await upload("hello, upload");
    expect(res.status).toBe(200);
    const ref = (await res.json()) as UploadRef;

    expect(ref.sub).toBe("7");
    expect(ref.size).toBe("hello, upload".length);
    expect(ref.tmpPath).toMatch(/^flow-tmp\/[0-9a-f-]+\.txt$/);
    expect(ref.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // The reference resolves for its uploader, and the bytes are the ones sent.
    const ctx = HttpContext.fake("http://localhost/");
    Reflect.set(ctx, "user", { id: 7 });
    const file = RequestContext.run(ctx, () => TemporaryUploadedFile.fromSignedRef(ref));
    expect(file).not.toBeNull();
    expect(new TextDecoder().decode(await file!.bytes())).toBe("hello, upload");
  });

  it("refuses a guest", async () => {
    expect((await upload("x", false)).status).toBe(401);
  });

  it("refuses a body that is not a multipart upload", async () => {
    const res = await fetch(`${base}/__flow/upload`, {
      method: "POST",
      body: "{}",
      headers: { origin: base, "x-test-user": "1", "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
  });
});
