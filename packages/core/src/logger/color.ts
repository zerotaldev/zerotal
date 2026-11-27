/**
 * Whether terminal output carries colour codes.
 *
 * Piped into a file, a pager or a log collector, the escape codes arrive as text:
 * `[2m05:20:51.132[0m [32mINFO [0m`. So colour is on only when the stream is a terminal,
 * `NO_COLOR` (any value) turns it off, and `FORCE_COLOR` turns it on for a pipe whose reader
 * draws colour itself, which is how `zt dev` keeps the colours of the processes it runs.
 *
 * @module
 */

/** The part of a stream this module reads. */
interface MaybeTty {
  isTTY?: boolean | undefined;
}

/**
 * Whether output to `stream` should carry colour codes.
 *
 * @param stream - Where the output goes. Defaults to `process.stdout`.
 * @param env - The environment to read `NO_COLOR` and `FORCE_COLOR` from.
 * @internal
 */
export function _colorEnabled(
  stream: MaybeTty = process.stdout,
  env: Record<string, string | undefined> = Bun.env,
): boolean {
  const noColor = env["NO_COLOR"];
  if (noColor !== undefined && noColor !== "") return false;
  const force = env["FORCE_COLOR"];
  if (force !== undefined && force !== "") return force !== "0" && force !== "false";
  return stream.isTTY === true;
}

/** Every SGR escape (`ESC [ … m`), which is all the colour this codebase writes. */
const _SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * `text` without its colour codes.
 *
 * @internal
 */
export function _stripColor(text: string): string {
  return text.replace(_SGR, "");
}

/**
 * `text` as it should be written to `stream`: unchanged when colour is on, stripped otherwise.
 *
 * @internal
 */
export function _forStream(text: string, stream: MaybeTty = process.stdout): string {
  return _colorEnabled(stream) ? text : _stripColor(text);
}

/**
 * The environment for a child whose output this process reads through a pipe and shows.
 *
 * The child sees a pipe, not a terminal, and would drop its colours. When this process would
 * colour its own output, the child is told to keep them with `FORCE_COLOR`; when it would not
 * (`NO_COLOR`, or itself piped), the child inherits that.
 *
 * @internal
 */
export function _colorEnv(
  from: Record<string, string | undefined> = Bun.env,
  stream: MaybeTty = process.stdout,
): Record<string, string | undefined> {
  if (!_colorEnabled(stream, from) || from["FORCE_COLOR"]) return { ...from };
  return { ...from, FORCE_COLOR: "1" };
}
