import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import { _lazyStaticResponse } from "./Application.ts";

const TMP = `${import.meta.dir}/.tmp-dev-static-${Date.now()}`;
const PUBLIC = `${TMP}/public`;
const BUILD = `${TMP}/build`;

const dirs = [
  { prefix: "/", rootDir: PUBLIC, options: { headers: { "Cache-Control": "no-cache" } } },
  { prefix: "/assets", rootDir: BUILD, options: { headers: { "Cache-Control": "no-cache" } } },
];

const get = (path: string) => _lazyStaticResponse(`http://localhost:3000${path}`, dirs);

beforeAll(async () => {
  await Bun.write(`${PUBLIC}/favicon.ico`, "icon");
  await Bun.write(`${PUBLIC}/assets/app.js`, "entry");
  await Bun.write(`${BUILD}/only-here.js`, "custom outdir");
  await Bun.write(`${TMP}/secret.txt`, "outside the served root");
});

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe("dev static fallback", () => {
  it("serves a file written after the server started", async () => {
    // The failure this guards: a rebuild emits `chunk-<contenthash>.js` names the
    // compile-time route table has never seen, so the page's dynamic import 404s.
    const chunk = `${PUBLIC}/assets/chunk-freshhash.js`;
    expect(await get("/assets/chunk-freshhash.js")).toBeUndefined();

    await Bun.write(chunk, "export const rebuilt = true;");

    const res = await get("/assets/chunk-freshhash.js");
    expect(res).toBeDefined();
    expect(await res!.text()).toBe("export const rebuilt = true;");
  });

  it("applies the mount's headers so the browser revalidates", async () => {
    const res = await get("/assets/app.js");
    expect(res!.headers.get("cache-control")).toBe("no-cache");
  });

  it("falls through to a later mount when an earlier one matches the prefix but lacks the file", async () => {
    // `public → /` matches every path; the custom outDir behind it must still be reachable.
    const res = await get("/assets/only-here.js");
    expect(await res!.text()).toBe("custom outdir");
  });

  it("resolves percent-escapes so a filename with a space is found", async () => {
    await Bun.write(`${PUBLIC}/my file.css`, "body{}");
    const res = await get("/my%20file.css");
    expect(await res!.text()).toBe("body{}");
  });

  it("refuses a percent-encoded traversal out of the served root", async () => {
    expect(await get("/%2e%2e/secret.txt")).toBeUndefined();
    expect(await get("/assets/%2E%2E/%2E%2E/secret.txt")).toBeUndefined();
  });

  it("returns undefined for a malformed escape rather than throwing", async () => {
    expect(await get("/%E0%A4%A.js")).toBeUndefined();
  });

  it("returns undefined when no mount has the file", async () => {
    expect(await get("/nope.js")).toBeUndefined();
  });
});
