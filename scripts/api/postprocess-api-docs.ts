/**
 * Post-process the TypeDoc Markdown output so it serves cleanly through the
 * docs app's `/docs/*` route.
 *
 * TypeDoc emits inter-page links with a literal `.md` extension (e.g.
 * `[Foo](../classes/Foo.md)` and `[pkg](@zerotal/core/README.md)`). The docs
 * router serves pages at extension-less URLs and resolves a slug to
 * `<slug>.md` / `<slug>/index.md` / `<slug>/README.md`, so a link ending in
 * `.md` would request `<slug>.md.md` and 404. Stripping the extension makes the
 * links resolve: directory-index links become `.../README`, which the router
 * maps straight back to the `README.md` on disk. Anchors (`#member`) are kept.
 *
 * The URL path mirrors the file path one-to-one, so relative-link depth is
 * unchanged — we only remove the extension, never rewrite the path.
 *
 * Usage: `bun run scripts/api/postprocess-api-docs.ts`
 */
import { Glob } from "bun";
import { join } from "node:path";

const API_DIR = join(import.meta.dir, "../../docs/api");

// Match a Markdown link target ending in `.md`, with an optional `#anchor`, and
// drop the `.md` while preserving the anchor: `](path.md#x)` → `](path#x)`.
const LINK_MD = /(\]\([^)]*?)\.md(#[^)]*)?\)/g;

async function main(): Promise<void> {
  const glob = new Glob("**/*.md");
  let files = 0;
  let rewritten = 0;

  for await (const rel of glob.scan({ cwd: API_DIR })) {
    files++;
    const path = join(API_DIR, rel);
    const source = await Bun.file(path).text();
    const next = source.replace(LINK_MD, "$1$2)");
    if (next !== source) {
      await Bun.write(path, next);
      rewritten++;
    }
  }

  console.log(`[api] post-processed ${files} file(s), rewrote links in ${rewritten}`);
}

await main();
