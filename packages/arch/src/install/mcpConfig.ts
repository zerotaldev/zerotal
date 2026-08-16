/**
 * Registering this server in an MCP client's config.
 *
 * The file belongs to the project, not to us: it may already list three other
 * servers, and it may have been hand-edited. So the write is a merge of one key
 * into whatever is there, and every other key comes through byte-for-byte
 * intact — including ones no schema this package knows about.
 *
 * A file that is not valid JSON is reported, not overwritten. There is no
 * version of "I could not read your config so I replaced it" that is the right
 * thing to do.
 */
import type { McpTarget } from "./detect.ts";

/** Where the server lives, relative to the project root. */
export const SERVER_ENTRY_PATH = "node_modules/@zerotal/arch/src/bin/mcp.ts";

export type ConfigOutcome =
  | { status: "created" | "updated" | "unchanged"; text: string }
  | { status: "conflict"; reason: string };

/** The server entry an MCP client is given. */
export function serverEntry(): Record<string, unknown> {
  return {
    // `bun`, not `bunx`: the app runs on Bun and so must its agent surface,
    // and a bare command resolves through PATH to whatever is first.
    command: "bun",
    args: [SERVER_ENTRY_PATH],
  };
}

/**
 * Merge this server into an MCP config document.
 *
 * @param existing - The file's current text, or `undefined` when there is none.
 * @param name - The key to register under.
 * @param target - Which client's file this is; decides the container key.
 */
export function applyMcpConfig(
  existing: string | undefined,
  name: string,
  target: McpTarget,
): ConfigOutcome {
  let document: Record<string, unknown> = {};
  const isNew = existing === undefined || existing.trim().length === 0;

  if (!isNew) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch (error) {
      return {
        status: "conflict",
        reason: `${target.path} is not valid JSON (${describe(error)}) — left untouched.`,
      };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        status: "conflict",
        reason: `${target.path} is not a JSON object — left untouched.`,
      };
    }
    document = parsed as Record<string, unknown>;
  }

  const container = document[target.key];
  const servers: Record<string, unknown> =
    typeof container === "object" && container !== null && !Array.isArray(container)
      ? { ...(container as Record<string, unknown>) }
      : {};

  servers[name] = serverEntry();
  const next = { ...document, [target.key]: servers };
  const text = JSON.stringify(next, null, 2) + "\n";

  if (isNew) return { status: "created", text };

  // Compared as data, not as text. `JSON.stringify(…, 2)` expands a one-element
  // array across three lines where a formatter collapses it, and a project's
  // formatter settings are its own business — so a textual comparison made
  // `arch:update` rewrite a file it had no change to make to, and the next
  // `prettier --write` put it back. That ping-pong shows up as a dirty working
  // tree after running two commands that both claim to be no-ops.
  //
  // Semantic equality ends it: when the config already says what it should, the
  // file is returned exactly as it was found, in whatever shape its owner keeps it.
  if (Bun.deepEquals(document, next)) return { status: "unchanged", text: existing };
  return { status: "updated", text };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
