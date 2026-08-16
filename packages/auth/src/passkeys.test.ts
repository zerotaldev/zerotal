import { describe, it, expect, mock, beforeEach } from "bun:test";

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
import type { PasskeyCredential } from "./Passkeys.ts";

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
