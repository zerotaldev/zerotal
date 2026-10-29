/**
 * A group's middleware runs once on a file route.
 *
 * `scanFileRoutes` runs inside `Router.groupAsync`, and every registrar a file route
 * reaches puts the group's middleware in front of the route's own. The scanner used to
 * copy the group's middleware into that list as well, so each group middleware ran
 * twice per request: a throttle allowed half its budget, and anything with a side
 * effect did it twice. Nothing failed or logged, which is why this is a test.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Router } from "./Router.ts";
import {
  scanFileRoutes,
  registerFileRouteResolver,
  _resetFileRouteResolvers,
  _resetFileRouteLayouts,
} from "./FileRouter.ts";
import { registerViewFileRouteResolver } from "../view/index.ts";
import { Container } from "../container/Container.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";
import type { NextFn } from "../pipeline/types.ts";

const counts = { group: 0, dir: 0 };
(globalThis as Record<string, unknown>)["__groupMwCounts"] = counts;

class GroupCount {
  async handle(_http: HttpContext, next: NextFn): Promise<Response | void> {
    counts.group++;
    return next();
  }
}

/** Stands in for the Flow page resolver: claims the file and registers at the absolute path. */
class ClaimedPage {
  async handle(http: HttpContext): Promise<void> {
    http.response = new Response("claimed");
  }
}

let dir: string;

beforeEach(async () => {
  Router.reset();
  _resetFileRouteResolvers();
  _resetFileRouteLayouts();
  counts.group = 0;
  counts.dir = 0;
  dir = await mkdtemp(join(tmpdir(), "zt-group-mw-"));
  await mkdir(join(dir, "inv"), { recursive: true });
  await Bun.write(
    join(dir, "inv", "_middleware.ts"),
    `class DirCount {
       async handle(_h, next) { globalThis.__groupMwCounts.dir++; return next(); }
     }
     export const middleware = [DirCount];`,
  );
  await Bun.write(
    join(dir, "inv", "index.ts"),
    `export function GET() { return new Response("list"); }
     export function POST() { return new Response("made"); }`,
  );
  await Bun.write(join(dir, "inv", "view.tsx"), `export default () => "<p>view</p>";`);
  await Bun.write(join(dir, "inv", "page.ts"), `export const claimedPage = true;`);
});

// Each test scans a fresh directory, so each one removes its own.
afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

afterAll(() => {
  Router.reset();
  _resetFileRouteResolvers();
  _resetFileRouteLayouts();
});

async function scanInGroup(): Promise<void> {
  registerViewFileRouteResolver();
  registerFileRouteResolver(({ urlPath, module, middleware, name }) => {
    if (module["claimedPage"] !== true) return false;
    Router._registerAbsolute("GET", urlPath, ClaimedPage as never, "handle", middleware, name);
    return true;
  });
  await Router.groupAsync({ prefix: "/x", middleware: [GroupCount as never] }, () =>
    scanFileRoutes(dir).then(() => {}),
  );
}

async function request(method: string, path: string): Promise<Response> {
  const compiled = Router.compile(new Container(), []);
  const entry = compiled[path] as Record<string, (req: Request) => Promise<Response>>;
  return entry[method]!(new Request(`http://x${path}`, { method }));
}

describe("a group's middleware on file routes", () => {
  it("is listed once on a plain file route, a view route and a claimed page", async () => {
    await scanInGroup();

    for (const [method, path] of [
      ["GET", "/x/inv"],
      ["POST", "/x/inv"],
      ["GET", "/x/inv/view"],
      ["GET", "/x/inv/page"],
    ] as const) {
      const names = Router.middlewareFor(method, path).map((m) => m.name);
      expect({ route: `${method} ${path}`, names }).toEqual({
        route: `${method} ${path}`,
        names: ["GroupCount", "DirCount"],
      });
    }
  });

  it("runs once per request, and the directory's middleware runs once too", async () => {
    await scanInGroup();

    for (const [method, path, body] of [
      ["GET", "/x/inv", "list"],
      ["POST", "/x/inv", "made"],
      ["GET", "/x/inv/view", "<p>view</p>"],
      ["GET", "/x/inv/page", "claimed"],
    ] as const) {
      counts.group = 0;
      counts.dir = 0;
      const res = await request(method, path);
      expect(await res.text()).toBe(body);
      expect({ route: `${method} ${path}`, ...counts }).toEqual({
        route: `${method} ${path}`,
        group: 1,
        dir: 1,
      });
    }
  });
});
