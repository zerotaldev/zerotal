import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Application } from "@zerotal/core";
import { registerPage, _getPageEntries, type PageEntry } from "../registry.ts";
import type { Component } from "../Component.ts";
import { compileRegisteredPages } from "./index.ts";

/**
 * A page an app registers from its route file — `Router.flow("/settings/profile", ProfilePage)` —
 * is compiled like a file-routed one: its source is the file under app/flow/pages/ that exports
 * that class. It used to have no source at all, so it always rendered through the runtime.
 */

const FLOW = fileURLToPath(new URL("../..", import.meta.url));
let root: string;
let saved: Array<[string, PageEntry]>;

const PAGE = (name: string) => `/** @jsxImportSource @zerotal/flow */
import { Component } from "@zerotal/flow";
export class ${name} extends Component {
  override async render() { return (<main>${name}</main>); }
}
`;

type Compiled = typeof Component & { __flowCompiled?: boolean; __sourceFile?: string };

beforeEach(async () => {
  Application._resetInstance();
  // Inside the package, so the page's own `@zerotal/flow` import resolves.
  root = join(FLOW, `.tmp-located-${process.pid}-${Date.now()}`);
  await mkdir(join(root, "app", "flow", "pages", "settings"), { recursive: true });
  saved = [..._getPageEntries().entries()];
  _getPageEntries().clear();
});

afterEach(async () => {
  _getPageEntries().clear();
  for (const [name, entry] of saved) _getPageEntries().set(name, entry);
  await rm(root, { recursive: true, force: true });
  Application._resetInstance();
});

async function load(file: string, name: string): Promise<Compiled> {
  const path = join(root, "app", "flow", "pages", file);
  await writeFile(path, PAGE(name));
  return (await import(pathToFileURL(path).href))[name] as Compiled;
}

describe("a page registered from code", () => {
  it("is compiled from the file under app/flow/pages/ that exports it", async () => {
    const Profile = await load("settings/profile.tsx", "ProfilePage");
    registerPage("/settings/profile", Profile);
    await compileRegisteredPages(root);
    expect(Profile.__sourceFile).toBe(
      join(root, "app", "flow", "pages", "settings", "profile.tsx"),
    );
    expect(Profile.__flowCompiled).toBe(true);
  });

  it("keeps a source file it was already given", async () => {
    const Home = await load("home.tsx", "HomePage");
    Home.__sourceFile = join(root, "app", "flow", "pages", "home.tsx");
    registerPage("/", Home);
    await compileRegisteredPages(root);
    expect(Home.__flowCompiled).toBe(true);
  });

  it("is left to the runtime when no file there exports it", async () => {
    await load("home.tsx", "HomePage");
    const Elsewhere = class {} as unknown as Compiled;
    Object.defineProperty(Elsewhere, "name", { value: "Elsewhere" });
    registerPage("/elsewhere", Elsewhere);
    await compileRegisteredPages(root);
    expect(Elsewhere.__sourceFile).toBeUndefined();
    expect(Elsewhere.__flowCompiled).toBeUndefined();
  });
});
