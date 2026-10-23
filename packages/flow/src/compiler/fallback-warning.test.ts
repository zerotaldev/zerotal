import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "@zerotal/core";
import { frameworkLog } from "@zerotal/core/logger";
import { Component } from "../Component.ts";
import { registerPage, _getPageEntries, type PageEntry } from "../registry.ts";
import { compileRegisteredPages } from "./index.ts";

/**
 * The "most of your pages render through the runtime fallback" warning.
 *
 * It exists to tell an app's authors that their own pages are not compiling. A page registered
 * from code rather than loaded from the app's files, such as one a package ships for its own UI,
 * has nothing for the app's authors to change, but it used to be counted all the same: a fresh
 * admin app, whose panel pages come from `@zerotal/admin`, was told 12 of 12 of "its" pages were
 * falling back.
 */

/** A minimal Flow page. `body` is what render() returns. */
function source(body: string): string {
  return `/** @jsxImportSource @zerotal/flow */
import { Component } from '@zerotal/flow';
const SUFFIX = '!';
export class DemoPage extends Component {
  override async render() { return (${body}); }
}`;
}

const COMPILES = `<div class="ok">x</div>`;
// A computed class is not a static string, so the compiler leaves the page to the runtime.
const FALLS_BACK = `<div class={SUFFIX}>x</div>`;

let dir: string;
let saved: Array<[string, PageEntry]>;

beforeEach(async () => {
  Application._resetInstance(); // no ambient app, so frameworkLog() writes to stdout
  dir = await mkdtemp(join(tmpdir(), "zt-flow-fallback-"));
  // The registry is one module-level map: take everything out, and put it all back afterwards.
  saved = [..._getPageEntries().entries()];
  _getPageEntries().clear();
});

afterEach(async () => {
  _getPageEntries().clear();
  for (const [name, entry] of saved) _getPageEntries().set(name, entry);
  await rm(dir, { recursive: true, force: true });
  Application._resetInstance();
});

/**
 * A page class that is only ever registered and compiled, never rendered.
 *
 * It has no render() of its own on purpose. A class that has one can be bind-injected rather than
 * counted as falling back, and what this file tests is how the fallbacks are counted. (The cast
 * is only to get past `Component.render` being abstract.)
 */
function stubPage(name: string): typeof Component {
  const Base = Component as unknown as new () => object;
  const Page = class extends Base {} as unknown as typeof Component;
  // registerPage() keys on the class name, and an anonymous class has none: without this every
  // stub lands on the same registry entry and the page count never gets past one.
  Object.defineProperty(Page, "name", { value: name });
  return Page;
}

/** Register a page whose source lives in this app (so the compiler tries to compile it). */
async function appPage(name: string, body: string): Promise<void> {
  const file = join(dir, `${name}.tsx`);
  await writeFile(file, source(body));
  const Page = stubPage(name);
  (Page as unknown as { __sourceFile: string }).__sourceFile = file;
  registerPage(`/${name}`, Page);
}

/** Register a page that was registered from code, with no source file in this app. */
function externalPage(name: string): void {
  registerPage(`/${name}`, stubPage(name));
}

/** Run the compile step and return everything it wrote to stdout. */
async function compileAndCapture(): Promise<string> {
  let out = "";
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    // Without this, "no warning appeared" is also what a capture that never worked looks like.
    frameworkLog("probe").warn("PROBE");
    await Bun.sleep(0);
    if (!out.includes("PROBE")) throw new Error("the capture is not seeing frameworkLog() output");

    await compileRegisteredPages(dir);
    await Bun.sleep(0);
  } finally {
    process.stdout.write = original;
  }
  return out;
}

const WARNING = "render through the runtime fallback";

describe("the runtime-fallback warning counts only this app's own pages", () => {
  it("stays quiet for an app whose only pages come from a package", async () => {
    for (let i = 0; i < 12; i++) externalPage(`PanelPage${i}`);

    expect(await compileAndCapture()).not.toContain(WARNING);
  });

  it("does not let a package's pages push the app over the line", async () => {
    // 3 of the app's 7 pages fall back (43%), but with 10 package pages added in it would read
    // 13 of 17 (76%).
    for (let i = 0; i < 4; i++) await appPage(`Compiles${i}`, COMPILES);
    for (let i = 0; i < 3; i++) await appPage(`Falls${i}`, FALLS_BACK);
    for (let i = 0; i < 10; i++) externalPage(`PanelPage${i}`);

    expect(await compileAndCapture()).not.toContain(WARNING);
  });

  it("reports the app's own figures, not the package's", async () => {
    for (let i = 0; i < 5; i++) await appPage(`Falls${i}`, FALLS_BACK);
    for (let i = 0; i < 20; i++) externalPage(`PanelPage${i}`);

    const out = await compileAndCapture();

    expect(out).toContain("5 of 5 Flow pages (100%)");
    expect(out).not.toContain("25 of 25");
  });

  it("still warns when an app's own pages mostly fall back", async () => {
    for (let i = 0; i < 5; i++) await appPage(`Falls${i}`, FALLS_BACK);

    expect(await compileAndCapture()).toContain("5 of 5 Flow pages (100%)");
  });

  it("still stays quiet below the minimum number of pages", async () => {
    for (let i = 0; i < 3; i++) await appPage(`Falls${i}`, FALLS_BACK);

    expect(await compileAndCapture()).not.toContain(WARNING);
  });
});
