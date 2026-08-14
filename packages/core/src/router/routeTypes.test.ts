import { describe, it, expect, afterEach } from "bun:test";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateRouteTypes, writeRouteTypes, ROUTE_TYPES_FILE } from "./routeTypes.ts";

const dirs: string[] = [];

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zt-route-types-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("generateRouteTypes", () => {
  it("emits one line per route, sorted by name", () => {
    const out = generateRouteTypes(
      new Map([
        ["posts.show", "/posts/:slug"],
        ["home", "/"],
        ["api.users.index", "/api/users"],
      ]),
    );

    const body = out.slice(out.indexOf("export const ROUTES"), out.indexOf("} as const;"));
    expect(body.split("\n").slice(1, -1)).toEqual([
      '  "api.users.index": "/api/users",',
      // Bare identifiers stay unquoted — the same rule a formatter would apply,
      // so `format:check` never fights a file nobody edits.
      '  home: "/",',
      '  "posts.show": "/posts/:slug",',
    ]);
  });

  it("augments RouteRegistry so route() picks the names up", () => {
    const out = generateRouteTypes(new Map([["home", "/"]]));
    expect(out).toContain('declare module "@zerotal/core"');
    expect(out).toContain("interface RouteRegistry extends Routes {}");
    expect(out).toContain("as const;");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("is stable regardless of registration order", () => {
    const a = generateRouteTypes(
      new Map([
        ["b", "/b"],
        ["a", "/a"],
      ]),
    );
    const b = generateRouteTypes(
      new Map([
        ["a", "/a"],
        ["b", "/b"],
      ]),
    );
    expect(a).toBe(b);
  });

  it("emits a valid empty map when nothing is named", () => {
    expect(generateRouteTypes(new Map())).toContain("export const ROUTES = {} as const;");
  });
});

describe("writeRouteTypes", () => {
  it("writes the file and reports the change", async () => {
    const cwd = await tempProject();
    const result = await writeRouteTypes(new Map([["home", "/"]]), { cwd });

    expect(result.changed).toBe(true);
    expect(result.count).toBe(1);
    expect(result.path).toBe(ROUTE_TYPES_FILE);
    expect(await Bun.file(`${cwd}/${ROUTE_TYPES_FILE}`).text()).toBe(result.content);
  });

  it("reports no change when the file already matches", async () => {
    const cwd = await tempProject();
    const routes = new Map([["home", "/"]]);
    await writeRouteTypes(routes, { cwd });

    expect((await writeRouteTypes(routes, { cwd })).changed).toBe(false);
  });

  it("--check never writes, and reports a missing file as stale", async () => {
    const cwd = await tempProject();

    const missing = await writeRouteTypes(new Map([["home", "/"]]), { cwd, check: true });
    expect(missing.changed).toBe(true);
    expect(await Bun.file(`${cwd}/${ROUTE_TYPES_FILE}`).exists()).toBe(false);

    await writeRouteTypes(new Map([["home", "/"]]), { cwd });
    // A route added since the last generate is what the CI gate has to catch.
    const stale = await writeRouteTypes(
      new Map([
        ["home", "/"],
        ["about", "/about"],
      ]),
      { cwd, check: true },
    );
    expect(stale.changed).toBe(true);
    expect(await Bun.file(`${cwd}/${ROUTE_TYPES_FILE}`).text()).not.toContain("about");
  });
});
