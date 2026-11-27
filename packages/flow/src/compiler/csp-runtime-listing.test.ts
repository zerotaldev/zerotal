import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Application } from "@zerotal/core";
import {
  registerPage,
  registerComponent,
  _getPageEntries,
  _refuseRuntimeComponents,
  type PageEntry,
} from "../registry.ts";
import type { Component } from "../Component.ts";
import { compileRegisteredPages } from "./index.ts";

/**
 * `cspSafe` promises a page renders without the eval-based runtime. It checked the pages it
 * compiled, and nothing else: a page with no source file under the page tree (one a package
 * registers) and a child registered on first render skipped the compiler and rendered through
 * the runtime anyway. Now the boot lists every such component and stops, and a component first
 * registered after that boot is refused.
 */

const FLOW = fileURLToPath(new URL("../..", import.meta.url));
let root: string;
let saved: Array<[string, PageEntry]>;

const SOURCE = (name: string) => `/** @jsxImportSource @zerotal/flow */
import { Component } from "@zerotal/flow";
export class ${name} extends Component {
  override async render() { return (<main>${name}</main>); }
}
`;

type Compiled = typeof Component & { __flowCompiled?: boolean; __sourceFile?: string };

beforeEach(async () => {
  Application._resetInstance();
  root = join(FLOW, `.tmp-csp-listing-${process.pid}-${Date.now()}`);
  await mkdir(join(root, "app", "flow", "pages"), { recursive: true });
  await mkdir(join(root, "app", "flow", "components"), { recursive: true });
  saved = [..._getPageEntries().entries()];
  _getPageEntries().clear();
});

afterEach(async () => {
  _refuseRuntimeComponents(false);
  _getPageEntries().clear();
  for (const [name, entry] of saved) _getPageEntries().set(name, entry);
  await rm(root, { recursive: true, force: true });
  Application._resetInstance();
});

async function load(dir: "pages" | "components", name: string): Promise<Compiled> {
  const path = join(root, "app", "flow", dir, `${name}.tsx`);
  await writeFile(path, SOURCE(name));
  return (await import(pathToFileURL(path).href))[name] as Compiled;
}

/** A class with no file anywhere under app/flow/, as a package's page is. */
function packagePage(name: string): Compiled {
  const Page = class {} as unknown as Compiled;
  Object.defineProperty(Page, "name", { value: name });
  return Page;
}

describe("a cspSafe boot", () => {
  it("fails, naming every component that would render through the runtime, and the fix", async () => {
    registerPage("/", await load("pages", "HomePage"));
    registerPage("/admin", packagePage("AdminDashboard"));
    registerPage("/admin/users", packagePage("AdminUsers"));

    let thrown: unknown;
    try {
      await compileRegisteredPages(root, true);
    } catch (error) {
      thrown = error;
    }

    expect((thrown as Error).name).toBe("FlowValidationError");
    const message = (thrown as Error).message;
    expect(message).toContain("AdminDashboard (/admin)");
    expect(message).toContain("AdminUsers (/admin/users)");
    expect(message).not.toContain("HomePage");
    expect(message).toContain("registerComponent(Child)");
    expect(message).toContain("turn flow.cspSafe off");
  });

  it("passes when every registered component compiles, a child under components/ included", async () => {
    const Home = await load("pages", "HomePage");
    const Card = await load("components", "ProfileCard");
    registerPage("/", Home);
    registerComponent(Card); // at boot, from a provider

    await compileRegisteredPages(root, true);

    expect(Home.__flowCompiled).toBe(true);
    expect(Card.__flowCompiled).toBe(true);
  });

  it("then refuses a component first registered on render", async () => {
    registerPage("/", await load("pages", "HomePage"));
    await compileRegisteredPages(root, true);

    const Late = await load("components", "LateWidget");
    expect(() => registerComponent(Late, "/")).toThrow(/LateWidget is registered on first render/);
  });

  it("is not what a boot without cspSafe does", async () => {
    registerPage("/admin", packagePage("AdminDashboard"));
    await compileRegisteredPages(root, false);

    const Late = await load("components", "LateWidget");
    expect(() => registerComponent(Late, "/")).not.toThrow();
  });
});
