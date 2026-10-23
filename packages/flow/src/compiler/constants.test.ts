import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as ts from "typescript";
import { mkdtemp, mkdir, writeFile, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "@zerotal/core";
import { Component } from "../Component.ts";
import { registerPage, _getPageEntries, type PageEntry } from "../registry.ts";
import { compileRegisteredPages } from "./index.ts";
import {
  foldStaticString,
  moduleStringConstants,
  exportedStringConstants,
  resolveImportedStrings,
  staticStringsFingerprint,
  normalizeClassList,
} from "./constants.ts";
import { transformFlowFile, type BlockerReport } from "./transform.ts";

const parse = (code: string) =>
  ts.createSourceFile("m.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** Fold one expression written as source text, with `names` already known. */
function fold(expression: string, names: Record<string, string> = {}): string | undefined {
  const sf = parse(`const __x = ${expression};`);
  const statement = sf.statements[0] as ts.VariableStatement;
  const init = statement.declarationList.declarations[0]!.initializer!;
  return foldStaticString(init, new Map(Object.entries(names)));
}

describe("foldStaticString", () => {
  it("reads a string literal and a template with nothing in it", () => {
    expect(fold(`"rounded p-4"`)).toBe("rounded p-4");
    expect(fold("`rounded p-4`")).toBe("rounded p-4");
  });

  it("joins strings with +", () => {
    expect(fold(`"a" + " " + "b"`)).toBe("a b");
  });

  it("reads a name it knows, and only a name it knows", () => {
    expect(fold("CARD", { CARD: "rounded" })).toBe("rounded");
    expect(fold("CARD")).toBeUndefined();
  });

  it("reads a template whose substitutions are all static", () => {
    expect(fold("`${CARD} mt-${GAP}`", { CARD: "rounded", GAP: "4" })).toBe("rounded mt-4");
  });

  it("sees through parentheses, as and satisfies", () => {
    expect(fold(`("a" as const)`)).toBe("a");
    expect(fold(`"a" satisfies string`)).toBe("a");
    expect(fold(`("a" + "b")!`)).toBe("ab");
  });

  it("gives up on anything it would have to run", () => {
    expect(fold("f()")).toBeUndefined();
    expect(fold(`"a".toUpperCase()`)).toBeUndefined();
    expect(fold(`flag ? "a" : "b"`, { flag: "x" })).toBeUndefined();
    expect(fold("`${this.x}`")).toBeUndefined();
    expect(fold("1")).toBeUndefined();
    expect(fold(`"a" + 1`)).toBeUndefined();
    expect(fold(`"a" - "b"`)).toBeUndefined();
  });

  it("gives up on a template when any one substitution is unknown", () => {
    expect(fold("`${A} ${B}`", { A: "a" })).toBeUndefined();
  });
});

describe("moduleStringConstants", () => {
  it("collects top-level consts, building later ones from earlier ones", () => {
    const sf = parse(`
      const BASE = "rounded";
      const CARD = BASE + " p-4";
      const WIDE = \`\${CARD} w-full\`;
    `);
    expect([...moduleStringConstants(sf)]).toEqual([
      ["BASE", "rounded"],
      ["CARD", "rounded p-4"],
      ["WIDE", "rounded p-4 w-full"],
    ]);
  });

  it("ignores let, var, destructuring and anything computed", () => {
    const sf = parse(`
      let A = "a";
      var B = "b";
      const { C } = { C: "c" };
      const D = compute();
      const E = "e";
    `);
    expect([...moduleStringConstants(sf)]).toEqual([["E", "e"]]);
  });

  it("does not use a const before it is declared", () => {
    const sf = parse(`const A = B + "a"; const B = "b";`);
    expect(moduleStringConstants(sf).has("A")).toBe(false);
  });

  it("starts from what it is given", () => {
    const sf = parse(`const A = IMPORTED + " x";`);
    expect(moduleStringConstants(sf, new Map([["IMPORTED", "i"]])).get("A")).toBe("i x");
  });
});

describe("exportedStringConstants", () => {
  it("returns exported consts, by their exported name", () => {
    const sf = parse(`
      export const A = "a";
      const B = "b";
      const C = "c";
      export { B, C as D };
      const NOT_EXPORTED = "n";
      export const COMPUTED = f();
    `);
    expect([...exportedStringConstants(sf)].sort()).toEqual([
      ["A", "a"],
      ["B", "b"],
      ["D", "c"],
    ]);
  });

  it("does not treat a re-export as an export of the module's own constant", () => {
    expect(exportedStringConstants(parse(`export { A } from "./other.ts";`)).size).toBe(0);
  });
});

describe("resolveImportedStrings", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zt-flow-constants-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const resolveFrom = (importLine: string): [string, string][] => [
    ...resolveImportedStrings(importLine, join(dir, "page.tsx")),
  ];

  it("reads a named import from a relative module, under the name it is imported as", async () => {
    await writeFile(
      join(dir, "ui.ts"),
      `export const CARD = "rounded"; export const GAP = "mt-4";`,
    );
    expect(resolveFrom(`import { CARD as Box, GAP } from "./ui.ts";`)).toEqual([
      ["Box", "rounded"],
      ["GAP", "mt-4"],
    ]);
  });

  it("finds the module without an extension, with a .js specifier, and as a folder", async () => {
    await writeFile(join(dir, "ui.ts"), `export const A = "a";`);
    await mkdir(join(dir, "kit"));
    await writeFile(join(dir, "kit", "index.ts"), `export const B = "b";`);
    expect(resolveFrom(`import { A } from "./ui";`)).toEqual([["A", "a"]]);
    expect(resolveFrom(`import { A } from "./ui.js";`)).toEqual([["A", "a"]]);
    expect(resolveFrom(`import { B } from "./kit";`)).toEqual([["B", "b"]]);
  });

  it("reaches a module in a parent folder", async () => {
    await mkdir(join(dir, "pages"));
    await writeFile(join(dir, "ui.ts"), `export const A = "a";`);
    const found = resolveImportedStrings(
      `import { A } from "../ui.ts";`,
      join(dir, "pages", "p.tsx"),
    );
    expect([...found]).toEqual([["A", "a"]]);
  });

  it("leaves package imports alone", async () => {
    expect(resolveFrom(`import { CARD } from "zerotal";`)).toEqual([]);
  });

  it("leaves default, namespace and type-only imports alone", async () => {
    await writeFile(join(dir, "ui.ts"), `export const CARD = "rounded"; export default "d";`);
    expect(resolveFrom(`import CARD from "./ui.ts";`)).toEqual([]);
    expect(resolveFrom(`import * as ui from "./ui.ts";`)).toEqual([]);
    expect(resolveFrom(`import type { CARD } from "./ui.ts";`)).toEqual([]);
    expect(resolveFrom(`import { type CARD } from "./ui.ts";`)).toEqual([]);
  });

  it("skips an export that does not fold, and a module that is not there", async () => {
    await writeFile(join(dir, "ui.ts"), `export const CARD = "rounded"; export const LIVE = f();`);
    expect(resolveFrom(`import { CARD, LIVE } from "./ui.ts";`)).toEqual([["CARD", "rounded"]]);
    expect(resolveFrom(`import { CARD } from "./missing.ts";`)).toEqual([]);
  });

  it("does not follow a re-export", async () => {
    await writeFile(join(dir, "ui.ts"), `export const CARD = "rounded";`);
    await writeFile(join(dir, "barrel.ts"), `export { CARD } from "./ui.ts";`);
    expect(resolveFrom(`import { CARD } from "./barrel.ts";`)).toEqual([]);
  });
});

describe("staticStringsFingerprint", () => {
  it("is empty for a page that uses none, so its cache key does not change", () => {
    expect(staticStringsFingerprint(new Map())).toBe("");
  });

  it("does not depend on the order the names were found in", () => {
    const a = staticStringsFingerprint(
      new Map([
        ["A", "1"],
        ["B", "2"],
      ]),
    );
    const b = staticStringsFingerprint(
      new Map([
        ["B", "2"],
        ["A", "1"],
      ]),
    );
    expect(a).toBe(b);
  });

  it("changes when a value changes, when a name changes, and when one goes away", () => {
    const base = staticStringsFingerprint(
      new Map([
        ["A", "1"],
        ["B", "2"],
      ]),
    );
    const changedValue = new Map([
      ["A", "1"],
      ["B", "3"],
    ]);
    const changedName = new Map([
      ["A", "1"],
      ["C", "2"],
    ]);
    expect(staticStringsFingerprint(changedValue)).not.toBe(base);
    expect(staticStringsFingerprint(changedName)).not.toBe(base);
    expect(staticStringsFingerprint(new Map([["A", "1"]]))).not.toBe(base);
  });
});

describe("normalizeClassList", () => {
  it("collapses runs of whitespace, newlines included, and trims", () => {
    expect(normalizeClassList("  a  b\n   c\t d ")).toBe("a b c d");
  });
});

/** A page with `top` above the class and `members` inside it. */
function source(body: string, top = "", members = "@expose open = false;"): string {
  return `/** @jsxImportSource @zerotal/flow */
import { Component, expose } from '@zerotal/flow';
${top}
export class DemoPage extends Component {
  ${members}
  override async render() { return (${body}); }
}`;
}

const FILE = "/app/flow/pages/demo.tsx";
/** renderBody is JS source, so its HTML has JSON-escaped quotes: drop the backslashes. */
const html = (r: { renderBody: string } | null) => (r ? r.renderBody.replace(/\\/g, "") : "");

describe("Flow compiler - class built from string constants", () => {
  it("compiles class={CONST} for a const in the same file", () => {
    const r = transformFlowFile(
      source(`<div class={CARD}>x</div>`, `const CARD = "rounded p-4";`),
      FILE,
    );
    expect(r).not.toBeNull();
    expect(html(r)).toContain('class="rounded p-4"');
    expect(html(r)).not.toContain(":class");
  });

  it("compiles className the same way", () => {
    const r = transformFlowFile(
      source(`<div className={CARD}>x</div>`, `const CARD = "a b";`),
      FILE,
    );
    expect(html(r)).toContain('class="a b"');
  });

  it("compiles a constant handed in from an import", () => {
    const r = transformFlowFile(
      source(`<div class={CARD}>x</div>`, `import { CARD } from "./ui.ts";`),
      FILE,
      { constants: new Map([["CARD", "rounded p-4"]]) },
    );
    expect(html(r)).toContain('class="rounded p-4"');
  });

  it("falls back, as before, when the import could not be read", () => {
    const report: BlockerReport = {};
    const r = transformFlowFile(
      source(`<div class={CARD}>x</div>`, `import { CARD } from "./ui.ts";`),
      FILE,
      { report },
    );
    expect(r).toBeNull();
    expect(report.blocker?.reason).toContain("is not a static class string");
  });

  it("compiles constants joined with + and inside a template", () => {
    const r = transformFlowFile(
      source(
        "<div class={`${BTN} mt-4`}>x</div>",
        `const BASE = "rounded"; const BTN = BASE + " px-3";`,
      ),
      FILE,
    );
    expect(html(r)).toContain('class="rounded px-3 mt-4"');
  });

  it("collapses the whitespace of a constant written over several lines", () => {
    const r = transformFlowFile(
      source(`<div class={CARD}>x</div>`, "const CARD = `\n  rounded\n    p-4\n`;"),
      FILE,
    );
    expect(html(r)).toContain('class="rounded p-4"');
  });

  it("escapes what it folds, as it would a literal", () => {
    const r = transformFlowFile(source(`<div class={C}>x</div>`, `const C = 'a"b';`), FILE);
    expect(html(r)).toContain("class=");
    expect(html(r)).not.toContain('a"b');
  });

  it("folds the constant part of a reactive class and keeps the rest reactive", () => {
    const r = transformFlowFile(
      source(
        "<div class={`${CARD} ${this.open ? 'on' : 'off'} mt-4`}>x</div>",
        `const CARD = "rounded";`,
      ),
      FILE,
    );
    expect(html(r)).toContain('class="rounded mt-4"');
    expect(html(r)).toContain(":class=");
    expect(html(r)).toContain("$flow.open");
  });

  it("joins a folded span to the text beside it", () => {
    const r = transformFlowFile(
      source("<div class={`p-${SIZE} ${this.open ? 'on' : 'off'}`}>x</div>", `const SIZE = "4";`),
      FILE,
    );
    expect(html(r)).toContain('class="p-4"');
  });

  it("makes a page that uses one legal under cspSafe", () => {
    const r = transformFlowFile(
      source(`<div class={CARD}>x</div>`, `const CARD = "rounded";`),
      FILE,
      { cspSafe: true },
    );
    expect(r).not.toBeNull();
  });

  describe("falls back to the runtime when it cannot be sure", () => {
    const reasonFor = (top: string, body = `<div class={CARD}>x</div>`, members?: string) => {
      const report: BlockerReport = {};
      const r = transformFlowFile(source(body, top, members), FILE, { report });
      return r ? undefined : report.blocker?.reason;
    };

    it("for a let", () => {
      expect(reasonFor(`let CARD = "a";`)).toContain("is not a static class string");
    });

    it("for a value that has to be computed", () => {
      expect(reasonFor(`const CARD = pick("a");`)).toContain("is not a static class string");
      expect(reasonFor(`const CARD = "a".toUpperCase();`)).toContain(
        "is not a static class string",
      );
    });

    it("for a name the page declares itself, wherever in the class", () => {
      const members = `label(CARD: string) { return CARD; }`;
      expect(reasonFor(`const CARD = "a";`, `<div class={CARD}>x</div>`, members)).toContain(
        "is not a static class string",
      );
    });

    it("for a local in render() that hides the constant", () => {
      const report: BlockerReport = {};
      const code = `/** @jsxImportSource @zerotal/flow */
import { Component } from '@zerotal/flow';
const CARD = "a";
export class DemoPage extends Component {
  override async render() { const CARD = String(Date.now()); return (<div class={CARD}>x</div>); }
}`;
      expect(transformFlowFile(code, FILE, { report })).toBeNull();
      expect(report.blocker?.reason).toContain("is not a static class string");
    });
  });
});

describe("class constants, end to end through compileRegisteredPages", () => {
  let dir: string;
  let saved: Array<[string, PageEntry]>;

  beforeEach(async () => {
    Application._resetInstance();
    dir = await mkdtemp(join(tmpdir(), "zt-flow-constants-e2e-"));
    saved = [..._getPageEntries().entries()];
    _getPageEntries().clear();
    await writeFile(
      join(dir, "Home.tsx"),
      `/** @jsxImportSource @zerotal/flow */
import { Component } from '@zerotal/flow';
import { CARD } from "./ui.ts";
export class Home extends Component {
  override async render() { return (<div class={CARD}>x</div>); }
}`,
    );
  });

  afterEach(async () => {
    _getPageEntries().clear();
    for (const [name, entry] of saved) _getPageEntries().set(name, entry);
    await rm(dir, { recursive: true, force: true });
    Application._resetInstance();
  });

  /** Register a fresh page class for Home.tsx and compile it. Returns the class. */
  async function compileHome(): Promise<{ __flowCompiled?: boolean }> {
    _getPageEntries().clear();
    const Base = Component as unknown as new () => object;
    const Page = class extends Base {} as unknown as typeof Component;
    // registerPage() keys on the class name, and an anonymous class has none.
    Object.defineProperty(Page, "name", { value: "Home" });
    (Page as unknown as { __sourceFile: string }).__sourceFile = join(dir, "Home.tsx");
    registerPage("/home", Page);
    await compileRegisteredPages(dir);
    return Page as unknown as { __flowCompiled?: boolean };
  }

  const compiledFiles = async (): Promise<Record<string, string>> => {
    const cache = join(dir, ".zerotal", "compiled");
    const out: Record<string, string> = {};
    for (const name of await readdir(cache)) out[name] = await readFile(join(cache, name), "utf8");
    return out;
  };

  const setUi = (card: string) => writeFile(join(dir, "ui.ts"), `export const CARD = "${card}";\n`);

  it("compiles a page whose class comes from a shared module", async () => {
    await setUi("p-4");
    const Page = await compileHome();
    expect(Page.__flowCompiled).toBe(true);
    const files = Object.values(await compiledFiles());
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("p-4");
  });

  it("recompiles when the shared module changes, and reuses the cache when it does not", async () => {
    await setUi("p-4");
    await compileHome();
    expect(Object.keys(await compiledFiles())).toHaveLength(1);

    await compileHome(); // nothing changed
    expect(Object.keys(await compiledFiles())).toHaveLength(1);

    await setUi("p-8"); // only ui.ts changed; Home.tsx is byte-for-byte the same
    const Page = await compileHome();
    expect(Page.__flowCompiled).toBe(true);
    const files = Object.values(await compiledFiles());
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.includes("p-8"))).toBe(true);
  });

  it("falls back when the shared module stops being a plain string", async () => {
    await setUi("p-4");
    await compileHome();

    await writeFile(join(dir, "ui.ts"), `export const CARD = ["p-4"].join(" ");\n`);
    const Page = await compileHome();
    expect(Page.__flowCompiled).toBeUndefined();
  });
});
