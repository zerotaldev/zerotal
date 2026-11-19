/**
 * Does an app that uses passkeys have the WebAuthn library installed?
 *
 * `@simplewebauthn/server` and `reflect-metadata` are optional peers of `@zerotal/auth`, which an
 * app installs when it uses passkeys. Without them the app still builds, boots and serves every
 * page, and its first passkey ceremony throws. That can be a long way into a deploy, and it is
 * where an app that used passkeys before they became optional finds out, so the doctor says it
 * first.
 *
 * Nothing in config turns passkeys on: an app constructs `PasskeyService` in its own code. So the
 * check reads the app's source, and a file there that names `PasskeyService` counts as using it.
 * Then it loads the library the way a ceremony does, so what it reports is what a ceremony would
 * meet: a package that is missing, one that fails to load, or neither.
 *
 * @module
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import type { DoctorCheck, DoctorCheckResult } from "@zerotal/core";
import { OptionalPeerMissingError } from "@zerotal/core/runtime";
import { _webauthn } from "./Passkeys.ts";

/** The directories an app's own code lives in. `node_modules` and build output are never read. */
const APP_SOURCE = new Glob("{app,bootstrap,config,routes,resources,src}/**/*.{ts,tsx,js,jsx,mjs}");

/** Installs both packages, whichever one is missing: a ceremony needs the two together. */
const INSTALL = "bun add @simplewebauthn/server reflect-metadata";

/**
 * @internal The first file of the app at `root` that names `PasskeyService`, relative to `root`
 * and with forward slashes, or `undefined` when no file does.
 */
export function _passkeyUser(root: string): string | undefined {
  for (const file of APP_SOURCE.scanSync({ cwd: root, onlyFiles: true })) {
    const relative = file.replace(/\\/g, "/");
    if (relative.includes("node_modules/")) continue;
    let text: string;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    if (text.includes("PasskeyService")) return relative;
  }
  return undefined;
}

/**
 * @internal What the check finds for the app at `root`.
 *
 * @param root - The app's directory.
 * @param load - Loads the library as a ceremony does; replaced in tests.
 */
export async function _passkeyLibraryResult(
  root: string,
  load: () => Promise<unknown> = _webauthn,
): Promise<DoctorCheckResult> {
  const user = _passkeyUser(root);
  if (!user) return { status: "ok", message: "no file names PasskeyService." };

  try {
    await load();
    return { status: "ok", message: `the WebAuthn library is installed (${user} uses passkeys).` };
  } catch (err) {
    if (err instanceof OptionalPeerMissingError) {
      return {
        status: "fail",
        message:
          `${user} uses PasskeyService, and "${err.missing.peer}" is not installed, so the first ` +
          `passkey ceremony throws OptionalPeerMissingError.`,
        fix: err.missing.install,
      };
    }
    return {
      status: "fail",
      message:
        `${user} uses PasskeyService, and the WebAuthn library failed to load: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      fix: `Reinstall it: ${INSTALL}`,
    };
  }
}

/** The check `AuthProvider` contributes to `zt doctor`, run against the current directory. */
export const passkeyLibraryCheck: DoctorCheck = {
  id: "auth-passkeys-library",
  label: "Passkeys",
  run: () => _passkeyLibraryResult(process.cwd()),
};
