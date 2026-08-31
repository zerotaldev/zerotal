/**
 * Ledger #5 — `Component.client(…)` gives way to the `$` tagged template.
 *
 * This one is a security fix wearing an ergonomics change's clothes, and that is
 * why it shipped in a minor rather than waiting for 2.0. `client()` takes a
 * **string** and queues it to be evaluated in the browser, so the caller owns the
 * escaping — and its own docblock had to say *never interpolate unescaped user
 * input*, which is a warning about a footgun rather than a design. `$` is a tagged
 * template, so every `${…}` is encoded as a JS literal before it reaches the page
 * and the caller cannot get it wrong by forgetting.
 *
 * ## What this rewrites, and what it hands back
 *
 * A call whose argument is **one template literal or one plain string** is
 * mechanical: the quotes become backticks and `client(` becomes `` $` ``. Nothing
 * about the expression changes.
 *
 * A call whose argument is **anything else** is a handover. `client(expr)` where
 * `expr` is a variable, a concatenation, or a function call is exactly the shape
 * the security note was about — the string was built somewhere else, possibly out
 * of user input, and turning it into `` $`${expr}` `` would change its meaning:
 * the tag would encode the whole expression as a *string literal* rather than
 * splicing it as code. That is a silent behaviour change, so a person decides.
 *
 * Getting this backwards is the failure worth avoiding. A codemod that
 * mechanically wrapped every argument would leave an app that compiles, runs, and
 * quietly does nothing where it used to run a script.
 */
import type { Change, Codemod, CodemodResult, Manual, SourceFile } from "../types.ts";

/**
 * `this.client(` followed by a single template literal with no substitution of its
 * own, to the closing `)`.
 *
 * Backtick-delimited, containing no backtick and no `${`, so the match cannot run
 * past the end of the literal.
 *
 * A **bare `$` is allowed, and has to be.** `$refs`, `$el` and the `$flow` magics
 * are the whole reason anyone calls this — the method's own docblock example is
 * `` this.client(`$refs.titleInput.focus()`) ``. An earlier draft excluded `$`
 * outright to keep `${` out, which skipped every realistic call site while passing
 * a test suite written around `alert(1)`.
 */
const PLAIN_TEMPLATE = /\bthis\.client\(\s*`((?:[^`\\$]|\$(?!\{))*)`\s*\)/g;

/**
 * `this.client('…')` / `this.client("…")` with no escape, no backtick and no `${`.
 *
 * `${` matters more here than in the template case: promoting a quoted string to a
 * template literal turns a literal `${…}` into an interpolation, which is a change
 * in meaning rather than in syntax.
 */
const PLAIN_STRING = /\bthis\.client\(\s*(['"])((?:(?!\1)(?:[^\\`$]|\$(?!\{)))*)\1\s*\)/g;

/** Any remaining `this.client(`, for the handover pass. */
const ANY_CALL = /\bthis\.client\(/;

export const clientTaggedTemplate: Codemod = {
  version: "1.13.0",
  name: "client-tagged-template",
  description: "Rewrite this.client(…) to the $ tagged template, which encodes interpolations",
  ledger: 5,

  run(files: SourceFile[]): CodemodResult {
    const changes: Change[] = [];
    const manual: Manual[] = [];

    for (const { file, contents } of files) {
      let next = contents;
      const notes: string[] = [];

      const templateHits = next.match(PLAIN_TEMPLATE)?.length ?? 0;
      if (templateHits > 0) {
        next = next.replace(PLAIN_TEMPLATE, (_m, body: string) => `this.$\`${body}\``);
        notes.push(`${templateHits} × \`client(\\\`…\\\`)\` → \`$\\\`…\\\`\``);
      }

      const stringHits = next.match(PLAIN_STRING)?.length ?? 0;
      if (stringHits > 0) {
        // The body carried no backtick or `${`, so promoting the quotes cannot
        // change what the expression means.
        next = next.replace(PLAIN_STRING, (_m, _q: string, body: string) => `this.$\`${body}\``);
        notes.push(`${stringHits} × \`client("…")\` → \`$\\\`…\\\`\``);
      }

      // Whatever is left took an argument this cannot read.
      next.split("\n").forEach((line, i) => {
        if (!ANY_CALL.test(line)) return;
        manual.push({
          file,
          line: i + 1,
          text: line.trim(),
          reason:
            "`client()` with an argument that is not a single literal — a variable, a " +
            "concatenation, a call. This is the shape the security note was about, so it is " +
            "worth reading rather than rewriting: if the string is built from user input, the " +
            "fix is to interpolate through `$` so the value is encoded, not to wrap the " +
            "finished string. Wrapping it as `` $`${expr}` `` would encode the whole thing as a " +
            "string literal and stop running it as code.",
        });
      });

      if (next !== contents) changes.push({ file, summary: notes.join(", "), contents: next });
    }

    return { changes, manual };
  },
};
