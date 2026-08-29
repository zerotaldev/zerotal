/**
 * Markdown rendering helpers: title extraction, a minimal HTML page shell, and
 * the default `Bun.markdown` parser options the framework renders with.
 */

/** Pull the first H1/H2 from markdown text to use as the page title. */
export function markdownExtractTitle(content: string): string | undefined {
  return content.match(/^#{1,2}\s+(.+)$/m)?.[1]?.trim();
}

/**
 * Minimal HTML shell for rendered markdown pages.
 *
 * @internal
 */
export function markdownPage(title: string, body: string): string {
  return `<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  *,*::before,*::after{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,sans-serif;
    line-height:1.7;color:#1a1a1a;max-width:860px;margin:0 auto;padding:2rem 1.5rem}
  h1,h2,h3,h4{margin-top:2rem;margin-bottom:.5rem;line-height:1.3}
  h1{font-size:2rem;border-bottom:2px solid #e5e7eb;padding-bottom:.5rem}
  h2{font-size:1.5rem;border-bottom:1px solid #e5e7eb;padding-bottom:.3rem}
  a{color:#2563eb}a:hover{color:#1d4ed8}
  code{background:#f3f4f6;border-radius:4px;padding:.15em .35em;font-size:.9em}
  pre{background:#f3f4f6;border-radius:6px;padding:1rem;overflow-x:auto;line-height:1.5}
  pre code{background:none;padding:0;font-size:inherit}
  blockquote{border-left:4px solid #d1d5db;margin:0;padding:.5rem 1rem;color:#6b7280}
  table{border-collapse:collapse;width:100%;margin:1rem 0}
  th,td{border:1px solid #d1d5db;padding:.5rem .75rem;text-align:left}
  th{background:#f9fafb;font-weight:600}
  img{max-width:100%;height:auto}
  input[type=checkbox]{margin-right:.4em}
  hr{border:none;border-top:1px solid #e5e7eb;margin:2rem 0}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * Options for `Bun.markdown.html()`. bun-types exposes the options type only inside
 * its `markdown` namespace; this is the named, exported equivalent the framework uses.
 *
 * @internal
 */
export interface BunMarkdownOptions {
  tables?: boolean;
  strikethrough?: boolean;
  tasklists?: boolean;
  autolinks?: boolean | { url?: boolean; www?: boolean; email?: boolean };
  headings?: boolean | { ids?: boolean };
  hardSoftBreaks?: boolean;
  wikiLinks?: boolean;
  underline?: boolean;
  latexMath?: boolean;
  collapseWhitespace?: boolean;
  permissiveAtxHeaders?: boolean;
  noIndentedCodeBlocks?: boolean;
  noHtmlBlocks?: boolean;
  noHtmlSpans?: boolean;
  tagFilter?: boolean;
}

/** Default markdown parser options — GFM extensions enabled. */
export const DEFAULT_MD_OPTIONS: BunMarkdownOptions = {
  tables: true,
  strikethrough: true,
  tasklists: true,
  autolinks: true,
  headings: { ids: true },
};
