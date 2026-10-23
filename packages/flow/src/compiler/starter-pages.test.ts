import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { transformFlowFile, type BlockerReport } from "./transform.ts";
import { resolveImportedStrings } from "./constants.ts";

/**
 * The Flow starter's pages are the first Flow code a new app runs, and the compiler has to be
 * able to read all of them.
 *
 * A page the compiler cannot read still works, but it renders through the runtime fallback, and
 * under `cspSafe` it does not work at all: an uncompilable page is fatal there. The starter used
 * to fall back on five of its eight pages because it styles them with class lists shared from
 * `ui.ts` (`class={CARD}`), which the compiler could not read. One of the five, `reset-password`,
 * also returned from `render()` twice, which it cannot read either. Neither needs to be true of
 * a page we ship.
 */
const PAGES = fileURLToPath(
  new URL("../../../create-zerotal/templates/flow/app/flow/pages/", import.meta.url),
);
const files = readdirSync(PAGES).filter((f) => f.endsWith(".tsx"));

/** "compiled", or what stopped it: a failure that names the blocker is worth more than a null. */
function verdict(file: string, cspSafe: boolean): string {
  const path = join(PAGES, file);
  const source = readFileSync(path, "utf8");
  const report: BlockerReport = {};
  const result = transformFlowFile(source, path, {
    cspSafe,
    report,
    constants: resolveImportedStrings(source, path),
  });
  return result ? "compiled" : `falls back: ${report.blocker?.reason}`;
}

describe("the Flow starter's pages compile ahead of time", () => {
  it("finds the pages", () => {
    // A path that has rotted would turn the checks below into a loop over nothing.
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files)("%s", (file) => {
    expect(verdict(file, false)).toBe("compiled");
  });

  it.each(files)("%s, under cspSafe", (file) => {
    expect(verdict(file, true)).toBe("compiled");
  });
});
