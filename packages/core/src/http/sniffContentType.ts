/**
 * Content-type detection from a file's own bytes.
 *
 * An upload arrives with two client-supplied claims about what it is — the filename's
 * extension and the multipart part's `Content-Type` — and neither is evidence. Storing
 * either verbatim is how `avatar` with filename `x.html` and `Content-Type: text/html`
 * becomes stored XSS on the asset origin. These helpers read the leading bytes instead.
 */

/** Signature table: leading bytes → the content type they identify. */
interface Signature {
  /** Byte prefix, or `null` for positions that may hold anything. */
  magic: (number | null)[];
  /** Offset the prefix starts at. */
  offset?: number;
  type: string;
  extension: string;
  /** Extra check for formats whose prefix alone is ambiguous (RIFF, ISO-BMFF). */
  verify?: (bytes: Uint8Array) => boolean;
}

const _ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

const _at = (bytes: Uint8Array, offset: number, text: string): boolean =>
  _ascii(text).every((code, i) => bytes[offset + i] === code);

/**
 * Ordered most-specific first. Deliberately narrow: this covers the formats an app
 * actually accepts as uploads, and everything else falls through to a type that browsers
 * will not execute.
 */
const SIGNATURES: Signature[] = [
  { magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], type: "image/png", extension: "png" },
  { magic: [0xff, 0xd8, 0xff], type: "image/jpeg", extension: "jpg" },
  { magic: _ascii("GIF87a"), type: "image/gif", extension: "gif" },
  { magic: _ascii("GIF89a"), type: "image/gif", extension: "gif" },
  {
    magic: _ascii("RIFF"),
    type: "image/webp",
    extension: "webp",
    verify: (b) => _at(b, 8, "WEBP"),
  },
  { magic: [0x42, 0x4d], type: "image/bmp", extension: "bmp" },
  { magic: [0x00, 0x00, 0x01, 0x00], type: "image/x-icon", extension: "ico" },
  { magic: _ascii("%PDF-"), type: "application/pdf", extension: "pdf" },
  { magic: [0x1f, 0x8b], type: "application/gzip", extension: "gz" },
  // ISO base media format: the box size occupies bytes 0-3, the brand starts at 4.
  { magic: _ascii("ftyp"), offset: 4, type: "video/mp4", extension: "mp4" },
  { magic: _ascii("OggS"), type: "audio/ogg", extension: "ogg" },
  { magic: [0x49, 0x44, 0x33], type: "audio/mpeg", extension: "mp3" },
  {
    magic: _ascii("RIFF"),
    type: "audio/wav",
    extension: "wav",
    verify: (b) => _at(b, 8, "WAVE"),
  },
  // ZIP container. Also the envelope for docx/xlsx/pptx, which is why the extension it
  // reports is the neutral one — distinguishing them needs the central directory.
  { magic: [0x50, 0x4b, 0x03, 0x04], type: "application/zip", extension: "zip" },
];

/** Type stored when the bytes match nothing known. Browsers never execute it. */
export const FALLBACK_CONTENT_TYPE = "application/octet-stream";

/** Extension stored when the bytes match nothing known. */
export const FALLBACK_EXTENSION = "bin";

/** What {@link sniffContentType} determined about a file. */
export interface SniffedType {
  /** The detected media type, or {@link FALLBACK_CONTENT_TYPE} when unrecognised. */
  contentType: string;
  /** The canonical extension for that type, or {@link FALLBACK_EXTENSION}. */
  extension: string;
  /** Whether the bytes actually matched a signature, as opposed to falling back. */
  recognised: boolean;
}

/**
 * Identify a file from its leading bytes.
 *
 * Recognises the common image, document, archive and media formats. Anything else — a
 * text file, a format not in the table, or a crafted polyglot — reports
 * {@link FALLBACK_CONTENT_TYPE}, which is the safe answer: an unrecognised upload served
 * as `application/octet-stream` downloads, it does not execute.
 *
 * @param bytes - The file's contents (only the first 16 bytes are read).
 * @returns The detected type, extension, and whether detection actually succeeded.
 *
 * @example
 * const { contentType, extension } = sniffContentType(await file.bytes());
 */
export function sniffContentType(bytes: Uint8Array): SniffedType {
  for (const sig of SIGNATURES) {
    const offset = sig.offset ?? 0;
    const matches = sig.magic.every((byte, i) => byte === null || bytes[offset + i] === byte);
    if (!matches) continue;
    if (sig.verify && !sig.verify(bytes)) continue;
    return { contentType: sig.type, extension: sig.extension, recognised: true };
  }
  return {
    contentType: FALLBACK_CONTENT_TYPE,
    extension: FALLBACK_EXTENSION,
    recognised: false,
  };
}
