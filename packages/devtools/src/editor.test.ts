import { describe, it, expect } from "bun:test";
import { editorUrl, mapEditorPath, shortLocation, EDITORS } from "./editor.ts";
import type { SourceLocation } from "./editor.ts";

const at = (file: string, line = 42, column?: number): SourceLocation => ({
  file,
  line,
  ...(column === undefined ? {} : { column }),
});

describe("editorUrl", () => {
  it("builds a link for each editor it knows", () => {
    // Every scheme has to produce *something* — an editor in the list with a
    // broken entry is a config option that silently does nothing.
    for (const editor of EDITORS) {
      expect(editorUrl(at("/src/Foo.ts"), editor)).toBeTruthy();
    }
  });

  it("puts the line and column in the VS Code family's path form", () => {
    expect(editorUrl(at("/src/Foo.ts", 42, 7), "vscode")).toBe("vscode://file//src/Foo.ts:42:7");
    expect(editorUrl(at("/src/Foo.ts", 42, 7), "cursor")).toBe("cursor://file//src/Foo.ts:42:7");
  });

  it("uses the query-string form for JetBrains", () => {
    expect(editorUrl(at("/src/Foo.ts", 42), "webstorm")).toBe(
      "webstorm://open?file=%2Fsrc%2FFoo.ts&line=42",
    );
  });

  it("converts Windows separators, which are not legal in a URL path", () => {
    expect(editorUrl(at("C:\\Projects\\app\\Foo.ts", 3), "vscode")).toBe(
      "vscode://file/C:/Projects/app/Foo.ts:3:1",
    );
  });

  it("defaults a missing column to 1 rather than emitting NaN", () => {
    expect(editorUrl(at("/src/Foo.ts", 9), "zed")).toBe("zed://file//src/Foo.ts:9:1");
  });

  it("never emits line 0 — no editor has one", () => {
    expect(editorUrl({ file: "/src/Foo.ts", line: 0 }, "vscode")).toContain(":1:1");
  });

  it("returns null when linking is switched off", () => {
    expect(editorUrl(at("/src/Foo.ts"), null)).toBeNull();
  });

  it("returns null when there is no location to link to", () => {
    expect(editorUrl(null, "vscode")).toBeNull();
    expect(editorUrl(undefined, "vscode")).toBeNull();
    expect(editorUrl({ file: "", line: 1 }, "vscode")).toBeNull();
  });

  it("applies the path map on the way out", () => {
    expect(editorUrl(at("/app/src/Foo.ts", 5), "vscode", { "/app": "/home/me/project" })).toBe(
      "vscode://file//home/me/project/src/Foo.ts:5:1",
    );
  });
});

describe("mapEditorPath", () => {
  it("rewrites a matching prefix", () => {
    expect(mapEditorPath("/app/src/Foo.ts", { "/app": "/home/me" })).toBe("/home/me/src/Foo.ts");
  });

  it("leaves a path no prefix matches alone", () => {
    expect(mapEditorPath("/srv/Foo.ts", { "/app": "/home/me" })).toBe("/srv/Foo.ts");
  });

  it("prefers the longest matching prefix", () => {
    // A specific mapping has to be able to sit inside a general one.
    const map = { "/app": "/home/me", "/app/vendor": "/opt/vendor" };
    expect(mapEditorPath("/app/vendor/x.ts", map)).toBe("/opt/vendor/x.ts");
    expect(mapEditorPath("/app/src/x.ts", map)).toBe("/home/me/src/x.ts");
  });

  it("is a no-op with an empty map", () => {
    expect(mapEditorPath("/app/x.ts", {})).toBe("/app/x.ts");
  });
});

describe("shortLocation", () => {
  it("keeps the last two segments and the line", () => {
    // An absolute path from a monorepo is sixty characters of which the last
    // twenty are the part you read.
    expect(shortLocation(at("/a/b/c/controllers/PostController.ts", 88))).toBe(
      "controllers/PostController.ts:88",
    );
  });

  it("handles a Windows path", () => {
    expect(shortLocation(at("C:\\app\\src\\Foo.ts", 3))).toBe("src/Foo.ts:3");
  });

  it("handles a path with nothing to trim", () => {
    expect(shortLocation(at("Foo.ts", 1))).toBe("Foo.ts:1");
  });
});
