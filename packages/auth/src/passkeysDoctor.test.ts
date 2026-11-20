import { describe, it, expect, mock, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { OptionalPeerMissingError } from "@zerotal/core/runtime";
import { _passkeyLibraryResult, _passkeyUser, passkeyLibraryCheck } from "./passkeysDoctor.ts";

const roots: string[] = [];

/** An app directory holding `files`, relative path to contents. */
function app(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "zerotal-passkeys-doctor-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const PASSKEYS = `import { PasskeyService } from "zerotal/auth";\nexport const passkeys = new PasskeyService(options);\n`;
const INSTALL = "bun add @simplewebauthn/server reflect-metadata";

function missing(peer: string): OptionalPeerMissingError {
  return new OptionalPeerMissingError({ peer, feature: "PasskeyService", install: INSTALL });
}

describe("the passkeys doctor check", () => {
  it("is ok, and loads nothing, when no file names PasskeyService", async () => {
    const load = mock(async () => {});
    const root = app({ "app/controllers/HomeController.ts": "export class HomeController {}\n" });

    const result = await _passkeyLibraryResult(root, load);

    expect(result.status).toBe("ok");
    expect(load).not.toHaveBeenCalled();
  });

  it("is ok when the app uses passkeys and the library loads", async () => {
    const root = app({ "app/auth/passkeys.ts": PASSKEYS });

    const result = await _passkeyLibraryResult(root, async () => {});

    expect(result.status).toBe("ok");
    expect(result.message).toContain("app/auth/passkeys.ts");
  });

  it("fails with the install command when a package is missing", async () => {
    const root = app({ "routes/web.ts": PASSKEYS });

    const result = await _passkeyLibraryResult(root, async () => {
      throw missing("@simplewebauthn/server");
    });

    expect(result).toEqual({
      status: "fail",
      message: expect.stringContaining(
        'routes/web.ts uses PasskeyService, and "@simplewebauthn/server"',
      ),
      fix: INSTALL,
    });
  });

  it("fails as a broken install when the library is there and does not load", async () => {
    const root = app({ "app/auth/passkeys.ts": PASSKEYS });

    const result = await _passkeyLibraryResult(root, async () => {
      throw new Error("tsyringe requires a reflect polyfill");
    });

    expect(result.status).toBe("fail");
    expect(result.message).toContain("failed to load: tsyringe requires a reflect polyfill");
    expect(result.fix).toBe(`Reinstall it: ${INSTALL}`);
  });

  it("reads the app's own source, not what it installed", () => {
    const root = app({ "src/node_modules/vendored/index.ts": PASSKEYS });

    expect(_passkeyUser(root)).toBeUndefined();
  });

  it("is registered under a stable id", () => {
    expect(passkeyLibraryCheck.id).toBe("auth-passkeys-library");
  });
});
