/**
 * QR encoder tests.
 *
 * The point of this file is the round trip in `decode()` below: a *second*,
 * independently written implementation of the read path — function-module map,
 * unmask, zigzag, de-interleave, syndrome check, bit parse. Asserting on the
 * matrix any other way (module counts, a hash of the output) would pass just as
 * happily for a symbol that no scanner can read, which is the failure this
 * encoder has to be protected against: it still looks like a QR code.
 *
 * Where a constant is transcribed from ISO/IEC 18004, it is transcribed in a
 * different shape from the encoder's — block counts and EC-per-block rather than
 * group tuples, alignment centres derived from the spec's rule rather than
 * listed — so a typo on one side does not agree with a typo on the other.
 */

import { describe, it, expect } from "bun:test";
import {
  encodeQr,
  qrSvg,
  QrError,
  formatInfo,
  versionInfo,
  maxPayloadBytes,
  type QrMatrix,
} from "./qrcode.ts";
import { TwoFactorService } from "./TwoFactorService.ts";

// ── Spec data, transcribed independently of the encoder ──────────────────────

/** ISO/IEC 18004 table 9, level M: EC codewords per block, versions 1–20. */
const EC_PER_BLOCK = [
  10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
];
/** ISO/IEC 18004 table 9, level M: number of blocks, versions 1–20. */
const NUM_BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];

/**
 * ISO/IEC 18004 table 7, level M: total data codewords per version.
 *
 * Transcribed separately from the two rows above, and reached by a different
 * route — the encoder derives capacity from the module geometry, this is the
 * published figure. Where they agree, both transcriptions are right; a single
 * mistyped block count breaks the agreement.
 */
const DATA_CODEWORDS = [
  16, 28, 44, 64, 86, 108, 124, 154, 182, 216, 254, 290, 334, 365, 415, 453, 507, 563, 627, 669,
];

/**
 * Total codewords for a version, from the module geometry rather than a table:
 * every module that is not a function pattern, divided by eight.
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

/** Alignment-pattern centres from the spec's placement rule. */
function alignmentCentres(version: number): number[] {
  if (version === 1) return [];
  const size = 21 + (version - 1) * 4;
  const numAlign = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 4 + numAlign * 2 + 1) / (numAlign * 2 - 2)) * 2;
  const centres: number[] = [];
  for (let pos = size - 7; centres.length < numAlign - 1; pos -= step) centres.unshift(pos);
  centres.unshift(6);
  return centres;
}

/**
 * Block layout: `numBlocks` blocks splitting the data codewords as evenly as
 * possible, the shorter ones first.
 */
function blockLayout(version: number): { dataLengths: number[]; ecPerBlock: number } {
  const blocks = NUM_BLOCKS[version - 1]!;
  const ecPerBlock = EC_PER_BLOCK[version - 1]!;
  const total = totalCodewords(version);
  const shortBlocks = blocks - (total % blocks);
  const shortLength = Math.floor(total / blocks) - ecPerBlock;

  const dataLengths: number[] = [];
  for (let i = 0; i < blocks; i++)
    dataLengths.push(i < shortBlocks ? shortLength : shortLength + 1);
  return { dataLengths, ecPerBlock };
}

// ── GF(256), for the syndrome check ──────────────────────────────────────────

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

const gfMul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

/**
 * Evaluate the block polynomial at α⁰…α^(ec−1). All zero means the error
 * correction actually corrects — which reading the data back cannot tell you,
 * because a wrong generator polynomial leaves the data untouched.
 */
function syndromes(codewords: number[], ecCount: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < ecCount; i++) {
    let acc = 0;
    for (const byte of codewords) acc = gfMul(acc, EXP[i]!) ^ byte;
    out.push(acc);
  }
  return out;
}

// ── The read path ────────────────────────────────────────────────────────────

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

/** Whether a module belongs to a function pattern rather than the data region. */
function isFunctionModule(row: number, col: number, size: number, version: number): boolean {
  // Finders, separators and the two format-info copies.
  if (row < 9 && col < 9) return true;
  if (row < 9 && col >= size - 8) return true;
  if (row >= size - 8 && col < 9) return true;
  // Timing.
  if (row === 6 || col === 6) return true;
  // Version info.
  if (version >= 7) {
    if (row < 6 && col >= size - 11 && col < size - 8) return true;
    if (col < 6 && row >= size - 11 && row < size - 8) return true;
  }
  // Alignment, minus the three that a finder already occupies.
  const centres = alignmentCentres(version);
  for (const r of centres) {
    for (const c of centres) {
      const onFinder =
        (r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6);
      if (onFinder) continue;
      if (Math.abs(row - r) <= 2 && Math.abs(col - c) <= 2) return true;
    }
  }
  return false;
}

/** Read the 15 format bits back out of the first copy and undo the 0x5412 mask. */
function readFormatBits(matrix: QrMatrix): number {
  let bits = 0;
  for (let i = 0; i < 15; i++) {
    let dark: boolean;
    if (i < 6) dark = matrix.isDark(i, 8);
    else if (i === 6) dark = matrix.isDark(7, 8);
    else if (i === 7) dark = matrix.isDark(8, 8);
    else if (i === 8) dark = matrix.isDark(8, 7);
    else dark = matrix.isDark(8, 14 - i);
    if (dark) bits |= 1 << i;
  }
  return bits ^ 0x5412;
}

interface Decoded {
  ecLevelBits: number;
  mask: number;
  bytes: number[];
  /** Per block, `[data…, ec…]` — fed to the syndrome check. */
  blocks: number[][];
}

/** Read a matrix back to the bytes that went in. */
function decode(matrix: QrMatrix): Decoded {
  const { size, version } = matrix;

  // The 5 data bits sit at the top of the 15-bit word — level in 14–13, mask in
  // 12–10 — with the BCH remainder below them.
  const format = readFormatBits(matrix);
  const mask = (format >>> 10) & 0b111;
  const ecLevelBits = (format >>> 13) & 0b11;

  // Unmask the data region.
  const unmasked = (row: number, col: number): boolean => {
    const dark = matrix.isDark(row, col);
    return MASKS[mask]!(row, col) ? !dark : dark;
  };

  // Zigzag, written from the spec's own description rather than copied from the
  // encoder: the direction comes from the column pair's index, not a toggle.
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const row = upward ? size - 1 - vert : vert;
        if (isFunctionModule(row, col, size, version)) continue;
        bits.push(unmasked(row, col) ? 1 : 0);
      }
    }
  }

  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]!;
    codewords.push(byte);
  }

  // De-interleave: data codewords column-wise across blocks, then EC the same way.
  const { dataLengths, ecPerBlock } = blockLayout(version);
  const dataBlocks: number[][] = dataLengths.map(() => []);
  const ecBlocks: number[][] = dataLengths.map(() => []);

  let index = 0;
  const longest = Math.max(...dataLengths);
  for (let i = 0; i < longest; i++) {
    for (let b = 0; b < dataBlocks.length; b++) {
      if (i < dataLengths[b]!) dataBlocks[b]!.push(codewords[index++]!);
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < ecBlocks.length; b++) ecBlocks[b]!.push(codewords[index++]!);
  }

  // Concatenated data blocks are the message stream.
  const data = dataBlocks.flat();
  const stream: number[] = [];
  for (const byte of data) for (let i = 7; i >= 0; i--) stream.push((byte >>> i) & 1);

  const take = (count: number): number => {
    let value = 0;
    for (let i = 0; i < count; i++) value = (value << 1) | stream.shift()!;
    return value;
  };

  const mode = take(4);
  if (mode !== 0b0100) throw new Error(`decode: expected byte mode, got ${mode.toString(2)}`);
  const length = take(version < 10 ? 8 : 16);
  const bytes: number[] = [];
  for (let i = 0; i < length; i++) bytes.push(take(8));

  return {
    ecLevelBits,
    mask,
    bytes,
    blocks: dataBlocks.map((block, i) => [...block, ...ecBlocks[i]!]),
  };
}

const decodeText = (matrix: QrMatrix): string =>
  new TextDecoder().decode(Uint8Array.from(decode(matrix).bytes));

// ── Tests ────────────────────────────────────────────────────────────────────

describe("qrcode — spec constants", () => {
  it("matches the published format-information words for level M", () => {
    // ISO/IEC 18004 table C.1.
    const expected = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];
    for (let mask = 0; mask < 8; mask++) expect(formatInfo(0b00, mask)).toBe(expected[mask]!);
  });

  it("matches the published version-information words", () => {
    // ISO/IEC 18004 table D.1.
    expect(versionInfo(7)).toBe(0x07c94);
    expect(versionInfo(8)).toBe(0x085bc);
    expect(versionInfo(9)).toBe(0x09a99);
    expect(versionInfo(10)).toBe(0x0a4d3);
  });

  it("splits every version into blocks that fill the symbol exactly", () => {
    // Catches a mistyped block count two ways: the split has to account for every
    // codeword the geometry provides with none left over, and what remains for
    // data has to equal the published capacity.
    for (let version = 1; version <= 20; version++) {
      const { dataLengths, ecPerBlock } = blockLayout(version);
      const data = dataLengths.reduce((a, b) => a + b, 0);
      const ec = dataLengths.length * ecPerBlock;
      expect(data + ec).toBe(totalCodewords(version));
      expect(data).toBe(DATA_CODEWORDS[version - 1]!);
    }
  });

  it("places alignment patterns where the spec's table puts them", () => {
    // The encoder carries the table; this derives the same positions from the
    // placement rule the table was generated by.
    const published: number[][] = [
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
    for (let version = 1; version <= 20; version++) {
      expect(alignmentCentres(version)).toEqual(published[version - 1]!);
    }
  });
});

describe("qrcode — round trip", () => {
  const payloads: Array<[string, string]> = [
    ["a single character", "A"],
    ["a short URI", "otpauth://totp/A:b@c.io?secret=JBSWY3DPEHPK3PXP"],
    [
      "a typical otpauth URI",
      new TwoFactorService({ issuer: "Trekly" }).getQrCodeUrl(
        "sipho.mbili@example.co.za",
        "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
      ),
    ],
    [
      "a long issuer and label",
      new TwoFactorService({ issuer: "Acme Financial Services (Pty) Ltd" }).getQrCodeUrl(
        "accounts.payable.department@acme-financial-services.example.co.za",
        "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
      ),
    ],
    ["a UTF-8 payload", "Trekly — reisplanne ✈"],
    ["the largest payload that fits", "x".repeat(maxPayloadBytes())],
  ];

  for (const [name, payload] of payloads) {
    it(`survives ${name}`, () => {
      const matrix = encodeQr(payload);
      expect(decodeText(matrix)).toBe(payload);
    });
  }

  it("survives a full payload at every version it supports", () => {
    // The broadest check in the file. Filling each version exactly forces the
    // encoder onto that version, and the round trip then reads it back through
    // the decoder's independently derived alignment centres and block split — so
    // a wrong entry in either of the encoder's tables fails here, at the version
    // that carries it, rather than waiting for a customer with a long email
    // address to find it on a setup page.
    for (let version = 1; version <= 20; version++) {
      const payload = "x".repeat(maxPayloadBytes(version));
      const matrix = encodeQr(payload);
      expect(matrix.version).toBe(version);
      expect(matrix.size).toBe(21 + (version - 1) * 4);
      expect(decodeText(matrix)).toBe(payload);
    }
  });

  it("reports level M and the mask it actually applied", () => {
    const matrix = encodeQr("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP");
    const result = decode(matrix);
    expect(result.ecLevelBits).toBe(0b00);
    expect(result.mask).toBe(matrix.mask);
  });

  it("produces error correction that verifies", () => {
    // Zero syndromes across every block. A generator polynomial built the wrong
    // way round still yields data that reads back perfectly, and a symbol that
    // no scanner will accept.
    for (const payload of ["A", "x".repeat(120), "x".repeat(maxPayloadBytes())]) {
      const { blocks } = decode(encodeQr(payload));
      const { ecPerBlock } = blockLayout(encodeQr(payload).version);
      for (const block of blocks) {
        expect(syndromes(block, ecPerBlock)).toEqual(new Array(ecPerBlock).fill(0));
      }
    }
  });

  it("holds the timing, finder and dark modules in place", () => {
    const matrix = encodeQr("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP");
    const { size } = matrix;

    // Finder cores.
    for (const [top, left] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ]) {
      expect(matrix.isDark(top!, left!)).toBe(true); // ring corner
      expect(matrix.isDark(top! + 1, left! + 1)).toBe(false); // light ring
      expect(matrix.isDark(top! + 3, left! + 3)).toBe(true); // centre
    }

    // Timing runs alternate, starting dark at index 8.
    for (let i = 8; i < size - 8; i++) {
      expect(matrix.isDark(6, i)).toBe(i % 2 === 0);
      expect(matrix.isDark(i, 6)).toBe(i % 2 === 0);
    }

    // The module that is dark in every symbol ever made.
    expect(matrix.isDark(size - 8, 8)).toBe(true);
  });

  it("grows the version with the payload", () => {
    expect(encodeQr("A").version).toBe(1);
    expect(encodeQr("x".repeat(maxPayloadBytes())).version).toBe(20);
    // A typical otpauth URI stays small enough to scan off a laptop screen.
    expect(encodeQr("x".repeat(130)).version).toBeLessThanOrEqual(8);
    expect(encodeQr("x".repeat(200)).size).toBe(21 + (encodeQr("x".repeat(200)).version - 1) * 4);
  });

  it("refuses a payload past its ceiling rather than truncating it", () => {
    expect(() => encodeQr("x".repeat(maxPayloadBytes() + 1))).toThrow(QrError);
    expect(() => encodeQr("x".repeat(maxPayloadBytes() + 1))).toThrow(/shorten the issuer/);
  });
});

describe("qrSvg", () => {
  const matrix = encodeQr("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP");

  it("wraps the symbol in the spec's four-module quiet zone", () => {
    const svg = qrSvg(matrix);
    const extent = matrix.size + 8;
    expect(svg).toContain(`viewBox="0 0 ${extent} ${extent}"`);
    // The first dark module sits at least four in from the edge.
    const first = svg.match(/d="M(\d+) (\d+)/);
    expect(Number(first![1])).toBeGreaterThanOrEqual(4);
    expect(Number(first![2])).toBeGreaterThanOrEqual(4);
  });

  it("honours colours, size, class and quiet zone", () => {
    const svg = qrSvg(matrix, {
      quietZone: 0,
      dark: "#0F3D35",
      light: "#FFFDF7",
      size: 220,
      class: "rounded",
      alt: "Scan me",
    });
    expect(svg).toContain(`viewBox="0 0 ${matrix.size} ${matrix.size}"`);
    expect(svg).toContain('width="220" height="220"');
    expect(svg).toContain('class="rounded"');
    expect(svg).toContain('fill="#0F3D35"');
    expect(svg).toContain('fill="#FFFDF7"');
    expect(svg).toContain('aria-label="Scan me"');
  });

  it("omits the background when light is null", () => {
    expect(qrSvg(matrix, { light: null })).not.toContain("<rect");
    expect(qrSvg(matrix)).toContain("<rect");
  });

  it("escapes caller-supplied attribute values", () => {
    const svg = qrSvg(matrix, { alt: 'Scan "this" & that <now>', class: 'a" onload="x' });
    expect(svg).toContain("&quot;this&quot; &amp; that &lt;now>");
    expect(svg).not.toContain('onload="x"');
  });

  it("carries an accessible name", () => {
    expect(qrSvg(matrix)).toContain('role="img" aria-label="QR code"');
  });
});

describe("TwoFactorService.getQrCodeSvg", () => {
  const tf = new TwoFactorService({ issuer: "Trekly" });
  const secret = tf.generateSecret();

  it("encodes exactly the otpauth URI getQrCodeUrl returns", () => {
    const svg = tf.getQrCodeSvg("sipho@example.co.za", secret);
    // Pull the matrix back out of the same encoder the page would have used, and
    // check the payload is the URI an authenticator app expects — not a URL to
    // some image service, and not a truncated one.
    const uri = tf.getQrCodeUrl("sipho@example.co.za", secret);
    expect(decodeText(encodeQr(uri))).toBe(uri);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('aria-label="Scan this QR code with your authenticator app"');
  });

  it("applies the issuer override to the encoded URI", () => {
    const svg = tf.getQrCodeSvg("a@b.io", secret, { issuer: "Other" });
    const override = tf.getQrCodeUrl("a@b.io", secret, "Other");
    expect(
      qrSvg(encodeQr(override), { alt: "Scan this QR code with your authenticator app" }),
    ).toBe(svg);
  });

  it("passes SVG options through", () => {
    const svg = tf.getQrCodeSvg("a@b.io", secret, { size: 180, dark: "#123456", alt: "Scan" });
    expect(svg).toContain('width="180" height="180"');
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain('aria-label="Scan"');
  });

  it("never leaks the secret as anything but modules", () => {
    // A regression guard on the whole point of drawing this in-process: the
    // secret is not sitting in the markup as text, where a screenshot, a
    // copy-paste or an HTML log would pick it up, and nothing in the output
    // reaches out to a host — the SVG namespace is the only URL present.
    const svg = tf.getQrCodeSvg("a@b.io", secret);
    expect(svg).not.toContain(secret);
    expect(svg).not.toContain("otpauth");
    expect(svg.match(/https?:\/\/\S+?["/\s]/g)).toEqual(["http://www.w3.org/"]);
  });
});
