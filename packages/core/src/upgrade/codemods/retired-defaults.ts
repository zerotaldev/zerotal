/**
 * Config values that are what a default used to be.
 *
 * Nothing here rewrites anything. A value equal to a retired default is a value somebody wrote
 * down, usually by copying it from an older scaffold, and it overrides the safe default that
 * replaced it. Whether it was meant is the author call: the same line is right for a public
 * read-only API and wrong for everything else. So the codemod finds the lines and says why they
 * deserve a look, which is the half of an upgrade that a release note cannot do for an app that
 * has already read it.
 *
 * `zt upgrade` used to answer "No codemods apply to this version range" to an app carrying a
 * value the changelog had called unsafe months earlier, because there was nothing to rewrite.
 */
import type { Codemod, CodemodResult, Manual, SourceFile } from "../types.ts";

interface RetiredDefault {
  /** Which config file the line belongs in. */
  file: RegExp;
  /** The line as written. */
  pattern: RegExp;
  reason: string;
}

const RETIRED: RetiredDefault[] = [
  {
    file: /(^|\/)config\/app\.ts$/,
    // `origin: "*"`, or `origin: env("CORS_ORIGIN", "*")` where "*" is what is used when unset.
    pattern: /\borigin\s*:\s*(?:env\(\s*["\x27`][^"\x27`]*["\x27`]\s*,\s*)?["\x27`]\*["\x27`]/,
    reason:
      'cors.origin "*" is what scaffolds set before 1.5.0. The framework default is same-origin ' +
      "(an empty list), and a wildcard lets any website read this app responses from a visitor " +
      "browser. Keep it for a public read-only API; otherwise list the origins that call this app.",
  },
];

/** Point at config lines that equal a retired default. Rewrites nothing. */
export const retiredDefaults: Codemod = {
  version: "1.15.5",
  name: "retired-defaults",
  description: "Point at config values that are what a default used to be",
  extensions: [".ts"],

  run(files: SourceFile[]): CodemodResult {
    const manual: Manual[] = [];

    for (const { file, contents } of files) {
      const rules = RETIRED.filter((rule) => rule.file.test(file));
      if (rules.length === 0) continue;

      contents.split("\n").forEach((text, index) => {
        // A commented-out line is not a setting.
        if (/^\s*(\/\/|\*|\/\*)/.test(text)) return;
        for (const rule of rules) {
          if (rule.pattern.test(text)) {
            manual.push({ file, line: index + 1, text: text.trim(), reason: rule.reason });
          }
        }
      });
    }

    return { changes: [], manual };
  },
};
