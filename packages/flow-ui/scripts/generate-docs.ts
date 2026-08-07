// Generate the flow-ui component documentation into the repo's `docs/components.md`,
// a single combined page the docs site serves via its `/docs/*` markdown route.
//
//   bun run docs:gen        (from packages/flow-ui)
//
// Output is committed markdown — deterministic and reviewable.

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { renderAllDocs } from "../src/docs/render.ts";

// scripts/ → package root → repo root (../../..) → docs/
const PKG_ROOT = join(fileURLToPath(import.meta.url), "../..");
const DOCS_DIR = join(PKG_ROOT, "../../docs");

// Remove the legacy per-component folder (docs now live in a single file).
await rm(join(DOCS_DIR, "components"), { recursive: true, force: true });

const docs = renderAllDocs();
let written = 0;
for (const [slug, markdown] of Object.entries(docs)) {
  const dest = join(DOCS_DIR, `${slug}.md`);
  await Bun.write(dest, markdown.endsWith("\n") ? markdown : markdown + "\n");
  console.log(`+ docs/${slug}.md`);
  written++;
}
console.log(`\nGenerated ${written} component doc page(s) → docs/components.md`);
