#!/usr/bin/env bun
/**
 * Generate the flow-ui component reference into `docs/components.md`.
 *
 * `@zerotal/flow-ui` ships 53 components. Writing a section for each by hand is
 * how a reference drifts: the page documented 20 of them, and nothing failed
 * when a component was added without one — which is exactly the gap that keeps a
 * package out of `stable`, since a SemVer promise over an undocumented surface
 * is not a promise anyone can use.
 *
 * The material already existed: `registry.ts` knows every component, and
 * `docs/spec.tsx` carries a usage example, a rendered preview, and a props table
 * for each. This is the missing step that turns them into the page.
 *
 * Only the region between the GENERATED markers is touched, so the hand-written
 * guide around it — setup, theming, copy-in-vs-import, testing — is preserved.
 * Output is formatted with the repository's own Prettier config, so the
 * generated page satisfies `format:check` like every other file rather than
 * needing an exemption.
 *
 *   bun run scripts/generate-docs.ts           # write the reference
 *   bun run scripts/generate-docs.ts --check   # fail if the page is out of date
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as prettier from "prettier";
import { COMPONENTS } from "../packages/flow-ui/src/registry.ts";
import { findSpec } from "../packages/flow-ui/src/docs/spec.tsx";
import { renderComponentSection } from "../packages/flow-ui/src/docs/render.ts";

const TARGET = "docs/components.md";
const BEGIN = "<!-- BEGIN GENERATED COMPONENTS";
const END = "<!-- END GENERATED COMPONENTS -->";

const checkOnly = process.argv.includes("--check");

function fail(message: string): never {
  console.error(`\x1b[31m✖\x1b[0m ${message}`);
  process.exit(1);
}

/** The component reference: an index, then one section per component. */
function buildReference(): string {
  const parts: string[] = [];
  parts.push("");
  parts.push(`### All ${COMPONENTS.length} components`);
  parts.push("");
  for (const c of COMPONENTS) {
    parts.push(`- [${c.title}](#components-${c.name}) — ${c.description}`);
  }
  parts.push("");

  const missing: string[] = [];
  for (const entry of COMPONENTS) {
    const spec = findSpec(entry.name);
    // A component with no spec would silently vanish from the page — the very
    // drift this generator exists to prevent, so it is an error rather than a skip.
    if (!spec) {
      missing.push(entry.name);
      continue;
    }
    parts.push(renderComponentSection(entry, spec));
    parts.push("");
  }
  if (missing.length > 0) {
    fail(
      `no doc spec for: ${missing.join(", ")}\n` +
        `  Add one in packages/flow-ui/src/docs/spec.tsx (or spec-extended.tsx).`,
    );
  }
  return parts.join("\n");
}

const current = readFileSync(TARGET, "utf8");
const beginAt = current.indexOf(BEGIN);
const endAt = current.indexOf(END);
if (beginAt === -1 || endAt === -1) {
  fail(`${TARGET} is missing the GENERATED markers — restore them before regenerating.`);
}
const beginLineEnd = current.indexOf("\n", beginAt);

const next = current.slice(0, beginLineEnd + 1) + buildReference() + current.slice(endAt);

const config = (await prettier.resolveConfig(TARGET)) ?? {};
const formatted = await prettier.format(next, { ...config, parser: "markdown" });

if (checkOnly) {
  if (formatted !== current) {
    fail(
      `${TARGET} is out of date.\n` + `  Run \`bun run docs:components\` and commit the result.`,
    );
  }
  console.log(`\x1b[32m✓\x1b[0m ${TARGET} is up to date (${COMPONENTS.length} components).`);
  process.exit(0);
}

writeFileSync(TARGET, formatted);
console.log(
  `\x1b[32m✓\x1b[0m Wrote ${TARGET} — ${COMPONENTS.length} components, ` +
    `${formatted.split("\n").length} lines.`,
);
