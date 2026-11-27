import { describe, it, expect } from "bun:test";
import { _errorText, _formatStack, showErrorOverlay, hideErrorOverlay } from "./errorOverlay.ts";
import { _devErrorInfo } from "../provider/FlowProvider.ts";

describe("dev error overlay", () => {
  describe("_devErrorInfo (server: extract overlay detail from a thrown value)", () => {
    it("pulls name/message/stack from an Error and carries the action", () => {
      const err = new TypeError("boom");
      const info = _devErrorInfo(err, "save");
      expect(info.name).toBe("TypeError");
      expect(info.message).toBe("boom");
      expect(info.action).toBe("save");
      expect(info.stack).toContain("boom");
    });

    it("wraps a non-Error throw", () => {
      const info = _devErrorInfo("just a string", "doThing");
      expect(info.name).toBe("Error");
      expect(info.message).toBe("just a string");
      expect(info.action).toBe("doThing");
    });
  });

  describe("_formatStack (client: render frames, dim framework/node_modules)", () => {
    it("drops the first line (shown as the heading) and dims non-app frames", () => {
      const stack = [
        "Error: boom",
        "    at MyPage.save (/app/pages/MyPage.tsx:12:9)",
        "    at dispatch (/app/node_modules/@zerotal/flow/src/Component.ts:5:1)",
        "    at process (node:internal/process/task_queues:95:5)",
      ].join("\n");
      const html = _formatStack(stack);

      expect(html).not.toContain("Error: boom"); // first line dropped
      // App frame is bright (no dim class); framework/node frames are dimmed.
      expect(html).toContain('class="flow-eo-frame">'); // MyPage.save — app frame, not dim
      expect(html).toMatch(/flow-eo-frame dim">[^<]*@zerotal\/flow/);
      expect(html).toMatch(/flow-eo-frame dim">[^<]*node:internal/);
    });

    it("escapes HTML in stack lines", () => {
      const html = _formatStack("Error\n    at <script>evil</script> (/x.ts:1:1)");
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("<script>evil");
    });
  });

  describe("show/hide are safe with no DOM (server / SSR)", () => {
    it("no-ops instead of throwing when document is undefined", () => {
      // bun test has no `document` global — these should return early, not crash.
      expect(() => showErrorOverlay({ message: "x" })).not.toThrow();
      expect(() => hideErrorOverlay()).not.toThrow();
    });
  });
});

describe("_errorText (the overlay's readable copy)", () => {
  it("names the error, where it happened, the code around it and the stack", () => {
    const text = _errorText({
      name: "TypeError",
      message: "boom",
      action: "save",
      component: "TasksPage",
      frame: {
        file: "app/flow/pages/tasks.tsx",
        line: 12,
        column: 9,
        lines: [
          { num: 11, code: "const a = 1;", active: false },
          { num: 12, code: "a.b.c();", active: true },
        ],
      },
      stack: "TypeError: boom\n    at save (app/flow/pages/tasks.tsx:12:9)",
    });
    expect(text).toBe(
      [
        "TypeError: boom",
        "During action save in TasksPage",
        "",
        "app/flow/pages/tasks.tsx:12:9",
        "  11 | const a = 1;",
        "> 12 | a.b.c();",
        "",
        "at save (app/flow/pages/tasks.tsx:12:9)",
      ].join("\n"),
    );
  });
});
