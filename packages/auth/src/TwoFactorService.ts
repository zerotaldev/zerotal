/**
 * TwoFactorService — TOTP-based two-factor authentication.
 *
 * Implemented natively for Bun using synchronous `node:crypto` and `Bun.CryptoHasher`.
 * No external dependencies required.
 *
 * ## Quick start
 *
 * ```ts
 * const tf = new TwoFactorService({ issuer: 'My App' });
 *
 * // 1. Generate + store a secret for the user:
 * const secret = tf.generateSecret();
 * await user.update({ twoFactorSecret: secret, twoFactorConfirmedAt: null });
 *
 * // 2. Show the QR code:
 * const uri = tf.getQrCodeUrl(user.email, secret);
 *
 * // 3. Confirm setup — verify the first code:
 * const ok = tf.verifyCode(secret, inputCode); // <-- Now synchronous!
 * if (ok) await user.update({ twoFactorConfirmedAt: new Date() });
 *
 * // 3b. At login, guard against TOTP replay (RFC 6238 §5.2) by persisting the
 * //     last successfully-used time-step counter next to the secret:
 * const check = tf.verifyCodeWithCounter(secret, inputCode, user.twoFactorLastCounter);
 * if (check.valid) await user.update({ twoFactorLastCounter: check.counter });
 *
 * // 4. Generate + store recovery codes:
 * const { plain, hashed } = tf.generateRecoveryCodes(); // <-- Now synchronous!
 * await user.update({ twoFactorRecoveryCodes: JSON.stringify(hashed) });
 *
 * // 5. Verify a recovery code at login:
 * const result = tf.verifyRecoveryCode(JSON.parse(user.twoFactorRecoveryCodes), inputCode);
 * if (result.valid) {
 * await user.update({ twoFactorRecoveryCodes: JSON.stringify(result.remaining) });
 * }
 * ```
 *
 * @remarks
 * Security-relevant properties: TOTP follows RFC 6238 (SHA-1 HMAC, 6 digits,
 * 30-second period) with a configurable ± `window` of adjacent slots. A replay
 * guard (RFC 6238 §5.2) is enforced by {@link TwoFactorService.verifyCodeWithCounter}:
 * persist the returned counter and pass it back on the next check so a code can be
 * used at most once. All code and recovery-code comparisons are constant-time
 * (`safeEqual`) and never break early on a match. Recovery codes are stored only as
 * SHA-256 hashes; the plaintext is shown once at generation.
 *
 * @packageDocumentation
 */

import { safeEqual, sha256Hex } from "@zerotal/core";

// ── Base-32 codec ─────────────────────────────────────────────────────────────

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += B32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const idx = B32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

// ── TOTP core ─────────────────────────────────────────────────────────────────

const PERIOD = 30; // seconds per slot
const DIGITS = 6; // code length

function hotp(secret: Buffer, counter: bigint): number {
  // Write counter as 8-byte big-endian
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);

  // Generate HMAC synchronously using Bun's native CryptoHasher
  const hmac = new Bun.CryptoHasher("sha1", secret).update(counterBuffer).digest();

  // Dynamic truncation (RFC 4226 §5.4)
  const offset = hmac[19]! & 0x0f;
  const code =
    (((hmac[offset]! & 0x7f) << 24) |
      ((hmac[offset + 1]! & 0xff) << 16) |
      ((hmac[offset + 2]! & 0xff) << 8) |
      (hmac[offset + 3]! & 0xff)) %
    10 ** DIGITS;

  return code;
}

function currentCounter(): bigint {
  return BigInt(Math.floor(Date.now() / 1000 / PERIOD));
}

// ── Recovery codes ────────────────────────────────────────────────────────────

/**
 * Entropy per recovery code, in bits.
 *
 * Recovery codes are stored under a single unsalted SHA-256, which is only defensible
 * because the search space is this large: 2^160 leaves an offline attacker with a leaked
 * column nothing to do. Lowering this without also changing the storage scheme turns every
 * recovery code into a brute-forceable second-factor bypass.
 */
export const RECOVERY_CODE_BITS = 160;

/** Crockford base32 — no I/L/O/U, so codes read back over the phone without ambiguity. */
const _BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Mint one recovery code: {@link RECOVERY_CODE_BITS} bits of CSPRNG entropy rendered as
 * Crockford base32 in hyphenated groups of five (`XXXXX-XXXXX-XXXXX-XXXXX-…`).
 *
 * Each 5-bit group is taken from a whole random byte via rejection sampling of the top
 * 3 bits, so every symbol is uniform — a plain `byte % 32` would bias the first eight
 * symbols of the alphabet.
 * @internal
 */
function _mintRecoveryCode(): string {
  const symbols = Math.ceil(RECOVERY_CODE_BITS / 5);
  const out: string[] = [];
  const buf = new Uint8Array(1);
  for (let i = 0; i < symbols; i++) {
    let value: number;
    do {
      crypto.getRandomValues(buf);
      value = buf[0]! & 0x1f;
      // Redraw when the byte fell in the short final bucket (248-255): 256 is not a
      // multiple of 32 only in that tail, so rejecting it makes the draw uniform.
    } while (buf[0]! >= 248);
    out.push(_BASE32_ALPHABET[value]!);
  }
  return (out.join("").match(/.{1,5}/g) ?? []).join("-").toLowerCase();
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface TwoFactorOptions {
  /** Issuer shown in the authenticator app (e.g. your app name). Default: 'Zerotal'. */
  issuer?: string;
  /** TOTP window: number of periods to check on each side of current time. Default: 1. */
  window?: number;
  /** Number of recovery codes to generate. Default: 8. */
  recoveryCodeCount?: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Native, dependency-free TOTP two-factor authentication service.
 *
 * @remarks
 * Stateless: the service holds only configuration (`issuer`, `window`,
 * `recoveryCodeCount`). All per-user state (the secret, the last-used counter,
 * and the recovery-code hashes) is passed in and out of its methods, so you
 * persist it however you like.
 */
export class TwoFactorService {
  private readonly _issuer: string;
  private readonly _window: number;
  private readonly _recoveryCodeCount: number;

  constructor(options: TwoFactorOptions = {}) {
    this._issuer = options.issuer ?? "Zerotal";
    this._window = options.window ?? 1;
    this._recoveryCodeCount = options.recoveryCodeCount ?? 8;
  }

  // ── Secret ──────────────────────────────────────────────────────────────────

  /**
   * Generate a random base-32 secret (160 bits) for a new user enrollment.
   * Store this (encrypted at rest recommended) in `user.twoFactorSecret`.
   *
   * @returns A base-32 string to seed the authenticator app.
   * @category Secret
   */
  generateSecret(): string {
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    return base32Encode(Buffer.from(bytes));
  }

  // ── QR code ─────────────────────────────────────────────────────────────────

  /**
   * Return an `otpauth://totp/…` URI (SHA1, 6 digits, 30s period) that
   * authenticator apps can scan as a QR code.
   *
   * @param label - Account label shown in the app, e.g. the user's email.
   * @param secret - The base-32 secret from {@link generateSecret}.
   * @param issuer - Overrides the constructor `issuer` for this URI.
   * @returns The `otpauth://` provisioning URI.
   * @category Secret
   */
  getQrCodeUrl(label: string, secret: string, issuer?: string): string {
    const iss = encodeURIComponent(issuer ?? this._issuer);
    const lbl = encodeURIComponent(`${issuer ?? this._issuer}:${label}`);
    return `otpauth://totp/${lbl}?secret=${secret}&issuer=${iss}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`;
  }

  // ── Verify TOTP ──────────────────────────────────────────────────────────────

  /**
   * Verify a 6-digit TOTP code against the stored secret synchronously.
   *
   * Pass the user's persisted last-used counter (see
   * {@link verifyCodeWithCounter}) to reject replays of a code within its
   * validity window. Without it, an intercepted code stays valid for up to
   * `window` periods — RFC 6238 §5.2 requires one-time use.
   *
   * @param secret - The user's stored base-32 secret.
   * @param token - The 6-digit code entered by the user (whitespace tolerated).
   * @param lastUsedCounter - The user's persisted last-used counter, for replay protection.
   * @returns `true` when the code is valid (and, if `lastUsedCounter` given, not a replay).
   * @category Verifying
   */
  verifyCode(secret: string, token: string, lastUsedCounter?: number | null): boolean {
    return this.verifyCodeWithCounter(secret, token, lastUsedCounter).valid;
  }

  /**
   * Verify a TOTP code and return the time-step counter it matched, so the
   * caller can persist it (next to the secret) as the replay guard.
   *
   * A code is rejected when its counter is ≤ `lastUsedCounter`, enforcing the
   * RFC 6238 §5.2 rule that a verifier "MUST NOT accept the second attempt of
   * the OTP after the successful validation".
   *
   * Comparison of the expected vs. entered code uses a constant-time string
   * compare — every window slot is checked even after a match, so timing does
   * not reveal which slot (or whether any slot) matched.
   *
   * @param secret - The user's stored base-32 secret.
   * @param token - The 6-digit code entered by the user (whitespace tolerated).
   * @param lastUsedCounter - The last successfully-used time-step counter, or null/undefined
   *   if none has been recorded yet.
   * @returns `{ valid, counter }` — `counter` is the matched time-step to persist on success,
   *   or `null` when invalid or rejected as a replay.
   * @category Verifying
   * @example
   * ```ts
   * const result = tf.verifyCodeWithCounter(secret, input, user.twoFactorLastCounter);
   * if (result.valid) await user.update({ twoFactorLastCounter: result.counter });
   * ```
   */
  /**
   * Produce the TOTP code a correctly-configured authenticator would show right
   * now — the counterpart to {@link verifyCode}.
   *
   * This exists for tests. Without it the challenge flow is untestable without
   * reimplementing RFC 6238 in your own suite, which is both tedious and a
   * second implementation to get wrong. Drive your challenge endpoint with this
   * instead.
   *
   * @param secret - The user's stored base-32 secret.
   * @param offset - Time-step slots from now. `-1` yields the previous code,
   *   which is useful for asserting that your replay guard rejects it.
   * @returns The zero-padded six-digit code.
   * @category Verifying
   *
   * @example
   * ```ts
   * const code = tf.generateCode(user.twoFactorSecret);
   * const res = await app.actingAs(user).post("/two-factor/challenge", { code });
   * ```
   *
   * @remarks
   * Never send this to a user. A code the server generated is a code the server
   * knows, which is precisely what a second factor must not be.
   */
  generateCode(secret: string, offset = 0): string {
    const slot = currentCounter() + BigInt(Math.trunc(offset));
    if (slot < 0n) throw new RangeError("generateCode: offset predates the epoch.");
    return String(hotp(base32Decode(secret), slot)).padStart(DIGITS, "0");
  }

  verifyCodeWithCounter(
    secret: string,
    token: string,
    lastUsedCounter?: number | null,
  ): { valid: boolean; counter: number | null } {
    const normalised = token.replace(/\s/g, "");
    if (!/^\d{6}$/.test(normalised)) return { valid: false, counter: null };

    const keyBuffer = base32Decode(secret);
    const counter = currentCounter();
    const last = typeof lastUsedCounter === "number" ? BigInt(Math.floor(lastUsedCounter)) : null;

    // Check every slot in the ±window range. We never break early on a match so
    // timing does not reveal which slot (or whether any) matched. The highest
    // matching counter wins, which is also the newest code.
    let matched: bigint | null = null;
    for (let i = -this._window; i <= this._window; i++) {
      const slot = counter + BigInt(i);
      if (slot < 0n) continue;
      const expected = String(hotp(keyBuffer, slot)).padStart(DIGITS, "0");
      if (safeEqual(expected, normalised)) matched = slot;
    }

    if (matched === null) return { valid: false, counter: null };
    // Replay guard (RFC 6238 §5.2): a code whose counter is not strictly newer
    // than the last successfully-used one is rejected.
    if (last !== null && matched <= last) return { valid: false, counter: null };

    return { valid: true, counter: Number(matched) };
  }

  // ── Recovery codes ────────────────────────────────────────────────────────────

  /**
   * Generate single-use recovery codes. Returns the `plain` codes to show the
   * user **once** and the `hashed` codes (SHA-256 hex) to persist. Store only
   * the hashes — a leaked database row then can't reveal the codes.
   *
   * Each code carries {@link RECOVERY_CODE_BITS} bits of CSPRNG entropy. That number is
   * the whole security argument for storing them under a single fast hash: a recovery
   * code is a complete second-factor bypass, so a leaked column must not be searchable.
   * At 160 bits it is not, with or without a salt.
   *
   * @returns `{ plain, hashed }` — show `plain` once, persist `hashed`. The count is
   *   the constructor's `recoveryCodeCount` (default 8).
   * @category Recovery codes
   * @example
   * ```ts
   * const { plain, hashed } = tf.generateRecoveryCodes();
   * await user.update({ twoFactorRecoveryCodes: JSON.stringify(hashed) });
   * ```
   */
  generateRecoveryCodes(): { plain: string[]; hashed: string[] } {
    const plain: string[] = [];
    const hashed: string[] = [];
    for (let i = 0; i < this._recoveryCodeCount; i++) {
      const code = _mintRecoveryCode();
      plain.push(code);
      hashed.push(sha256Hex(code));
    }
    return { plain, hashed };
  }

  /**
   * Verify a recovery code against the stored hashes. On a match returns the
   * remaining hashes with the used one removed (single-use — persist them);
   * on a miss returns the hashes unchanged. Comparison is constant-time and the
   * input is normalised (trimmed, lowercased, whitespace stripped).
   *
   * @param hashedCodes - The user's stored recovery-code hashes.
   * @param code - The recovery code entered by the user.
   * @returns `{ valid, remaining }` — on a match, `remaining` omits the used hash and
   *   must be persisted; on a miss, `remaining` is the input unchanged.
   * @category Recovery codes
   * @example
   * ```ts
   * const result = tf.verifyRecoveryCode(JSON.parse(user.twoFactorRecoveryCodes), input);
   * if (result.valid) await user.update({ twoFactorRecoveryCodes: JSON.stringify(result.remaining) });
   * ```
   */
  verifyRecoveryCode(hashedCodes: string[], code: string): { valid: boolean; remaining: string[] } {
    const target = sha256Hex(this._normaliseRecoveryCode(code));
    let matchedIndex = -1;
    for (let i = 0; i < hashedCodes.length; i++) {
      // Both operands are 64-char SHA-256 hex, so safeEqual's length pre-check
      // never short-circuits on a real stored code.
      if (safeEqual(hashedCodes[i]!, target)) matchedIndex = i;
    }
    if (matchedIndex === -1) return { valid: false, remaining: hashedCodes };
    return { valid: true, remaining: hashedCodes.filter((_, i) => i !== matchedIndex) };
  }

  /** @internal Normalise a recovery code for comparison (trim, lowercase, strip whitespace). */
  private _normaliseRecoveryCode(code: string): string {
    return code.trim().toLowerCase().replace(/\s+/g, "");
  }
}
