/**
 * Managed blocks: how a generated file stays generated without eating what
 * someone wrote around it.
 *
 * `arch:update` runs on every framework upgrade, and the file it rewrites is one
 * a developer is invited to edit — that is the point of `AGENTS.md`. So the
 * generated region is fenced, and only the region is ever replaced. Text above
 * it, below it, and any second block someone added by hand all survive.
 *
 * A file whose markers are damaged is left completely alone and reported as a
 * conflict. Guessing where the block was meant to end is how a tool deletes a
 * paragraph nobody backed up.
 */

export const BLOCK_START = "<!-- zerotal:arch:start -->";
export const BLOCK_END = "<!-- zerotal:arch:end -->";

export type BlockOutcome =
  /** The file did not exist, or had no block: one was added. */
  | { status: "created"; text: string }
  /** The block was there and its contents changed. */
  | { status: "updated"; text: string }
  /** The block was there and already said this. */
  | { status: "unchanged"; text: string }
  /** The markers are damaged; nothing was written. */
  | { status: "conflict"; reason: string };

/**
 * Wrap generated content in its markers.
 *
 * The blank lines either side are not cosmetic. In Markdown, text on the line
 * immediately after an HTML comment is parsed as part of that raw-HTML block, so
 * `@AGENTS.md` pressed against the opening marker stops being a paragraph — and
 * every formatter, including the `prettier --check` a Zerotal project already
 * runs, inserts them. A generator whose output fails the project's own format
 * gate is a generator nobody can run twice.
 */
export function fence(content: string): string {
  return `${BLOCK_START}\n\n${content.trim()}\n\n${BLOCK_END}`;
}

/**
 * Put `content` into `existing`'s managed block.
 *
 * @param existing - The file's current text, or `undefined` when there is none.
 * @param content - The generated body, unfenced.
 * @param preamble - Written above the block, once, only when creating the file.
 *   Never rewritten afterwards — it is the developer's from that moment on.
 */
export function applyBlock(
  existing: string | undefined,
  content: string,
  preamble = "",
): BlockOutcome {
  const block = fence(content);

  if (existing === undefined || existing.trim().length === 0) {
    const head = preamble.trim().length > 0 ? `${preamble.trim()}\n\n` : "";
    return { status: "created", text: `${head}${block}\n` };
  }

  const start = existing.indexOf(BLOCK_START);
  const end = existing.indexOf(BLOCK_END);

  if (start === -1 && end === -1) {
    // A file that predates this tool. Append rather than prepend: whatever is
    // already at the top is what its author chose to say first.
    return { status: "created", text: `${existing.trimEnd()}\n\n${block}\n` };
  }

  if (start === -1 || end === -1 || end < start) {
    return {
      status: "conflict",
      reason:
        start === -1
          ? `found ${BLOCK_END} with no opening marker`
          : end === -1
            ? `found ${BLOCK_START} with no closing marker`
            : "the closing marker comes before the opening one",
    };
  }

  const text = existing.slice(0, start) + block + existing.slice(end + BLOCK_END.length);

  return text === existing ? { status: "unchanged", text } : { status: "updated", text };
}
