/**
 * @zerotal/testing — file builders for upload tests.
 *
 * The files here are *real*: a PNG built by `fakeFile.image()` has the PNG
 * signature, a valid IHDR at the size you asked for, and compressed pixel data.
 * That matters because the framework does not trust what an upload claims to
 * be — `UploadedFile.store()` and `detectType()` sniff the leading bytes and
 * name the stored file from what they find. A placeholder full of zero bytes
 * declared as `image/png` would sail through a `mimes` check and then be stored
 * as `application/octet-stream`, so the test would pass while the behaviour it
 * describes never happened.
 *
 * @example
 * import { fakeFile } from '@zerotal/testing';
 *
 * await app.multipart('/avatar', { avatar: fakeFile.image('me.png') });
 * await app.multipart('/docs', { doc: fakeFile.pdf('terms.pdf') });
 * await app.multipart('/import', { csv: fakeFile.create('rows.csv', 'a,b\n1,2', 'text/csv') });
 */

import { deflateSync } from "node:zlib";

export const fakeFile = {
  /**
   * A file with exactly the contents you give it.
   *
   * @param name - Filename sent with the upload.
   * @param content - File contents; a string is encoded as UTF-8.
   * @param type - MIME type declared for the part.
   */
  create(name: string, content: string | Uint8Array = "", type = "text/plain"): File {
    const parts: BlobPart[] = [typeof content === "string" ? content : (content as BlobPart)];
    return new File(parts, name, { type });
  },

  /**
   * A file of `size` bytes, for exercising size limits. The contents are filler,
   * so use {@link image} or {@link pdf} when the bytes have to be recognisable.
   *
   * @example
   * // Over a 2 MB limit
   * fakeFile.sized('huge.bin', 3 * 1024 * 1024);
   */
  sized(name: string, size: number, type = "application/octet-stream"): File {
    return new File([new Uint8Array(size)], name, { type });
  },

  /**
   * A valid PNG image of the given dimensions.
   *
   * @param name - Filename sent with the upload.
   * @param options.width - Pixel width (default 10).
   * @param options.height - Pixel height (default 10).
   *
   * @example
   * fakeFile.image('avatar.png', { width: 64, height: 64 });
   */
  image(name = "image.png", options: { width?: number; height?: number } = {}): File {
    const { width = 10, height = 10 } = options;
    return new File([_png(width, height)], name, { type: "image/png" });
  },

  /** A minimal but structurally valid JPEG. */
  jpeg(name = "image.jpg"): File {
    return new File([_jpeg()], name, { type: "image/jpeg" });
  },

  /** A minimal GIF89a image. */
  gif(name = "image.gif"): File {
    const bytes = new Uint8Array([
      0x47,
      0x49,
      0x46,
      0x38,
      0x39,
      0x61, // "GIF89a"
      0x01,
      0x00,
      0x01,
      0x00,
      0x80,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0xff,
      0xff,
      0xff,
      0x21,
      0xf9,
      0x04,
      0x01,
      0x00,
      0x00,
      0x00,
      0x00,
      0x2c,
      0x00,
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x01,
      0x00,
      0x00,
      0x02,
      0x02,
      0x44,
      0x01,
      0x00,
      0x3b,
    ]);
    return new File([bytes], name, { type: "image/gif" });
  },

  /** A minimal one-page PDF. */
  pdf(name = "document.pdf"): File {
    return new File([_PDF], name, { type: "application/pdf" });
  },
};

export type FakeFile = typeof fakeFile;

// ── Format builders ───────────────────────────────────────────────────────────

/** Build a solid-white PNG of `width`×`height`. */
function _png(width: number, height: number): Uint8Array<ArrayBuffer> {
  // Raw scanlines: each row is a filter byte (0 = None) followed by RGB triples.
  const stride = width * 3 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    raw.fill(0xff, y * stride + 1, y * stride + stride);
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return _concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    _chunk("IHDR", ihdr),
    _chunk("IDAT", new Uint8Array(deflateSync(raw))),
    _chunk("IEND", new Uint8Array(0)),
  ]);
}

/** length ‖ type ‖ data ‖ CRC32(type ‖ data) — the PNG chunk layout. */
function _chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const typeBytes = new Uint8Array([...type].map((c) => c.charCodeAt(0)));
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, _crc32(_concat([typeBytes, data])));
  return out;
}

let _crcTable: Uint32Array | null = null;

function _crc32(bytes: Uint8Array): number {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      _crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = _crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** SOI ‖ JFIF APP0 ‖ EOI — enough for the signature check and a real header. */
function _jpeg(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x10, // APP0, length 16
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00, // "JFIF\0"
    0x01,
    0x01, // version 1.1
    0x00, // units: none
    0x00,
    0x01,
    0x00,
    0x01, // density 1×1
    0x00,
    0x00, // no thumbnail
    0xff,
    0xd9, // EOI
  ]);
}

const _PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;

function _concat(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
