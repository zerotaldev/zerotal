/**
 * Every documentation page is reachable from the README's index.
 *
 * Coverage is not findability. A production app once loaded whole tables and
 * filtered them in JavaScript because the README listed "Query Builder" and never
 * listed the model query page at all — complete, thorough, and unreachable from
 * the page most readers start on. `docs-coverage` cannot see that: it asks
 * whether an export is described somewhere, not whether a reader arrives.
 *
 * So the index is held to the corpus. A new page fails this until it has a row,
 * or a link in its section's row, and a removed page fails `docs:links` from the
 * other side.
 */
import { describe, it, expect } from "bun:test";
import { Glob } from "bun";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** The docs home is the `docs/` link itself, not a row. */
const NOT_INDEXED = new Set(["index"]);

async function pages(): Promise<string[]> {
  const out: string[] = [];
  for await (const file of new Glob("**/*.md").scan({ cwd: join(ROOT, "docs") })) {
    const path = file.replace(/\\/g, "/");
    // TypeDoc output, regenerated on every build and reached from the API reference.
    if (path.startsWith("api/")) continue;
    out.push(path.replace(/\.md$/, ""));
  }
  return out.sort();
}

async function indexed(): Promise<Set<string>> {
  const readme = await Bun.file(join(ROOT, "README.md")).text();
  const section = readme.slice(readme.indexOf("## Documentation"));
  const found = new Set<string>();
  for (const match of section.matchAll(/\]\(docs\/([^)#\s]+?)\.md(?:#[^)]*)?\)/g)) {
    found.add(match[1]!);
  }
  return found;
}

describe("the README's documentation index", () => {
  it("links every hand-written page", async () => {
    const linked = await indexed();
    const missing = (await pages()).filter((page) => !NOT_INDEXED.has(page) && !linked.has(page));
    expect(missing).toEqual([]);
  });

  it("links only pages that exist", async () => {
    const existing = new Set(await pages());
    const dangling = [...(await indexed())].filter((page) => !existing.has(page));
    expect(dangling).toEqual([]);
  });
});
