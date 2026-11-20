import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  _appDirectoryExists,
  _appFileExists,
  _appFilesEmbedded,
  _embedAppFiles,
  _importAppFile,
  _importAppFileSync,
  _preloadAppFiles,
  _readAppFileText,
  _scanAppFiles,
  _scanAppFilesSync,
} from "./appFiles.ts";

const root = process.cwd();
const module = (value: unknown) => async () => ({ default: value });

afterEach(() => _embedAppFiles(null));

describe("with no files embedded", () => {
  it("reads the disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zt-app-files-"));
    try {
      mkdirSync(join(dir, "nested"));
      writeFileSync(join(dir, "b.ts"), "export default 'b';");
      writeFileSync(join(dir, "nested", "a.ts"), "export default 'a';");
      writeFileSync(join(dir, "page.html"), "<p>disk</p>");

      expect(_appFilesEmbedded()).toBe(false);
      expect(await _scanAppFiles(dir, "**/*.ts")).toEqual(["b.ts", "nested/a.ts"]);
      expect(_scanAppFilesSync(dir, "*.ts")).toEqual(["b.ts"]);
      expect(await _importAppFile(join(dir, "b.ts"))).toMatchObject({ default: "b" });
      expect(await _appFileExists(join(dir, "b.ts"))).toBe(true);
      expect(await _appFileExists(join(dir, "missing.ts"))).toBe(false);
      expect(await _appDirectoryExists(join(dir, "nested"))).toBe(true);
      expect(await _readAppFileText(join(dir, "page.html"))).toBe("<p>disk</p>");
      expect(_importAppFileSync(join(dir, "b.ts"))).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds nothing in a directory that does not exist", async () => {
    expect(await _scanAppFiles(join(root, "no-such-directory"), "**/*.ts")).toEqual([]);
    expect(_scanAppFilesSync(join(root, "no-such-directory"), "*.ts")).toEqual([]);
  });
});

describe("with files embedded", () => {
  it("scans, imports and checks them by their path from the root", async () => {
    _embedAppFiles({
      "config/app.ts": module({ name: "embedded" }),
      "config/nested/deep.ts": module("deep"),
      "app/routes/index.ts": module("index"),
      "resources/app.html": module("<p>embedded</p>"),
    });

    expect(_appFilesEmbedded()).toBe(true);
    expect(await _scanAppFiles(`${root}/config`, "*.{ts,js}")).toEqual(["app.ts"]);
    expect(await _scanAppFiles(`${root}/config`, "**/*.ts")).toEqual(["app.ts", "nested/deep.ts"]);
    expect(_scanAppFilesSync("config", "*.ts")).toEqual(["app.ts"]);
    expect(await _importAppFile(`${root}/config/app.ts`)).toEqual({
      default: { name: "embedded" },
    });
    expect(await _appFileExists(`${root}/app/routes/index.ts`)).toBe(true);
    expect(await _appFileExists(`${root}/app/routes/other.ts`)).toBe(false);
    expect(await _appDirectoryExists(`${root}/app/routes`)).toBe(true);
    expect(await _appDirectoryExists(`${root}/app/models`)).toBe(false);
    expect(await _readAppFileText(`${root}/resources/app.html`)).toBe("<p>embedded</p>");
  });

  it("accepts file:// URLs and drops a hot-reload query", async () => {
    _embedAppFiles({ "app/routes/index.ts": module("index") });
    const url = pathToFileURL(`${root}/app/routes/index.ts`).href;
    expect(await _importAppFile(url)).toEqual({ default: "index" });
    expect(await _importAppFile(`${url}?t=123`)).toEqual({ default: "index" });
    expect(await _importAppFile(`${root}/app/routes/index.ts?t=123`)).toEqual({ default: "index" });
  });

  it("reads a path outside the root from disk", async () => {
    _embedAppFiles({ "config/app.ts": module("embedded") });
    const outside = join(root, "..", "outside-the-root");
    expect(await _scanAppFiles(outside, "**/*.ts")).toEqual([]);
    expect(await _appFileExists(join(outside, "x.ts"))).toBe(false);
  });

  it("preloads a directory for a synchronous reader, and repeats a load error", async () => {
    const failure = new Error("APP_KEY is not set");
    _embedAppFiles({
      "config/app.ts": module("app"),
      "config/broken.ts": async () => {
        throw failure;
      },
      "app/models/User.ts": module("user"),
    });
    expect(_importAppFileSync(`${root}/config/app.ts`)).toBeUndefined();

    await _preloadAppFiles(["config"]);
    expect(_importAppFileSync(`${root}/config/app.ts`)).toEqual({ default: "app" });
    expect(() => _importAppFileSync(`${root}/config/broken.ts`)).toThrow(failure);
    // Only the directories asked for.
    expect(_importAppFileSync(`${root}/app/models/User.ts`)).toBeUndefined();
  });
});
