/**
 * A scaffolded app must not be born using a command the framework retired.
 *
 * `serve --dev` was retired in 1.13.0 — the runner, the docs and the `zt upgrade`
 * codemod were all updated, and the scaffold templates were not. So every app
 * created from 1.13.0 onwards shipped with `"dev": "bun zt.ts serve --dev"` in its
 * `package.json`, and `bun run dev` — the first command anyone runs — failed with
 * exit 1 and a message telling them to use something else.
 *
 * The codemod rewrites an *existing* app. Nothing rewrites the thing that writes
 * new ones, which is why this reads the codemod's own patterns rather than
 * keeping a second list that can disagree with the first.
 */
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { Glob } from "bun";
import { deprecatedAliases } from "../../core/src/upgrade/codemods/index.ts";

/** Every file the scaffolder ships or emits, as text. */
function scaffolderFiles(): { file: string; contents: string }[] {
  const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
  const files: { file: string; contents: string }[] = [];

  for (const dir of ["templates", "src"]) {
    for (const rel of new Glob("**/*").scanSync({ cwd: `${root}/${dir}`, onlyFiles: true })) {
      if (/\.(png|jpg|jpeg|ico|woff2?)$/i.test(rel)) continue;
      // A test is not shipped to a scaffolded app, and this file names the retired
      // form in prose describing why it exists.
      if (/\.test\.tsx?$/.test(rel)) continue;
      try {
        files.push({
          file: `${dir}/${rel}`,
          contents: readFileSync(`${root}/${dir}/${rel}`, "utf8"),
        });
      } catch {
        // Unreadable is not a finding here.
      }
    }
  }
  return files;
}

describe("the scaffolder emits no retired command", () => {
  it("has something to check", () => {
    // A test that silently scans nothing is worse than no test.
    expect(scaffolderFiles().length).toBeGreaterThan(20);
  });

  it("uses no form the deprecated-aliases codemod would rewrite", () => {
    // Driven by the codemod's own definition of "retired", so the two cannot
    // disagree: anything it knows how to migrate is something a new app should
    // never be born with.
    const offenders = deprecatedAliases
      .run(scaffolderFiles())
      .changes.map((change) => `${change.file} — ${change.summary}`);

    expect(offenders).toEqual([]);
  });
});
