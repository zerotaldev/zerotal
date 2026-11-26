/**
 * The generated `AGENTS.md` must not contradict the app it is written into.
 *
 * A walk of the 1.18.0 starters found every one telling an agent "an
 * `@zerotal/orm` import would reach a package this app does not declare" and then,
 * a few lines later, "`DB` from `@zerotal/orm`". It also told the agent to declare
 * notification channels in a method that does not exist, listed directories the
 * starter routes nothing through, called the queue ready when its provider was
 * not registered, and told a Flow app that every component is interactive when
 * the starter's page base turns that off. Each case below pins one of those.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectShape } from "./shape.ts";
import { buildGuidelines, _BUNDLED_PACKAGES } from "./guidelines.ts";
import { SKILLS, renderSkill } from "./skills.ts";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zt-guidelines-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, contents, "utf8");
}

/** What a starter declares once installed: the bundle and what it carries. */
const STARTER = ["zerotal", ..._BUNDLED_PACKAGES, "@zerotal/inertia", "@zerotal/notifications"];

/** A starter laid out the way `create-zerotal` writes one. */
async function starter(options: { registered?: boolean; providers?: string } = {}) {
  await write("package.json", JSON.stringify({ dependencies: { zerotal: "~1.18.0" } }));
  await write("app/routes/index.ts", "export {};");
  await write(
    "bootstrap/providers.ts",
    options.providers ?? "export default [AuthProvider, InertiaProvider];",
  );
  if (options.registered) await write("routes/web.ts", "export {};");
  return detectShape(root);
}

describe("the bundle list", () => {
  it("is exactly what the `zerotal` package re-exports", async () => {
    const manifest = (await Bun.file(join(ROOT, "packages", "zerotal", "package.json")).json()) as {
      dependencies: Record<string, string>;
    };
    const bundled = Object.keys(manifest.dependencies)
      .filter((name) => name.startsWith("@zerotal/"))
      // Carried for the kernel and the client, not imported by an app through a subpath.
      .filter((name) => name !== "@zerotal/core" && name !== "@zerotal/client")
      .sort();
    expect([..._BUNDLED_PACKAGES].sort()).toEqual(bundled);
  });
});

describe("imports in a bundle app", () => {
  it("never names a bundled package by its scoped name as an import source", async () => {
    const block = buildGuidelines({
      packages: STARTER,
      serverName: "zerotal",
      shape: await starter(),
    });

    for (const pkg of _BUNDLED_PACKAGES) {
      // The one sentence that warns against the scoped name may name it; nothing
      // may tell the agent to import from it.
      expect(block).not.toContain(`from \`${pkg}\``);
      expect(block).not.toContain(`from "${pkg}"`);
    }
    expect(block).toContain("`DB` from `zerotal/orm`");
    expect(block).toContain("`Auth` from `zerotal/auth`");
    expect(block).toContain("`Cache` from `zerotal/cache`");
    expect(block).toContain("`zerotal/media` owns uploads");
    // A package outside the bundle keeps its own name.
    expect(block).toContain("`@zerotal/notifications`, installed");
  });

  it("keeps the scoped names in an app without the bundle", () => {
    const block = buildGuidelines({
      packages: ["@zerotal/orm", "@zerotal/auth"],
      serverName: "zerotal",
    });
    expect(block).toContain("`DB` from `@zerotal/orm`");
    expect(block).toContain("`Auth` from `@zerotal/auth`");
  });

  it("writes the skills' code against the bundle too", async () => {
    const shape = await starter();
    const text = SKILLS.map((skill) => renderSkill(skill, shape)).join("\n");
    expect(text).not.toMatch(/from "@zerotal\/(orm|testing)"/);
    expect(text).toContain('from "zerotal/orm"');
  });
});

describe("notifications", () => {
  it("names `channels()`, the method a notification actually declares", async () => {
    const block = buildGuidelines({
      packages: STARTER,
      serverName: "zerotal",
      shape: await starter(),
    });
    const skills = SKILLS.map((skill) => renderSkill(skill, undefined)).join("\n");
    expect(block).toContain("`channels()`");
    expect(block).not.toContain("via()");
    expect(skills).not.toContain("via()");
  });
});

describe("routing", () => {
  it("lists `app/routes/` and not `routes/` or controllers in a file-routed starter", async () => {
    const block = buildGuidelines({
      packages: STARTER,
      serverName: "zerotal",
      shape: await starter(),
    });
    const grid = block.slice(
      block.indexOf("```text"),
      block.indexOf("```", block.indexOf("```text") + 3),
    );

    expect(grid).toContain("app/routes/");
    expect(grid).not.toMatch(/(^|\s)routes\//);
    expect(grid).not.toContain("app/controllers/");
    expect(block).toContain("Routes are files");
  });

  it("says both styles are in use when both directories hold files", async () => {
    const block = buildGuidelines({
      packages: STARTER,
      serverName: "zerotal",
      shape: await starter({ registered: true }),
    });
    expect(block).toContain("both routing styles");
  });

  it("names controllers in an app that registers routes to them", async () => {
    await write("routes/index.ts", "export {};");
    await write("app/controllers/HomeController.ts", "export {};");
    const block = buildGuidelines({
      packages: [],
      serverName: "zerotal",
      shape: await detectShape(root),
    });
    expect(block).toContain("app/controllers/");
    expect(block).toContain("Routes are registered in code in `routes/`, pointing at controllers");
    expect(block).not.toContain("app/routes/");
  });

  it("lists every style when the app's layout is not known", () => {
    const block = buildGuidelines({ packages: [], serverName: "zerotal" });
    for (const dir of ["app/routes/", "routes/", "app/controllers/"]) expect(block).toContain(dir);
  });

  it("does not say controllers return the page in an app that has none", async () => {
    const block = buildGuidelines({
      packages: STARTER,
      serverName: "zerotal",
      shape: await starter(),
    });
    expect(block).not.toContain("controllers return");
    expect(block).toContain("route handler returns `Inertia.render(...)`");
  });
});

describe("the queue", () => {
  it("says the provider is missing when this app does not register it", async () => {
    const block = buildGuidelines({
      packages: STARTER,
      serverName: "zerotal",
      shape: await starter(),
    });
    expect(block).toContain("`QueueProvider` from `zerotal/queue`");
    expect(block).toContain("does not register it yet");
    expect(block).toContain("`config/queue.ts`");
  });

  it("says nothing about setup once it is registered", async () => {
    const block = buildGuidelines({
      packages: STARTER,
      serverName: "zerotal",
      shape: await starter({ providers: "export default [AuthProvider, QueueProvider];" }),
    });
    const queue = block.split("\n").find((line) => line.startsWith("**Background work.**"));
    expect(queue).not.toContain("QueueProvider");
    expect(queue).toContain("`bun zt dev` runs a worker");
    // Each provider is judged on its own: the scheduler's is still missing here.
    const scheduling = block.split("\n").find((line) => line.startsWith("**Scheduling.**"));
    expect(scheduling).toContain("does not register it yet");
  });

  it("reads a provider list kept in `bootstrap/app.ts`", async () => {
    // The API template passes its providers to the app directly; it has no providers.ts.
    await write("bootstrap/app.ts", "createApp({ providers: [QueueProvider] });");
    const shape = await detectShape(root);
    expect(shape.providers).toEqual(["QueueProvider"]);
  });

  it("hedges rather than calling a provider missing when there is no bootstrap/", async () => {
    const shape = await detectShape(root);
    expect(shape.providers).toBeUndefined();
    const block = buildGuidelines({ packages: STARTER, serverName: "zerotal", shape });
    expect(block).not.toContain("does not register it yet");
    expect(block).toContain("It needs `QueueProvider` from `zerotal/queue`");
  });
});

describe("Flow", () => {
  it("does not claim every component is interactive", () => {
    const block = buildGuidelines({
      packages: ["zerotal", "@zerotal/flow"],
      serverName: "zerotal",
    });
    expect(block).not.toContain("Every component is an island");
    expect(block).toContain("`static interactive = false`");
  });
});
