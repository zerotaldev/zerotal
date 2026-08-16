/**
 * `file:line` → a URL your editor opens.
 *
 * A repo-wide search for any editor URL scheme used to return nothing: no stack
 * frame, query, log line, or prop in any Zerotal surface was clickable to source.
 * Going from "this query is slow" to the line that ran it is the most frequent
 * move in a debugging session, and it was two manual searches — copy the path,
 * find the file, find the line.
 *
 * The schemes are the editors' own and are stable; what is *not* stable is where
 * the file lives relative to the person reading the panel, which is what
 * {@link mapEditorPath} is for.
 */

/** A place in the source. The one shape every capture in the panel produces. */
export interface SourceLocation {
  /** Absolute path as the server saw it. */
  file: string;
  line: number;
  column?: number;
  /** The function the frame was in, when the runtime named one. */
  function?: string;
}

/** Editors that register a URL scheme for opening a file at a line. */
export type EditorName = "vscode" | "vscode-insiders" | "cursor" | "windsurf" | "zed" | "webstorm";

/**
 * How each editor spells "open this file here".
 *
 * Two families: the VS Code line takes a query string, JetBrains takes the same
 * shape under a different host, and Zed puts the position in the path. Written
 * out rather than templated because there are six of them and a template that
 * covers all six is harder to read than the six.
 */
const SCHEMES: Record<EditorName, (file: string, line: number, column: number) => string> = {
  vscode: (f, l, c) => `vscode://file/${f}:${l}:${c}`,
  "vscode-insiders": (f, l, c) => `vscode-insiders://file/${f}:${l}:${c}`,
  cursor: (f, l, c) => `cursor://file/${f}:${l}:${c}`,
  windsurf: (f, l, c) => `windsurf://file/${f}:${l}:${c}`,
  zed: (f, l, c) => `zed://file/${f}:${l}:${c}`,
  webstorm: (f, l) => `webstorm://open?file=${encodeURIComponent(f)}&line=${l}`,
};

/** Every editor this understands, for a config error worth reading. */
export const EDITORS = Object.keys(SCHEMES) as EditorName[];

/**
 * Rewrite a server path to where the reader's editor can find it.
 *
 * The process recording a trace is often not the machine reading it — a
 * container reports `/app/src/Foo.ts` for a file that is `~/project/src/Foo.ts`
 * on the laptop with the editor. Longest prefix wins, so a specific mapping can
 * sit inside a general one.
 *
 * @param file - The path as captured.
 * @param map - Prefix → replacement, from the app's `editorPathMap`.
 */
export function mapEditorPath(file: string, map: Record<string, string>): string {
  let bestPrefix = "";
  let bestReplacement = "";
  for (const [prefix, replacement] of Object.entries(map)) {
    if (file.startsWith(prefix) && prefix.length > bestPrefix.length) {
      bestPrefix = prefix;
      bestReplacement = replacement;
    }
  }
  return bestPrefix ? bestReplacement + file.slice(bestPrefix.length) : file;
}

/**
 * The URL that opens `location` in `editor`, or null when there is nothing to
 * link to.
 *
 * Null rather than a broken link for the two cases that mean "do not link":
 * `editor: null` in the config, and a location with no file. The panel renders
 * the location as plain text then, which is still worth showing.
 *
 * @param location - Where to go.
 * @param editor - The configured editor, or null to disable linking.
 * @param map - Path rewrites for editing on a different machine.
 */
export function editorUrl(
  location: SourceLocation | null | undefined,
  editor: EditorName | null,
  map: Record<string, string> = {},
): string | null {
  if (!editor || !location?.file) return null;
  const scheme = SCHEMES[editor];
  if (!scheme) return null;
  // Backslashes are legal in a Windows path and illegal in a URL path segment;
  // every one of these editors accepts the forward-slash form on Windows.
  const file = mapEditorPath(location.file, map).replace(/\\/g, "/");
  return scheme(file, Math.max(1, location.line || 1), Math.max(1, location.column ?? 1));
}

/**
 * A location as the panel labels it: the last two path segments and the line.
 *
 * Not the whole path — an absolute path from a monorepo is sixty characters of
 * which the last twenty are the part you read.
 */
export function shortLocation(location: SourceLocation): string {
  const parts = location.file.replace(/\\/g, "/").split("/");
  const tail = parts.slice(-2).join("/");
  return `${tail}:${location.line}`;
}
