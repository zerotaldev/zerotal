import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _codeFrame } from "./devFrame.ts";
import { _formatFrame } from "./client/errorOverlay.ts";

const dir = mkdtempSync(join(tmpdir(), "flow-frame-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const page = join(dir, "index.tsx");
writeFileSync(
  page,
  ["export class TasksPage {", "  render() {", '    throw new Error("boom");', "  }", "}"].join(
    "\n",
  ),
);

// From the 1.18.1 walk: Flow's error overlay showed only the stack, `at render (…/index.tsx:25:6)`,
// where the server's own error page shows the code.
describe("the dev overlay's code frame", () => {
  it("reads the lines around the first frame in the app's own code", () => {
    const stack = [
      "Error: boom",
      "    at render (" + join(dir, "node_modules", "@zerotal", "flow", "x.js") + ":1:1)",
      `    at render (${page}:3:11)`,
      "    at async renderPage (/app/node_modules/@zerotal/flow/src/router.ts:10:3)",
    ].join("\n");

    const frame = _codeFrame(stack, 1);

    expect(frame?.file).toBe(page);
    expect(frame?.line).toBe(3);
    expect(frame?.column).toBe(11);
    expect(frame?.lines.map((l) => l.num)).toEqual([2, 3, 4]);
    expect(frame?.lines.find((l) => l.active)?.code).toContain('throw new Error("boom")');
  });

  it("reads a frame with no function name, and skips one it cannot read", () => {
    const stack = ["Error: boom", "    at /nowhere/gone.tsx:1:1", `    at ${page}:3:5`].join("\n");
    expect(_codeFrame(stack)?.line).toBe(3);
  });

  it("has nothing to show for a stack with no readable app frame", () => {
    expect(_codeFrame(undefined)).toBeUndefined();
    expect(_codeFrame("Error: boom\n    at native")).toBeUndefined();
  });

  it("is drawn with the thrown-from line marked, and escaped", () => {
    const html = _formatFrame({
      file: "/app/index.tsx",
      line: 3,
      column: 11,
      lines: [
        { num: 2, code: "  render() {", active: false },
        { num: 3, code: '    throw new Error("<b>");', active: true },
      ],
    });
    expect(html).toContain("/app/index.tsx:3:11");
    expect(html).toContain('<div class="flow-eo-line on"><span class="flow-eo-num">3</span>');
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });
});
