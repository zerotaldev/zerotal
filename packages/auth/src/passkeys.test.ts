import { describe, it, expect, mock, beforeEach, beforeAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Mock @simplewebauthn/server before Passkeys.ts is loaded ─────────────────

/**
 * What the mocked `@simplewebauthn/server` entry points return.
 *
 * Written out rather than left to inference: `mock()` fixes a mock's return type
 * from the function it is created with, so every later `mockImplementation` had
 * to return that exact shape — and each of these tests deliberately returns a
 * different one. Naming the shapes is what lets a test return only the part it
 * is about.
 */
interface RegistrationOptionsStub {
  challenge: string;
  rp?: { name: string; id: string };
}

interface RegisteredCredentialStub {
  credential: {
    id: string;
    publicKey: Uint8Array;
    counter: number;
    transports: string[] | null;
  };
  credentialDeviceType: string;
  credentialBackedUp: boolean;
}

interface RegistrationVerificationStub {
  verified: boolean;
  registrationInfo?: RegisteredCredentialStub | undefined;
}

interface AuthenticationOptionsStub {
  challenge: string;
  allowCredentials?: unknown[];
}

const _mockGenerateRegistrationOptions = mock(
  async (_opts: unknown): Promise<RegistrationOptionsStub> => ({
    challenge: "fake-challenge",
    rp: { name: "Test", id: "example.com" },
  }),
);

const _mockVerifyRegistrationResponse = mock(
  async (_opts: unknown): Promise<RegistrationVerificationStub> => ({
    verified: false,
    registrationInfo: undefined,
  }),
);

const _mockGenerateAuthenticationOptions = mock(
  async (_opts: unknown): Promise<AuthenticationOptionsStub> => ({
    challenge: "fake-auth-challenge",
    allowCredentials: [],
  }),
);

const _mockVerifyAuthenticationResponse = mock(async (_opts: unknown) => ({
  verified: false,
  authenticationInfo: { newCounter: 1 },
}));

mock.module("@simplewebauthn/server", () => ({
  generateRegistrationOptions: _mockGenerateRegistrationOptions,
  verifyRegistrationResponse: _mockVerifyRegistrationResponse,
  generateAuthenticationOptions: _mockGenerateAuthenticationOptions,
  verifyAuthenticationResponse: _mockVerifyAuthenticationResponse,
}));

// ── Import after mocks are registered ────────────────────────────────────────

import { PasskeyService } from "./Passkeys.ts";
import type {
  PasskeyAuthenticationOptionsJSON,
  PasskeyAuthenticationResponseJSON,
  PasskeyCredential,
  PasskeyDeviceType,
  PasskeyRegistrationOptionsJSON,
  PasskeyRegistrationResponseJSON,
  _WebAuthnLibrary,
} from "./Passkeys.ts";
import type {
  AuthenticationResponseJSON,
  CredentialDeviceType,
  PublicKeyCredentialCreationOptionsJSON as LibraryCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON as LibraryRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOpts(overrides: Partial<ConstructorParameters<typeof PasskeyService>[0]> = {}) {
  return {
    rpName: "Test App",
    rpId: "example.com",
    origin: "https://example.com",
    findUserCredentials: mock(async (_userId: number) => []),
    findCredential: mock(async (_id: string) => null),
    saveCredential: mock(async (_credential: Omit<PasskeyCredential, "id">) => {}),
    updateCounter: mock(async () => {}),
    ...overrides,
  };
}

function makeUser() {
  return { id: 1, name: "Alice", email: "alice@example.com" };
}

function makeFakeCtx(sessionData: Record<string, unknown> = {}) {
  const sessionStore: Record<string, unknown> = { ...sessionData };
  return {
    request: new Request("https://example.com/passkeys"),
    session: {
      get: (k: string) => sessionStore[k],
      set: (k: string, v: unknown) => {
        sessionStore[k] = v;
      },
      regenerate: mock(() => {}),
    },
  };
}

/** An error shaped like the library's own, which names itself and carries a `code`. */
function libraryError(code: string): Error {
  const err = new Error(`library said ${code}`) as Error & { code: string };
  err.name = "SimpleWebAuthnError";
  err.code = code;
  return err;
}

// ── Constructor ───────────────────────────────────────────────────────────────

describe("PasskeyService — constructor", () => {
  it("stores options and constructs without error", () => {
    const opts = makeOpts();
    const svc = new PasskeyService(opts);
    expect(svc).toBeInstanceOf(PasskeyService);
  });
});

// ── registrationOptions() ─────────────────────────────────────────────────────

describe("PasskeyService.registrationOptions()", () => {
  beforeEach(() => {
    _mockGenerateRegistrationOptions.mockReset();
    _mockGenerateRegistrationOptions.mockImplementation(async () => ({
      challenge: "reg-challenge",
    }));
  });

  it("calls findUserCredentials when no existingCredentials provided", async () => {
    const findUserCredentials = mock(async (_id: number) => []);
    const svc = new PasskeyService(makeOpts({ findUserCredentials }));

    await svc.registrationOptions(makeUser());

    expect(findUserCredentials).toHaveBeenCalledWith(1);
    expect(_mockGenerateRegistrationOptions).toHaveBeenCalledTimes(1);
  });

  it("skips findUserCredentials when existingCredentials provided", async () => {
    const findUserCredentials = mock(async (_id: number) => []);
    const svc = new PasskeyService(makeOpts({ findUserCredentials }));

    await svc.registrationOptions(makeUser(), []);

    expect(findUserCredentials).not.toHaveBeenCalled();
  });

  it("passes rpName, rpId from options to generateRegistrationOptions", async () => {
    const svc = new PasskeyService(makeOpts());
    await svc.registrationOptions(makeUser());

    const [passedOpts] = _mockGenerateRegistrationOptions.mock.calls[0]!;
    expect((passedOpts as any).rpName).toBe("Test App");
    expect((passedOpts as any).rpID).toBe("example.com");
  });

  it("uses default timeout of 60 seconds", async () => {
    const svc = new PasskeyService(makeOpts());
    await svc.registrationOptions(makeUser());

    const [passedOpts] = _mockGenerateRegistrationOptions.mock.calls[0]!;
    expect((passedOpts as any).timeout).toBe(60_000);
  });

  it("uses custom timeoutSeconds when provided", async () => {
    const svc = new PasskeyService(makeOpts({ timeoutSeconds: 30 }));
    await svc.registrationOptions(makeUser());

    const [passedOpts] = _mockGenerateRegistrationOptions.mock.calls[0]!;
    expect((passedOpts as any).timeout).toBe(30_000);
  });

  it("offers EdDSA, ES256 and RS256, whatever the library would default to", async () => {
    const svc = new PasskeyService(makeOpts());
    await svc.registrationOptions(makeUser());

    const [passedOpts] = _mockGenerateRegistrationOptions.mock.calls[0]!;
    expect((passedOpts as any).supportedAlgorithmIDs).toEqual([-8, -7, -257]);
  });
});

// ── verifyRegistration() ──────────────────────────────────────────────────────

describe("PasskeyService.verifyRegistration()", () => {
  const fakeResponse = { id: "cred-id", rawId: "cred-id", response: {}, type: "public-key" } as any;

  beforeEach(() => {
    _mockVerifyRegistrationResponse.mockReset();
  });

  it("returns passkey.invalid when verifyRegistrationResponse throws", async () => {
    _mockVerifyRegistrationResponse.mockImplementation(async () => {
      throw new Error("bad request");
    });
    const svc = new PasskeyService(makeOpts());
    const result = await svc.verifyRegistration(
      makeUser(),
      fakeResponse,
      "challenge",
      makeFakeCtx() as any,
    );
    expect(result).toBe("passkey.invalid");
  });

  it("accepts only the algorithms it offered", async () => {
    _mockVerifyRegistrationResponse.mockImplementation(async () => ({ verified: false }));
    const svc = new PasskeyService(makeOpts());
    await svc.verifyRegistration(makeUser(), fakeResponse, "challenge", makeFakeCtx() as any);

    const [passedOpts] = _mockVerifyRegistrationResponse.mock.calls[0]!;
    expect((passedOpts as any).supportedAlgorithmIDs).toEqual([-8, -7, -257]);
  });

  it("throws a misconfigured rpId or origin rather than calling it invalid", async () => {
    const misconfigured = libraryError("BAD_ARGUMENT");
    _mockVerifyRegistrationResponse.mockImplementation(async () => {
      throw misconfigured;
    });
    const svc = new PasskeyService(makeOpts());
    const result = svc.verifyRegistration(
      makeUser(),
      fakeResponse,
      "challenge",
      makeFakeCtx() as any,
    );
    await expect(result).rejects.toBe(misconfigured);
  });

  it("returns passkey.invalid for the library's verification failures", async () => {
    _mockVerifyRegistrationResponse.mockImplementation(async () => {
      throw libraryError("UNEXPECTED_ORIGIN");
    });
    const svc = new PasskeyService(makeOpts());
    const result = await svc.verifyRegistration(
      makeUser(),
      fakeResponse,
      "challenge",
      makeFakeCtx() as any,
    );
    expect(result).toBe("passkey.invalid");
  });

  it("returns passkey.invalid when verified is false", async () => {
    _mockVerifyRegistrationResponse.mockImplementation(async () => ({ verified: false }));
    const svc = new PasskeyService(makeOpts());
    const result = await svc.verifyRegistration(
      makeUser(),
      fakeResponse,
      "challenge",
      makeFakeCtx() as any,
    );
    expect(result).toBe("passkey.invalid");
  });

  it("returns passkey.invalid when registrationInfo is missing", async () => {
    _mockVerifyRegistrationResponse.mockImplementation(async () => ({
      verified: true,
      registrationInfo: undefined,
    }));
    const svc = new PasskeyService(makeOpts());
    const result = await svc.verifyRegistration(
      makeUser(),
      fakeResponse,
      "challenge",
      makeFakeCtx() as any,
    );
    expect(result).toBe("passkey.invalid");
  });

  it("calls saveCredential and returns passkey.registered on success", async () => {
    const fakePublicKey = new Uint8Array([1, 2, 3]);
    _mockVerifyRegistrationResponse.mockImplementation(async () => ({
      verified: true,
      registrationInfo: {
        credential: {
          id: "cred-abc",
          publicKey: fakePublicKey,
          counter: 0,
          transports: ["internal"],
        },
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
      },
    }));

    const saveCredential = mock(async (_credential: Omit<PasskeyCredential, "id">) => {});
    const ctx = makeFakeCtx();
    const svc = new PasskeyService(makeOpts({ saveCredential }));
    const result = await svc.verifyRegistration(
      makeUser(),
      fakeResponse,
      "challenge",
      ctx as any,
      "My Key",
    );

    expect(result).toBe("passkey.registered");
    expect(saveCredential).toHaveBeenCalledTimes(1);
    const [saved] = saveCredential.mock.calls[0]!;
    expect(saved.user_id).toBe(1);
    expect(saved.credential_id).toBe("cred-abc");
    expect(saved.name).toBe("My Key");
  });

  it("sets session user_id on successful registration when not already set", async () => {
    const fakePublicKey = new Uint8Array([4, 5, 6]);
    _mockVerifyRegistrationResponse.mockImplementation(async () => ({
      verified: true,
      registrationInfo: {
        credential: {
          id: "c2",
          publicKey: fakePublicKey,
          counter: 0,
          transports: null,
        },
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
      },
    }));

    const ctx = makeFakeCtx();
    const svc = new PasskeyService(makeOpts());
    await svc.verifyRegistration(makeUser(), fakeResponse, "challenge", ctx as any);

    expect(ctx.session.get("user_id")).toBe(1);
    expect(ctx.session.regenerate as any).toHaveBeenCalledTimes(1);
  });

  it("skips session regenerate when user_id already in session", async () => {
    const fakePublicKey = new Uint8Array([7, 8, 9]);
    _mockVerifyRegistrationResponse.mockImplementation(async () => ({
      verified: true,
      registrationInfo: {
        credential: {
          id: "c3",
          publicKey: fakePublicKey,
          counter: 0,
          transports: null,
        },
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
      },
    }));

    const ctx = makeFakeCtx({ user_id: 42 });
    const svc = new PasskeyService(makeOpts());
    await svc.verifyRegistration(makeUser(), fakeResponse, "challenge", ctx as any);

    expect(ctx.session.regenerate as any).not.toHaveBeenCalled();
  });
});

// ── authenticationOptions() ───────────────────────────────────────────────────

describe("PasskeyService.authenticationOptions()", () => {
  beforeEach(() => {
    _mockGenerateAuthenticationOptions.mockReset();
    _mockGenerateAuthenticationOptions.mockImplementation(async () => ({
      challenge: "auth-challenge",
    }));
  });

  it("passes empty allowCredentials when no userId", async () => {
    const findUserCredentials = mock(async (_id: number) => []);
    const svc = new PasskeyService(makeOpts({ findUserCredentials }));

    await svc.authenticationOptions();

    expect(findUserCredentials).not.toHaveBeenCalled();
    const [opts] = _mockGenerateAuthenticationOptions.mock.calls[0]!;
    expect((opts as any).allowCredentials).toHaveLength(0);
  });

  it("fetches credentials for userId when provided", async () => {
    const cred = {
      id: 1,
      user_id: 1,
      credential_id: "cred-id",
      public_key: "pk",
      counter: 0,
      device_type: "singleDevice",
      backed_up: false,
      transports: ["internal"],
      name: null,
    } as any;
    const findUserCredentials = mock(async (_id: number) => [cred]);
    const svc = new PasskeyService(makeOpts({ findUserCredentials }));

    await svc.authenticationOptions(1);

    expect(findUserCredentials).toHaveBeenCalledWith(1);
    const [opts] = _mockGenerateAuthenticationOptions.mock.calls[0]!;
    expect((opts as any).allowCredentials).toHaveLength(1);
  });

  it("uses default timeout of 60 seconds", async () => {
    const svc = new PasskeyService(makeOpts());
    await svc.authenticationOptions();

    const [opts] = _mockGenerateAuthenticationOptions.mock.calls[0]!;
    expect((opts as any).timeout).toBe(60_000);
  });
});

// ── verifyAuthentication() ────────────────────────────────────────────────────

describe("PasskeyService.verifyAuthentication()", () => {
  const fakeAssertion = {
    id: "cred-abc",
    rawId: "cred-abc",
    response: {},
    type: "public-key",
  } as any;

  beforeEach(() => {
    _mockVerifyAuthenticationResponse.mockReset();
  });

  it("returns passkey.invalid when findCredential returns null", async () => {
    const findCredential = mock(async (_id: string) => null);
    const svc = new PasskeyService(makeOpts({ findCredential }));
    const result = await svc.verifyAuthentication(fakeAssertion, "challenge", makeFakeCtx() as any);
    expect(result).toBe("passkey.invalid");
  });

  it("returns passkey.invalid when findCredential returns undefined", async () => {
    const findCredential = mock(async (_id: string) => undefined);
    const svc = new PasskeyService(makeOpts({ findCredential }));
    const result = await svc.verifyAuthentication(fakeAssertion, "challenge", makeFakeCtx() as any);
    expect(result).toBe("passkey.invalid");
  });

  it("returns passkey.invalid when verifyAuthenticationResponse throws", async () => {
    const storedCred = {
      id: 1,
      user_id: 1,
      credential_id: "cred-abc",
      public_key: Buffer.from([1, 2, 3]).toString("base64url"),
      counter: 0,
      device_type: "singleDevice",
      backed_up: false,
      transports: null,
      name: null,
    } as any;
    const findCredential = mock(async (_id: string) => storedCred);
    _mockVerifyAuthenticationResponse.mockImplementation(async () => {
      throw new Error("invalid sig");
    });

    const svc = new PasskeyService(makeOpts({ findCredential }));
    const result = await svc.verifyAuthentication(fakeAssertion, "challenge", makeFakeCtx() as any);
    expect(result).toBe("passkey.invalid");
  });

  it("throws a misconfigured rpId or origin rather than calling it invalid", async () => {
    const storedCred = {
      id: 1,
      user_id: 1,
      credential_id: "cred-abc",
      public_key: Buffer.from([1, 2, 3]).toString("base64url"),
      counter: 0,
      device_type: "singleDevice",
      backed_up: false,
      transports: null,
      name: null,
    } as any;
    const findCredential = mock(async (_id: string) => storedCred);
    const misconfigured = libraryError("BAD_ARGUMENT");
    _mockVerifyAuthenticationResponse.mockImplementation(async () => {
      throw misconfigured;
    });

    const svc = new PasskeyService(makeOpts({ findCredential }));
    const result = svc.verifyAuthentication(fakeAssertion, "challenge", makeFakeCtx() as any);
    await expect(result).rejects.toBe(misconfigured);
  });

  it("returns passkey.invalid when verified is false", async () => {
    const storedCred = {
      id: 1,
      user_id: 1,
      credential_id: "cred-abc",
      public_key: Buffer.from([1, 2, 3]).toString("base64url"),
      counter: 0,
      device_type: "singleDevice",
      backed_up: false,
      transports: null,
      name: null,
    } as any;
    const findCredential = mock(async (_id: string) => storedCred);
    _mockVerifyAuthenticationResponse.mockImplementation(async () => ({
      verified: false,
      authenticationInfo: { newCounter: 0 },
    }));

    const svc = new PasskeyService(makeOpts({ findCredential }));
    const result = await svc.verifyAuthentication(fakeAssertion, "challenge", makeFakeCtx() as any);
    expect(result).toBe("passkey.invalid");
  });

  it("returns credential + userId and updates counter on success", async () => {
    const storedCred = {
      id: 5,
      user_id: 2,
      credential_id: "cred-abc",
      public_key: Buffer.from([1, 2, 3]).toString("base64url"),
      counter: 0,
      device_type: "singleDevice",
      backed_up: false,
      transports: ["internal"],
      name: null,
    } as any;
    const findCredential = mock(async (_id: string) => storedCred);
    const updateCounter = mock(async () => {});
    _mockVerifyAuthenticationResponse.mockImplementation(async () => ({
      verified: true,
      authenticationInfo: { newCounter: 7 },
    }));

    const ctx = makeFakeCtx();
    const svc = new PasskeyService(makeOpts({ findCredential, updateCounter }));
    const result = await svc.verifyAuthentication(fakeAssertion, "challenge", ctx as any);

    expect(result).toEqual({ credential: storedCred, userId: 2 });
    expect(updateCounter).toHaveBeenCalledWith(5, 7);
    expect(ctx.session.get("user_id")).toBe(2);
  });

  it("handles ctx without session gracefully", async () => {
    const storedCred = {
      id: 1,
      user_id: 1,
      credential_id: "cred-abc",
      public_key: Buffer.from([1]).toString("base64url"),
      counter: 0,
      device_type: "singleDevice",
      backed_up: false,
      transports: null,
      name: null,
    } as any;
    const findCredential = mock(async (_id: string) => storedCred);
    _mockVerifyAuthenticationResponse.mockImplementation(async () => ({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    }));

    const ctxWithoutSession = { request: new Request("https://example.com/") };
    const svc = new PasskeyService(makeOpts({ findCredential }));
    const result = await svc.verifyAuthentication(
      fakeAssertion,
      "challenge",
      ctxWithoutSession as any,
    );

    expect(result).toMatchObject({ userId: 1 });
  });
});

// ── Running a fixture in a process of its own ─────────────────────────────────

/**
 * This file mocks the library for the whole process, so the real one, and its absence, are
 * driven by fixtures in processes of their own. Each prints one JSON line, the last of its
 * output; see the fixture for what each field means.
 */
async function runProcess(cmd: string[], cwd?: string): Promise<string> {
  const proc = Bun.spawn(cmd, { ...(cwd ? { cwd } : {}), stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}: ${err}`);
  return out.trim().split("\n").at(-1)!;
}

async function runScript(path: string): Promise<string> {
  return runProcess([process.execPath, path]);
}

/**
 * A directory with nothing installed in it or above it, standing in for an app that never added
 * a package. The empty `node_modules` turns Bun's auto-install off, which would otherwise fetch a
 * missing package on import instead of reporting it.
 *
 * With `usesPasskeys`, the app has a source file that constructs `PasskeyService`, which is what
 * the doctor check looks for.
 */
function emptyApp(prefix: string, usesPasskeys = false): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, "node_modules"));
  if (usesPasskeys) {
    mkdirSync(join(dir, "app", "auth"), { recursive: true });
    writeFileSync(
      join(dir, "app", "auth", "passkeys.ts"),
      `import { PasskeyService } from "zerotal/auth";\nexport const passkeys = new PasskeyService(options);\n`,
    );
  }
  return dir;
}

/** Compile `entry` the way `bun zt compile` does, leaving the `external` packages out. */
async function compile(entry: string, outfile: string, external: string[] = []): Promise<void> {
  await runProcess([
    process.execPath,
    "build",
    "--compile",
    "--target=bun",
    entry,
    `--outfile=${outfile}`,
    ...external.flatMap((name) => ["--external", name]),
  ]);
}

const FIXTURES = `${import.meta.dir}/__fixtures__`;
const BINARY = process.platform === "win32" ? "app.exe" : "app";
const ALGORITHMS = [-8, -7, -257];

// ── Against the real library ──────────────────────────────────────────────────

describe("PasskeyService against the real @simplewebauthn/server", () => {
  async function runFixture(): Promise<Record<string, any>> {
    return JSON.parse(await runScript(`${FIXTURES}/passkeys-real-library.ts`));
  }

  let result: Record<string, any>;

  beforeAll(async () => {
    result = await runFixture();
  }, 30_000);

  it("is not loaded by importing @zerotal/auth, only by the first ceremony", () => {
    expect(result.loadedOnImport).toBe(0);
    expect(result.loadedAfterCeremony).toBe(true);
  });

  it("offers the three algorithms on any runtime", () => {
    expect(result.algorithms).toEqual(ALGORITHMS);
  });

  it("throws a malformed origin from both verifications", () => {
    const misconfigured = { threw: "SimpleWebAuthnError", code: "BAD_ARGUMENT" };
    expect(result.registration.misconfigured).toEqual(misconfigured);
    expect(result.authentication.misconfigured).toEqual(misconfigured);
  });

  it("still answers passkey.invalid when the response comes from another origin", () => {
    expect(result.registration.wrongOrigin).toBe("passkey.invalid");
    expect(result.authentication.wrongOrigin).toBe("passkey.invalid");
  });

  it("loads in a bundle, as a compiled app runs it", async () => {
    const outdir = mkdtempSync(join(tmpdir(), "zerotal-passkeys-bundle-"));
    try {
      const build = await Bun.build({
        entrypoints: [`${FIXTURES}/passkeys-bundled.ts`],
        target: "bun",
        outdir,
      });
      expect(build.success).toBe(true);
      expect(JSON.parse(await runScript(build.outputs[0]!.path))).toEqual(ALGORITHMS);
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  }, 60_000);

  it("is embedded in a binary built by bun build --compile, and runs there", async () => {
    // The import is written as a literal so the compiler can see it and embed the library. The
    // binary runs from a directory with nothing installed, so only an embedded copy can answer.
    const dir = emptyApp("zerotal-passkeys-compiled-");
    try {
      await compile(`${FIXTURES}/passkeys-bundled.ts`, join(dir, BINARY));
      expect(JSON.parse(await runProcess([join(dir, BINARY)], dir))).toEqual(ALGORITHMS);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

// ── Without the library ───────────────────────────────────────────────────────

describe("PasskeyService in an app without @simplewebauthn/server", () => {
  const INSTALL = "bun add @simplewebauthn/server reflect-metadata";

  /**
   * Bundle the fixture with `external` left out, then run it where nothing is installed.
   *
   * Bundled by `bun build` in a process of its own: on Bun 1.3.14 for Windows, `Bun.build()`
   * run inside this test process stopped with "Unexpected reading file" on core's sources.
   */
  async function runBundledWithout(external: string[]): Promise<Record<string, any>> {
    const dir = emptyApp("zerotal-passkeys-without-", true);
    try {
      const bundle = join(dir, "app.js");
      await runProcess([
        process.execPath,
        "build",
        "--target=bun",
        `${FIXTURES}/passkeys-without-library.ts`,
        `--outfile=${bundle}`,
        ...external.flatMap((name) => ["--external", name]),
      ]);
      return JSON.parse(await runProcess([process.execPath, "--no-install", bundle], dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Both packages left out: the app that installed neither. Bundled and run once. */
  let withoutEither: Promise<Record<string, any>> | undefined;
  const runWithoutEither = (): Promise<Record<string, any>> =>
    (withoutEither ??= runBundledWithout(["@simplewebauthn/server", "reflect-metadata"]));

  it("loads @zerotal/auth and runs what does not need passkeys", async () => {
    const result = await runWithoutEither();
    expect(result.hashedLength).toBe(64);
  }, 60_000);

  it("throws OptionalPeerMissingError from a ceremony, naming the command", async () => {
    const result = await runBundledWithout(["@simplewebauthn/server"]);
    expect(result.ceremony).toEqual({
      threw: "OptionalPeerMissingError",
      code: "E_OPTIONAL_PEER_MISSING",
      missing: { peer: "@simplewebauthn/server", feature: "PasskeyService", install: INSTALL },
      message: expect.stringContaining(`Install it: ${INSTALL}`),
    });
  }, 60_000);

  it("names the same command when reflect-metadata is missing too", async () => {
    // The polyfill is loaded first, so its absence is the one reported; the command installs both.
    const result = await runWithoutEither();
    expect(result.ceremony).toMatchObject({
      threw: "OptionalPeerMissingError",
      missing: { peer: "reflect-metadata", install: INSTALL },
    });
  }, 60_000);

  it("fails `zt doctor` for an app whose source uses PasskeyService", async () => {
    const result = await runWithoutEither();
    expect(result.doctor).toEqual({
      status: "fail",
      message: expect.stringContaining("app/auth/passkeys.ts uses PasskeyService"),
      fix: INSTALL,
    });
  }, 60_000);

  it("builds into a binary without it, and the binary says what to install", async () => {
    const dir = emptyApp("zerotal-passkeys-compiled-without-");
    try {
      await compile(`${FIXTURES}/passkeys-without-library.ts`, join(dir, BINARY), [
        "@simplewebauthn/server",
        "reflect-metadata",
      ]);
      const result = JSON.parse(await runProcess([join(dir, BINARY)], dir));
      expect(result.hashedLength).toBe(64);
      expect(result.ceremony).toMatchObject({
        threw: "OptionalPeerMissingError",
        code: "E_OPTIONAL_PEER_MISSING",
        missing: { install: INSTALL },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

// ── Zerotal's own WebAuthn types ──────────────────────────────────────────────

describe("Zerotal's WebAuthn types", () => {
  /**
   * Each entry is an assignment the type-checker has to accept, so `bun run typecheck:tests`
   * fails when Zerotal's types and the real ones stop agreeing:
   *
   * - the library still accepts what the ceremonies pass it and returns what they read;
   * - a response typed by the library (as its browser half types it) passes the verify methods;
   * - the options the service returns can be handed to the browser's own JSON parsers and to the
   *   library's types for them.
   */
  const agreements = {
    library: (real: typeof import("@simplewebauthn/server")): _WebAuthnLibrary => real,
    registrationResponse: (response: RegistrationResponseJSON): PasskeyRegistrationResponseJSON =>
      response,
    authenticationResponse: (
      response: AuthenticationResponseJSON,
    ): PasskeyAuthenticationResponseJSON => response,
    registrationOptionsForTheBrowser: (
      options: PasskeyRegistrationOptionsJSON,
    ): PublicKeyCredentialCreationOptionsJSON => options,
    registrationOptionsAsTheLibraryTypesThem: (
      options: PasskeyRegistrationOptionsJSON,
    ): LibraryCreationOptionsJSON => options,
    authenticationOptionsForTheBrowser: (
      options: PasskeyAuthenticationOptionsJSON,
    ): PublicKeyCredentialRequestOptionsJSON => options,
    authenticationOptionsAsTheLibraryTypesThem: (
      options: PasskeyAuthenticationOptionsJSON,
    ): LibraryRequestOptionsJSON => options,
    deviceType: (type: CredentialDeviceType): PasskeyDeviceType => type,
  };

  it("agree with the library's and the browser's, as the type-checker sees them", () => {
    expect(Object.keys(agreements)).toHaveLength(8);
  });
});
