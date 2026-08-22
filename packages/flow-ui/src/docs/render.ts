// ── Docs markdown generation ────────────────────────────────────────────────
//
// Pure string builders turning the component registry + doc specs into the
// markdown the docs site serves from `docs/components/`. No filesystem here — the
// generator script (scripts/generate-docs.ts) writes the output, and docs.test.ts
// asserts on these strings directly.

import { COMPONENTS } from "../registry.ts";
import type { ComponentEntry } from "../registry.ts";
import { findSpec } from "./spec.tsx";
import type { DocSpec, PropDoc } from "./spec.tsx";

const PREVIEW_WRAP =
  "not-prose my-6 flex min-h-32 items-center justify-center gap-4 rounded-lg border border-border bg-background p-10";

/** HTML-escape text destined for a raw HTML cell. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Render the props table as raw HTML rather than a markdown table. TS union types
 * contain `|`, which a markdown table cell can't hold without `\|` escaping — and
 * inside a code span that escape renders literally. Raw HTML sidesteps the table
 * parser entirely (still styled by the docs' `.prose table` rules).
 */
function propsTable(props: PropDoc[]): string {
  if (props.length === 0) return "";
  const rows = props
    .map(
      (p) =>
        `  <tr><td><code>${esc(p.name)}</code></td>` +
        `<td><code>${esc(p.type)}</code></td>` +
        `<td>${p.default ? `<code>${esc(p.default)}</code>` : "—"}</td>` +
        `<td>${esc(p.description)}</td></tr>`,
    )
    .join("\n");
  return (
    `<table>\n` +
    `  <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>\n` +
    `  <tbody>\n${rows}\n  </tbody>\n` +
    `</table>`
  );
}

/**
 * Render one component as a section of the combined page: an `## <Title>` heading
 * (with a stable `components-<name>` anchor) and `###` sub-headings. Sub-headings are
 * h3 so they nest under each component in the right-hand "On this page" ToC.
 */
export function renderComponentSection(entry: ComponentEntry, spec: DocSpec): string {
  const parts: string[] = [];
  parts.push(`<a id="components-${entry.name}"></a>`);
  parts.push("");
  parts.push(`## ${entry.title}`);
  parts.push("");
  parts.push(entry.description + ".");
  parts.push("");

  parts.push(`### ${entry.title} installation`);
  parts.push("");
  parts.push("```sh");
  parts.push(`bun zt flow:add ${entry.name}`);
  parts.push("```");
  parts.push("");
  parts.push(
    "Or import directly from the package: `import { " +
      entry.title +
      ' } from "@zerotal/flow-ui";`',
  );
  parts.push("");

  parts.push(`### ${entry.title} preview`);
  parts.push("");
  parts.push(`<div class="${PREVIEW_WRAP}">`);
  parts.push(spec.preview.html);
  parts.push("</div>");
  parts.push("");

  parts.push(`### ${entry.title} usage`);
  parts.push("");
  // `fragment`, because these snippets are sibling elements with no import above
  // them — a shape chosen to show the component, not to compile. The token keeps
  // `docs:examples:check` from reading a display choice as a broken example, and
  // readers never see it: a fence carries only its first word into the page.
  parts.push("```tsx fragment");
  parts.push(spec.code);
  parts.push("```");
  parts.push("");

  const table = propsTable(spec.props);
  if (table) {
    parts.push(`### ${entry.title} props`);
    parts.push("");
    parts.push(table);
    parts.push("");
  }

  return parts.join("\n");
}

/** Render the single, combined components page (overview + every component section). */
export function renderCombinedDoc(): string {
  const parts: string[] = [];
  parts.push("# Components");
  parts.push("");
  parts.push(
    `Themeable components for Flow — ${COMPONENTS.length} in total. ` +
      "Built on accessible headless primitives and design tokens, so they follow your theme " +
      "(light / dark) out of the box.",
  );
  parts.push("");
  parts.push("Add any of them to your app with the CLI:");
  parts.push("");
  parts.push("```sh");
  parts.push("bun zt flow:init                   # one-time setup");
  parts.push("bun zt flow:add button,card,dialog # copy components in");
  parts.push("```");
  parts.push("");
  parts.push("## All components");
  parts.push("");
  for (const c of COMPONENTS) {
    parts.push(`- [${c.title}](#components-${c.name}) — ${c.description}`);
  }
  parts.push("");

  for (const entry of COMPONENTS) {
    const spec = findSpec(entry.name);
    if (!spec) continue;
    parts.push(renderComponentSection(entry, spec));
  }

  return parts.join("\n").replace(/\n+$/, "\n");
}

/** Build every doc page: returns `{ slug → markdown }` (slug relative to docs/). */
export function renderAllDocs(): Record<string, string> {
  return { components: renderCombinedDoc() };
}
