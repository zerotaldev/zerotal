// Read a `multipart/form-data` upload off the request body as it arrives, writing the file part to
// a temporary file on disk, so a 25 MB upload never sits in memory whole.
//
// `request.formData()` buffers the entire body before it returns, and the old handler then copied
// the file into a second buffer to store it: two copies of every upload in memory at once, per
// concurrent upload. This reads the stream chunk by chunk, keeps at most one chunk plus a
// boundary's worth of bytes, and stops reading the moment the file passes the size limit.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";

/** A file part written to disk. */
export interface ReceivedFile {
  /** The temporary file holding the bytes. The caller moves it and removes it. */
  path: string;
  /** The filename the browser sent. */
  name: string;
  /** The part's `Content-Type`, or `application/octet-stream`. */
  type: string;
  /** Bytes written. */
  size: number;
}

/** What {@link _receiveUpload} read: the file, or why there is none. */
export type ReceivedUpload =
  { ok: true; file: ReceivedFile } | { ok: false; status: 400 | 422; error: string };

/** A part's headers larger than this are not a browser's: refused as malformed. */
const MAX_HEADER_BYTES = 16 * 1024;

const CRLF = Buffer.from("\r\n");
const HEADER_END = Buffer.from("\r\n\r\n");

/** The boundary from a `multipart/form-data` content type, or `null`. */
function _boundary(contentType: string | null): string | null {
  if (!contentType || !/^multipart\/form-data\b/i.test(contentType)) return null;
  const match = /;\s*boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  return boundary && boundary.length <= 200 ? boundary : null;
}

/** `name` and `filename` from a part's `Content-Disposition`, and its `Content-Type`. */
function _partHeaders(raw: string): { name?: string; filename?: string; type?: string } {
  const out: { name?: string; filename?: string; type?: string } = {};
  for (const line of raw.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "content-type") out.type = value;
    if (key !== "content-disposition") continue;
    for (const [, attr, quoted, bare] of value.matchAll(
      /;\s*([a-z*]+)=(?:"((?:\\.|[^"\\])*)"|([^;]*))/gi,
    )) {
      const v = (quoted ?? bare ?? "").replace(/\\(.)/g, "$1");
      if (attr!.toLowerCase() === "name") out.name = v;
      if (attr!.toLowerCase() === "filename") out.filename = v;
    }
  }
  return out;
}

/**
 * Read the `field` file part of a multipart request into a temporary file.
 *
 * @param request - The upload request. Its body is read once, here.
 * @param maxBytes - The most the file may hold. Reading stops as soon as it is passed.
 * @param field - The form field carrying the file.
 * @param dir - Where the temporary file goes; the OS temporary directory by default.
 * @returns The file on disk, or the status and message to answer with.
 * @internal
 */
export async function _receiveUpload(
  request: Request,
  maxBytes: number,
  field = "file",
  dir: string = tmpdir(),
): Promise<ReceivedUpload> {
  const invalid: ReceivedUpload = { ok: false, status: 400, error: "Invalid upload." };
  const boundary = _boundary(request.headers.get("content-type"));
  if (!boundary || !request.body) return invalid;

  // Every delimiter is CRLF + "--" + boundary. The body opens with one that has no CRLF before
  // it, so the scan starts as if it had read a CRLF already.
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  const reader = request.body.getReader();

  type State = "preamble" | "afterDelimiter" | "headers" | "body" | "done";
  let state: State = "preamble";
  let buf: Buffer = Buffer.from(CRLF);
  let target: { path: string; sink: ReturnType<ReturnType<typeof Bun.file>["writer"]> } | null =
    null;
  let file: ReceivedFile | null = null;
  let writing = false; // the current part is the file being kept

  const discard = async (): Promise<void> => {
    if (!target) return;
    try {
      await target.sink.end();
    } catch {
      /* already closed */
    }
    await rm(target.path, { force: true });
    target = null;
  };
  const fail = async (result: ReceivedUpload): Promise<ReceivedUpload> => {
    await reader.cancel().catch(() => {});
    await discard();
    return result;
  };

  /** Write `bytes` of the kept part, enforcing the limit. `false` when the limit is passed. */
  const write = (bytes: Buffer): boolean => {
    if (!writing || !target || !file || bytes.length === 0) return true;
    file.size += bytes.length;
    if (file.size > maxBytes) return false;
    target.sink.write(bytes);
    return true;
  };

  try {
    for (;;) {
      // Work through what is buffered before reading more.
      let progressed = true;
      while (progressed && state !== "done") {
        progressed = false;
        if (state === "preamble" || state === "body") {
          const at = buf.indexOf(delimiter);
          if (at >= 0) {
            if (state === "body" && !write(buf.subarray(0, at))) {
              return await fail({ ok: false, status: 422, error: "File exceeds the size limit." });
            }
            if (writing) {
              writing = false;
              await target!.sink.end();
            }
            buf = buf.subarray(at + delimiter.length);
            state = "afterDelimiter";
            progressed = true;
          } else if (buf.length > delimiter.length) {
            // Keep a delimiter's length back: it may be split across two chunks.
            const safe = buf.length - delimiter.length;
            if (state === "body" && !write(buf.subarray(0, safe))) {
              return await fail({ ok: false, status: 422, error: "File exceeds the size limit." });
            }
            buf = buf.subarray(safe);
          }
        } else if (state === "afterDelimiter") {
          if (buf.length < 2) break;
          if (buf[0] === 0x2d && buf[1] === 0x2d) {
            state = "done"; // "--": the closing delimiter
          } else if (buf[0] === 0x0d && buf[1] === 0x0a) {
            buf = buf.subarray(2);
            state = "headers";
            progressed = true;
          } else {
            return await fail(invalid);
          }
        } else if (state === "headers") {
          const end = buf.indexOf(HEADER_END);
          if (end < 0) {
            if (buf.length > MAX_HEADER_BYTES) return await fail(invalid);
            break;
          }
          const headers = _partHeaders(buf.subarray(0, end).toString("utf8"));
          buf = buf.subarray(end + HEADER_END.length);
          state = "body";
          progressed = true;
          // The first part named `field` that carries a filename is the upload.
          if (!file && headers.name === field && headers.filename !== undefined) {
            const path = join(dir, `zt-flow-upload-${crypto.randomUUID()}`);
            target = { path, sink: Bun.file(path).writer() };
            file = {
              path,
              name: headers.filename,
              type: headers.type || "application/octet-stream",
              size: 0,
            };
            writing = true;
          }
        }
      }
      if (state === "done") break;

      const { value, done } = await reader.read();
      if (done) return await fail(invalid); // the body ended before its closing delimiter
      buf = buf.length === 0 ? Buffer.from(value) : Buffer.concat([buf, value]);
    }
  } catch {
    return await fail(invalid);
  }

  await reader.cancel().catch(() => {});
  if (!file || file.name === "" || file.size === 0) {
    await discard();
    return { ok: false, status: 422, error: "No file provided." };
  }
  return { ok: true, file };
}
