/**
 * A QR encoder, sized for one job: the `otpauth://` URI on a two-factor setup page.
 *
 * **Why this is in the framework rather than left to the app.** The payload
 * contains the TOTP secret, so it cannot be handed to an image API — that posts
 * the one thing the second factor rests on to a third party, and leaves it in
 * that party's logs. Nor can it be served from a route of your own without
 * turning the secret into something requestable and cacheable. What is left is
 * drawing it in-process, which every app that turns 2FA on then has to write.
 * So it ships here: {@link TwoFactorService.getQrCodeSvg} hands back inline
 * markup and the secret never leaves the process.
 *
 * **Deliberately narrow.** Byte mode only, error-correction level M, versions 1
 * through 20 (up to 666 payload bytes). An `otpauth://` URI is ASCII and
 * typically about 130 characters, which lands at version 7 or 8; the rest of the
 * range is there because the issuer appears twice in the URI and is
 * percent-encoded, so a long company name and a long email address together push
 * past 250 bytes — and the failure would land on the setup page of exactly the
 * organisations most likely to mandate 2FA. Numeric, alphanumeric and kanji modes
 * would encode this payload no better and are simply absent.
 *
 * The pipeline is the standard one (ISO/IEC 18004), in order:
 *
 * ```text
 * text → bit stream → data codewords → Reed-Solomon → interleave →
 * module placement → mask selection → format/version info → matrix
 * ```
 *
 * `qrcode.test.ts` reads a generated matrix back through an independently
 * written extraction path and checks the bytes survive the round trip, which is
 * what catches a placement or masking error — the class of bug that still looks
 * like a QR code and scans as nothing.
 *
 * @packageDocumentation
 */

import { ZerotalError } from "@zerotal/core";

/** Thrown when a payload is larger than this encoder's version range covers. */
export class QrError extends ZerotalError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "E_QR_PAYLOAD_TOO_LARGE", 500, context);
  }
}

/** Error-correction level M — ~15% recovery. The usual choice for `otpauth://` URIs. */
const EC_LEVEL_BITS = 0b00;

/**
 * ISO/IEC 18004 table 9, level M: error-correction codewords per block, and the
 * number of blocks, for versions 1–20.
 *
 * These two rows are the whole table. Everything else — total codewords, data
 * capacity, how the data divides between blocks — follows from the symbol's
 * geometry, so it is computed below rather than transcribed. A block table typed
 * out by hand is a few hundred chances to produce a symbol that fills its space
 * correctly and scans as nothing; `qrcode.test.ts` pins the derived capacities
 * against the published ones so a mistyped entry here fails loudly.
 */
const EC_PER_BLOCK = [
  10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
];
const NUM_BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];

/** The largest symbol this encoder builds. Version 20 at level M holds 669 data codewords. */
const MAX_VERSION = EC_PER_BLOCK.length;

/** Centre coordinates of the alignment patterns, by version. */
const ALIGNMENT: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
];

/**
 * Codewords a version holds in total, from the module count: the full grid,
 * less the finders and their separators, the timing runs, the alignment
 * patterns, and the format/version information.
 */
function totalCodewords(version: number): number {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    modules -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) modules -= 36;
  }
  return Math.floor(modules / 8);
}

/**
 * Data codewords per block, shortest first.
 *
 * The blocks divide the data as evenly as the codeword count allows; where it
 * does not divide, the remainder goes to the trailing blocks, one each. This is
 * the rule the spec's table is generated from.
 */
function blockLengths(version: number): number[] {
  const blocks = NUM_BLOCKS[version - 1]!;
  const total = totalCodewords(version);
  const shortCount = blocks - (total % blocks);
  const shortLength = Math.floor(total / blocks) - EC_PER_BLOCK[version - 1]!;

  return Array.from({ length: blocks }, (_, i) => (i < shortCount ? shortLength : shortLength + 1));
}

// ── Galois field GF(256), primitive polynomial 0x11D ──────────────────────────

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

/**
 * The generator polynomial for `degree` error-correction codewords:
 * (x − α⁰)(x − α¹)…(x − α^(degree−1)), coefficients highest power first.
 *
 * @internal
 */
export function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    // Multiply by (x − αⁱ). Coefficients are highest power first, so the shift
    // goes to the *lower* index and the α term to the higher one. Reversing
    // these two lines produces a polynomial that is a valid-looking mirror of
    // the right one — and the error correction it generates is silently wrong,
    // which no amount of reading the data back will reveal. See the syndrome
    // check in qrcode.test.ts.
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j] ?? 0) ^ poly[j]!;
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

/** Remainder of `data` divided by the generator polynomial — the EC codewords. */
function reedSolomon(data: number[], ecCount: number): number[] {
  const gen = generatorPoly(ecCount);
  const remainder = new Array<number>(ecCount).fill(0);

  for (const byte of data) {
    const factor = byte ^ remainder[0]!;
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < ecCount; i++) {
      remainder[i] = remainder[i]! ^ gfMul(gen[i + 1]!, factor);
    }
  }

  return remainder;
}

// ── Bit stream ────────────────────────────────────────────────────────────────

class Bits {
  readonly bits: number[] = [];

  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }

  get length(): number {
    return this.bits.length;
  }
}

/** The smallest version whose data capacity holds `byteLength` bytes in byte mode. */
function chooseVersion(byteLength: number): number {
  for (let version = 1; version <= MAX_VERSION; version++) {
    if (byteLength <= maxPayloadBytes(version)) return version;
  }
  const ceiling = maxPayloadBytes();
  throw new QrError(
    `[Qr] ${byteLength} bytes is more than this encoder covers — it stops at version ` +
      `${MAX_VERSION}, which holds ${ceiling}. For a two-factor URI, shorten the issuer ` +
      `or the account label.`,
    { byteLength, maxBytes: ceiling },
  );
}

/**
 * Payload bytes a version holds in byte mode, once the mode indicator and the
 * character count have been paid for. Called with no argument, the ceiling of
 * the whole encoder.
 *
 * @param version - Symbol version, 1–20. Defaults to the largest.
 * @returns The largest payload, in bytes, that version encodes.
 * @category Two-factor
 */
export function maxPayloadBytes(version: number = MAX_VERSION): number {
  const countBits = version < 10 ? 8 : 16;
  return Math.floor((dataCodewords(version) * 8 - 4 - countBits) / 8);
}

function dataCodewords(version: number): number {
  return totalCodewords(version) - NUM_BLOCKS[version - 1]! * EC_PER_BLOCK[version - 1]!;
}

// ── Matrix ────────────────────────────────────────────────────────────────────

type Matrix = { size: number; modules: Uint8Array; reserved: Uint8Array };

function newMatrix(size: number): Matrix {
  return { size, modules: new Uint8Array(size * size), reserved: new Uint8Array(size * size) };
}

function set(m: Matrix, row: number, col: number, dark: boolean, reserve = true): void {
  m.modules[row * m.size + col] = dark ? 1 : 0;
  if (reserve) m.reserved[row * m.size + col] = 1;
}

function isReserved(m: Matrix, row: number, col: number): boolean {
  return m.reserved[row * m.size + col] === 1;
}

function isDark(m: Matrix, row: number, col: number): boolean {
  return m.modules[row * m.size + col] === 1;
}

/** The three 7×7 corner squares and the light separators around them. */
function placeFinders(m: Matrix): void {
  for (const [top, left] of [
    [0, 0],
    [0, m.size - 7],
    [m.size - 7, 0],
  ] as const) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const row = top + r;
        const col = left + c;
        if (row < 0 || row >= m.size || col < 0 || col >= m.size) continue;
        const inRing =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        set(m, row, col, inRing || inCore);
      }
    }
  }
}

/** The alternating run joining the finders. */
function placeTiming(m: Matrix): void {
  for (let i = 8; i < m.size - 8; i++) {
    const dark = i % 2 === 0;
    set(m, 6, i, dark);
    set(m, i, 6, dark);
  }
}

function placeAlignment(m: Matrix, version: number): void {
  const centres = ALIGNMENT[version - 1] ?? [];

  for (const row of centres) {
    for (const col of centres) {
      // Skipped where a finder already sits.
      if (
        (row === 6 && col === 6) ||
        (row === 6 && col === m.size - 7) ||
        (row === m.size - 7 && col === 6)
      ) {
        continue;
      }

      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const ring = Math.max(Math.abs(r), Math.abs(c));
          set(m, row + r, col + c, ring !== 1);
        }
      }
    }
  }
}

/** Marks where format and version information will go, so data skips it. */
function reserveInfoAreas(m: Matrix, version: number): void {
  for (let i = 0; i < 9; i++) {
    if (!isReserved(m, 8, i)) set(m, 8, i, false);
    if (!isReserved(m, i, 8)) set(m, i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!isReserved(m, 8, m.size - 1 - i)) set(m, 8, m.size - 1 - i, false);
    if (!isReserved(m, m.size - 1 - i, 8)) set(m, m.size - 1 - i, 8, false);
  }
  // Always dark, always at the same spot.
  set(m, m.size - 8, 8, true);

  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const row = Math.floor(i / 3);
      const col = m.size - 11 + (i % 3);
      set(m, row, col, false);
      set(m, col, row, false);
    }
  }
}

/** Two-column zigzag from the bottom right, skipping the vertical timing column. */
function placeData(m: Matrix, codewords: number[]): void {
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  const bitAt = (i: number): boolean =>
    i < totalBits && ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1;

  let upward = true;
  for (let right = m.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // column 6 is timing

    for (let step = 0; step < m.size; step++) {
      const row = upward ? m.size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (isReserved(m, row, col)) continue;
        set(m, row, col, bitAt(bitIndex), false);
        bitIndex++;
      }
    }
    upward = !upward;
  }
}

const MASKS: Array<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(m: Matrix, mask: number): void {
  const fn = MASKS[mask]!;
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (isReserved(m, r, c)) continue;
      const at = r * m.size + c;
      if (fn(r, c)) m.modules[at] = (m.modules[at] ?? 0) ^ 1;
    }
  }
}

/** The four penalty rules from the spec; the lowest total wins. */
function penalty(m: Matrix): number {
  const n = m.size;
  let score = 0;

  // Rule 1 — runs of five or more.
  for (let i = 0; i < n; i++) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j < n; j++) {
        const a = horizontal ? isDark(m, i, j) : isDark(m, j, i);
        const b = horizontal ? isDark(m, i, j - 1) : isDark(m, j - 1, i);
        if (a === b) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  // Rule 2 — 2×2 blocks of one colour.
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = isDark(m, r, c);
      if (v === isDark(m, r, c + 1) && v === isDark(m, r + 1, c) && v === isDark(m, r + 1, c + 1)) {
        score += 3;
      }
    }
  }

  // Rule 3 — the finder-like 1:1:3:1:1 sequence.
  const A = [true, false, true, true, true, false, true, false, false, false, false];
  const B = [false, false, false, false, true, false, true, true, true, false, true];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j + 11 <= n; j++) {
      let matchA = true;
      let matchB = true;
      let matchAv = true;
      let matchBv = true;
      for (let k = 0; k < 11; k++) {
        const h = isDark(m, i, j + k);
        const v = isDark(m, j + k, i);
        if (h !== A[k]) matchA = false;
        if (h !== B[k]) matchB = false;
        if (v !== A[k]) matchAv = false;
        if (v !== B[k]) matchBv = false;
      }
      if (matchA) score += 40;
      if (matchB) score += 40;
      if (matchAv) score += 40;
      if (matchBv) score += 40;
    }
  }

  // Rule 4 — how far the dark proportion strays from half.
  let dark = 0;
  for (let i = 0; i < n * n; i++) if (m.modules[i] === 1) dark++;
  const percent = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/**
 * BCH(15,5), then XOR with 0x5412 so an all-zero format never reads as valid.
 *
 * @internal
 */
export function formatInfo(ecLevelBits: number, mask: number): number {
  const data = (ecLevelBits << 3) | mask;
  let rem = data << 10;
  for (let i = 4; i >= 0; i--) {
    if ((rem >>> (10 + i)) & 1) rem ^= 0x537 << i;
  }
  return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
}

/**
 * BCH(18,6) — only versions 7 and above carry it.
 *
 * @internal
 */
export function versionInfo(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return ((version << 12) | (rem & 0xfff)) & 0x3ffff;
}

/**
 * The 15 format bits, written twice.
 *
 * The two copies are NOT "one round the top-left finder, one round the others".
 * Each is an L split between a vertical run in column 8 and a horizontal run in
 * row 8, and the bit order runs in opposite directions along the two arms. Get
 * the direction wrong and the result is the format word bit-reversed: the symbol
 * still looks like a QR code, the payload is still perfectly encoded underneath,
 * and every scanner refuses it — because format information is the first thing
 * read and nothing else is attempted once its BCH check fails.
 *
 * Indexing follows the spec's own numbering, bit 0 being the least significant.
 */
function placeFormatInfo(m: Matrix, mask: number): void {
  const bits = formatInfo(EC_LEVEL_BITS, mask);

  for (let i = 0; i < 15; i++) {
    const dark = ((bits >>> i) & 1) === 1;

    // Column 8: bits 0–7 beside the top-left finder, 8–14 above the bottom-left.
    if (i < 6) set(m, i, 8, dark);
    else if (i < 8) set(m, i + 1, 8, dark);
    else set(m, m.size - 15 + i, 8, dark);

    // Row 8: bits 0–7 beside the top-right finder, 8–14 back towards the origin.
    if (i < 8) set(m, 8, m.size - 1 - i, dark);
    else if (i === 8) set(m, 8, 7, dark);
    else set(m, 8, 14 - i, dark);
  }

  // Always dark, and written last: the column-8 run above stops one short of it,
  // but an off-by-one there would silently erase it.
  set(m, m.size - 8, 8, true);
}

function placeVersionInfo(m: Matrix, version: number): void {
  if (version < 7) return;
  const bits = versionInfo(version);

  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const row = Math.floor(i / 3);
    const col = m.size - 11 + (i % 3);
    set(m, row, col, dark);
    set(m, col, row, dark);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** A finished QR symbol: the module grid, plus the version and mask it used. */
export interface QrMatrix {
  /** Modules per side, excluding the quiet zone. 21 at version 1, +4 per version. */
  size: number;
  /** The symbol version chosen for the payload, 1–20. */
  version: number;
  /** The data mask pattern chosen by the penalty rules, 0–7. */
  mask: number;
  /** Row-major, 1 = dark. */
  modules: Uint8Array;
  /** Whether the module at `row`/`col` is dark. */
  isDark(row: number, col: number): boolean;
}

/**
 * Encode `text` and return the finished module matrix.
 *
 * Use this when you want to draw the symbol yourself — to a canvas, a PNG, or
 * your own markup. For the common case of an inline `<svg>`, reach for
 * {@link TwoFactorService.getQrCodeSvg} instead.
 *
 * @param text - The payload. ASCII or UTF-8, up to {@link maxPayloadBytes} (666) bytes.
 * @returns The module matrix, with the version and mask that were chosen.
 * @throws {@link QrError} when the payload exceeds what version 20 holds.
 * @category Two-factor
 *
 * @example
 * ```ts
 * const matrix = encodeQr(tf.getQrCodeUrl(user.email, secret));
 * for (let row = 0; row < matrix.size; row++) {
 *   for (let col = 0; col < matrix.size; col++) {
 *     if (matrix.isDark(row, col)) ctx.fillRect(col * 4, row * 4, 4, 4);
 *   }
 * }
 * ```
 */
export function encodeQr(text: string): QrMatrix {
  const bytes = [...new TextEncoder().encode(text)];
  const version = chooseVersion(bytes.length);
  const ecPerBlock = EC_PER_BLOCK[version - 1]!;
  const capacity = dataCodewords(version);

  // Mode indicator, length, payload.
  const stream = new Bits();
  stream.push(0b0100, 4);
  stream.push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) stream.push(byte, 8);

  // Terminator, then pad to a whole codeword, then the alternating pad bytes.
  stream.push(0, Math.min(4, capacity * 8 - stream.length));
  while (stream.length % 8 !== 0) stream.push(0, 1);

  const data: number[] = [];
  for (let i = 0; i < stream.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | stream.bits[i + j]!;
    data.push(byte);
  }
  for (let i = 0; data.length < capacity; i++) data.push(i % 2 === 0 ? 0xec : 0x11);

  // Split into blocks, and give each its own error correction.
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (const length of blockLengths(version)) {
    const block = data.slice(offset, offset + length);
    offset += length;
    dataBlocks.push(block);
    ecBlocks.push(reedSolomon(block, ecPerBlock));
  }

  // Interleave: one codeword from each block in turn, data then EC. A burst of
  // damage is then spread across blocks rather than destroying one outright.
  const interleaved: number[] = [];
  const longestData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < longestData; i++) {
    for (const block of dataBlocks) if (i < block.length) interleaved.push(block[i]!);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) interleaved.push(block[i]!);
  }

  // Function patterns first, so data placement knows what to skip.
  const size = 21 + (version - 1) * 4;
  const base = newMatrix(size);
  placeFinders(base);
  placeTiming(base);
  placeAlignment(base, version);
  reserveInfoAreas(base, version);
  placeData(base, interleaved);

  // Try every mask, keep the least penalised.
  let best: { matrix: Matrix; mask: number; score: number } | undefined;
  for (let mask = 0; mask < 8; mask++) {
    const candidate: Matrix = {
      size,
      modules: Uint8Array.from(base.modules),
      reserved: Uint8Array.from(base.reserved),
    };
    applyMask(candidate, mask);
    placeFormatInfo(candidate, mask);
    placeVersionInfo(candidate, version);

    const score = penalty(candidate);
    if (!best || score < best.score) best = { matrix: candidate, mask, score };
  }

  const chosen = best!;
  return {
    size,
    version,
    mask: chosen.mask,
    modules: chosen.matrix.modules,
    isDark: (row, col) => chosen.matrix.modules[row * size + col] === 1,
  };
}

/** How {@link qrSvg} draws a matrix. */
export interface QrSvgOptions {
  /** Accessible name for the image. Default: `"QR code"`. */
  alt?: string;
  /**
   * Light margin around the symbol, in modules. Default: `4`, which is what the
   * spec requires — scanners use it to find the edges, and a QR flush against a
   * coloured card often will not read. Drop it to `0` only when the surrounding
   * element already supplies a light margin of its own.
   */
  quietZone?: number;
  /** Colour of the dark modules. Default: `"#000000"`. */
  dark?: string;
  /** Background colour, or `null` for a transparent one. Default: `"#ffffff"`. */
  light?: string | null;
  /**
   * Width and height in pixels. Omitted by default, which leaves the symbol
   * scaling to whatever box you put it in via the `viewBox` alone.
   */
  size?: number;
  /** Value for the `class` attribute, for styling from your stylesheet. */
  class?: string;
}

/**
 * Render a matrix as an inline `<svg>` string.
 *
 * One `<path>` of rectangles rather than a node per module: a version-8 code is
 * 2,209 modules, and half of those as separate elements is a page the browser
 * spends real time laying out.
 *
 * @param matrix - A matrix from {@link encodeQr}.
 * @param options - Colours, quiet zone, size and accessible name.
 * @returns Markup to inline into a page — never a URL to fetch.
 * @category Two-factor
 *
 * @remarks
 * Inline it. For a two-factor payload the modules encode the TOTP secret, so
 * serving the same bytes from a route makes the secret requestable, loggable by
 * a proxy, and cacheable by the browser.
 */
export function qrSvg(matrix: QrMatrix, options: QrSvgOptions = {}): string {
  const quiet = Math.max(0, Math.trunc(options.quietZone ?? 4));
  const dark = options.dark ?? "#000000";
  const light = options.light === undefined ? "#ffffff" : options.light;
  const extent = matrix.size + quiet * 2;

  let path = "";
  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (matrix.isDark(row, col)) path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }

  const dimensions =
    options.size === undefined ? "" : ` width="${+options.size}" height="${+options.size}"`;
  const className = options.class === undefined ? "" : ` class="${escapeAttr(options.class)}"`;
  const background =
    light === null
      ? ""
      : `<rect width="${extent}" height="${extent}" fill="${escapeAttr(light)}"/>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}"${dimensions}${className} ` +
    `role="img" aria-label="${escapeAttr(options.alt ?? "QR code")}" shape-rendering="crispEdges">` +
    background +
    `<path d="${path}" fill="${escapeAttr(dark)}"/>` +
    `</svg>`
  );
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
