import { describe, it, expect } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { archTools } from "./index.ts";
import { findSurfaceFile, normalisePackageName, parseSurface } from "./apiSurface.ts";
import { parsePage, search, terms } from "./searchDocs.ts";
import { readTotal } from "./baselines.ts";
import { readTail } from "./logs.ts";
import { extractPayload, findApp } from "./_probe.ts";
import { PROBE_SENTINEL } from "../probe/sentinel.ts";
import type { ProbeResult, ProbeRunner } from "./_probe.ts";
import type { ArchTool, ToolOutcome } from "../mcp/types.ts";
import type { ProbeTopic } from "../probe/topics.ts";
import type { ToolContext } from "./context.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = resolve(here, "..", "__fixtures__", "project");
const FIXTURE_DOCS = resolve(here, "..", "__fixtures__", "docs");

// ── Harness ───────────────────────────────────────────────────────────────────

/** A probe that answers from a table instead of booting anything. */
function stubProbe(answers: Partial<Record<ProbeTopic, unknown>>, fail?: string): ProbeRunner {
  return {
    async run(topic): Promise<ProbeResult> {
      if (fail !== undefined) return { ok: false, message: fail };
      const data = answers[topic];
      return data === undefined
        ? { ok: false, message: `no stub for ${topic}` }
        : { ok: true, data };
    },
  };
}

function context(probe: ProbeRunner = stubProbe({})): ToolContext {
  return { root: FIXTURE_ROOT, docsDir: FIXTURE_DOCS, probe };
}

function toolNamed(name: string, ctx: ToolContext): ArchTool {
  const found = archTools(ctx).find((tool) => tool.name === name);
  if (!found) throw new Error(`no tool named ${name}`);
  return found;
}

const call = (tool: ArchTool, args: Record<string, unknown> = {}): Promise<ToolOutcome> =>
  tool.run(args, new AbortController().signal);

// ── The registry itself ───────────────────────────────────────────────────────

describe("archTools", () => {
  it("exposes the nine tools, and every one declares both schemas", () => {
    const tools = archTools(context());
    expect(tools.map((tool) => tool.name)).toEqual([
      "app_info",
      "api_surface",
      "search_docs",
      "routes",
      "schema",
      "logs",
      "last_error",
      "baselines",
      "doctor",
    ]);

    for (const tool of tools) {
      expect(tool.inputSchema["type"]).toBe("object");
      expect(tool.outputSchema["type"]).toBe("object");
      // The description is what decides whether a model ever calls the tool.
      expect(tool.description.length).toBeGreaterThan(80);
    }
  });

  it("uses names MCP allows", () => {
    for (const tool of archTools(context())) {
      expect(tool.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
    }
  });
});

// ── api_surface ───────────────────────────────────────────────────────────────

describe("parseSurface", () => {
  const markdown = Bun.file(`${FIXTURE_ROOT}/packages/demo/api-surface.md`);

  it("keeps a class body together instead of splitting on blank lines", async () => {
    const entries = parseSurface(await markdown.text());
    const manager = entries.find((entry) => entry.name === "DemoManager");
    expect(manager?.kind).toBe("class");
    expect(manager?.subpath).toBe(".");
    expect(manager?.signature).toContain("static readonly version: string");
    expect(manager?.signature).toContain("resolve(key: string): string | undefined");
  });

  it("attributes each export to the subpath it is exported from", async () => {
    const entries = parseSurface(await markdown.text());
    expect(entries.find((entry) => entry.name === "DemoClearCommand")?.subpath).toBe("./commands");
    expect(entries.find((entry) => entry.name === "demoHelper")?.subpath).toBe(".");
  });

  it("reads every kind it is given", async () => {
    const entries = parseSurface(await markdown.text());
    expect(entries.map((entry) => entry.kind).sort()).toEqual([
      "class",
      "class",
      "function",
      "interface",
    ]);
  });
});

describe("normalisePackageName", () => {
  it("accepts a bare name, a scoped name, and the meta package", () => {
    expect(normalisePackageName("core")).toEqual({ scoped: "@zerotal/core", dir: "core" });
    expect(normalisePackageName("@zerotal/core")).toEqual({ scoped: "@zerotal/core", dir: "core" });
    expect(normalisePackageName("zerotal")).toEqual({ scoped: "zerotal", dir: "zerotal" });
  });
});

describe("api_surface", () => {
  it("finds a workspace snapshot when there is no install to read", async () => {
    const found = await findSurfaceFile(FIXTURE_ROOT, "demo");
    expect(found?.scoped).toBe("@zerotal/demo");
  });

  it("returns every export, grouped by import path", async () => {
    const outcome = await call(toolNamed("api_surface", context()), { package: "demo" });
    expect(outcome.failed).toBeUndefined();
    expect(outcome.text).toContain('import from "@zerotal/demo"');
    expect(outcome.text).toContain('import from "@zerotal/demo/commands"');
    expect(outcome.data).toMatchObject({ package: "@zerotal/demo", total: 4, matched: 4 });
  });

  it("narrows to a symbol, case-insensitively", async () => {
    const outcome = await call(toolNamed("api_surface", context()), {
      package: "demo",
      symbol: "demomanager",
    });
    expect(outcome.data).toMatchObject({ matched: 1 });
    expect(outcome.text).toContain("DemoManager");
    expect(outcome.text).not.toContain("DemoClearCommand");
  });

  it("says which packages it does have when asked for one it does not", async () => {
    const outcome = await call(toolNamed("api_surface", context()), { package: "nope" });
    expect(outcome.failed).toBe(true);
    expect(outcome.text).toContain("@zerotal/demo");
  });

  it("reports an empty symbol filter as a match of nothing, not a failure", async () => {
    const outcome = await call(toolNamed("api_surface", context()), {
      package: "demo",
      symbol: "Nonexistent",
    });
    expect(outcome.failed).toBeUndefined();
    expect(outcome.data).toMatchObject({ matched: 0 });
  });
});

// ── search_docs ───────────────────────────────────────────────────────────────

describe("parsePage", () => {
  it("reads frontmatter and derives the docs-site slug", async () => {
    const page = parsePage("orm/casts.md", await Bun.file(`${FIXTURE_DOCS}/orm/casts.md`).text());
    expect(page.title).toBe("Casts & Mutators");
    expect(page.slug).toBe("/docs/orm/casts");
    expect(page.description).toContain("raw database values");
  });

  it("splits a page into its headed sections", async () => {
    const page = parsePage("routing.md", await Bun.file(`${FIXTURE_DOCS}/routing.md`).text());
    expect(page.sections.map((section) => section.heading)).toContain("Named routes");
    expect(page.sections.map((section) => section.heading)).toContain("Route model binding");
  });

  it("survives a page with no frontmatter", () => {
    const page = parsePage("bare.md", "# Bare\n\nJust text.");
    expect(page.title).toBe("bare");
    expect(page.description).toBe("");
  });
});

describe("terms", () => {
  it("drops one-character noise and de-duplicates", () => {
    expect(terms("Route model binding a route")).toEqual(["route", "model", "binding"]);
  });
});

describe("search_docs", () => {
  it("ranks a title match above a body mention", async () => {
    const pages = [
      parsePage("routing.md", await Bun.file(`${FIXTURE_DOCS}/routing.md`).text()),
      parsePage("orm/casts.md", await Bun.file(`${FIXTURE_DOCS}/orm/casts.md`).text()),
    ];
    const hits = search(pages, "routing", 5);
    expect(hits[0]?.title).toBe("Routing");
  });

  it("returns the matching section rather than the whole page", async () => {
    const outcome = await call(toolNamed("search_docs", context()), { query: "model binding" });
    expect(outcome.text).toContain("Route model binding");
    expect(outcome.text).toContain("/docs/routing");
    expect(outcome.data).toMatchObject({ query: "model binding" });
  });

  it("reports a miss as an answer, not a failure", async () => {
    const outcome = await call(toolNamed("search_docs", context()), {
      query: "quantum tunnelling",
    });
    expect(outcome.failed).toBeUndefined();
    expect(outcome.data).toMatchObject({ total: 0 });
  });

  it("fails when the corpus is missing, and says why", async () => {
    const outcome = await call(
      toolNamed("search_docs", { ...context(), docsDir: `${FIXTURE_DOCS}/nowhere` }),
      { query: "routing" },
    );
    expect(outcome.failed).toBe(true);
    expect(outcome.text).toContain("@zerotal/arch");
  });

  it("requires a query", async () => {
    expect((await call(toolNamed("search_docs", context()), { query: "  " })).failed).toBe(true);
  });

  it("clamps the limit", async () => {
    const outcome = await call(toolNamed("search_docs", context()), { query: "route", limit: 900 });
    const data = outcome.data as { results: unknown[] };
    expect(data.results.length).toBeLessThanOrEqual(20);
  });
});

// ── logs / last_error ─────────────────────────────────────────────────────────

describe("readTail", () => {
  it("skips lines that are not JSON objects with a message", async () => {
    const entries = await readTail(`${FIXTURE_ROOT}/storage/logs/2026-08-15.log`);
    expect(entries).toHaveLength(4);
    expect(entries.map((entry) => entry.level)).toEqual(["info", "warn", "error", "debug"]);
  });
});

describe("logs", () => {
  it("treats `level` as a floor, not an equality", async () => {
    const outcome = await call(toolNamed("logs", context()), { level: "warn" });
    const data = outcome.data as { entries: Array<{ level: string }> };
    expect(data.entries.every((entry) => entry.level !== "info")).toBe(true);
    expect(data.entries.some((entry) => entry.level === "error")).toBe(true);
    expect(data.entries.some((entry) => entry.level === "warn")).toBe(true);
  });

  it("filters by message", async () => {
    const outcome = await call(toolNamed("logs", context()), { contains: "queue worker" });
    expect(outcome.data).toMatchObject({ total: 1 });
    expect(outcome.text).toContain("Unhandled rejection");
  });

  it("renders structured context beside the message", async () => {
    const outcome = await call(toolNamed("logs", context()), { contains: "queue worker" });
    expect(outcome.text).toContain('"job":"SendInvoice"');
  });

  it("reads across day-files to fill the limit", async () => {
    const outcome = await call(toolNamed("logs", context()), { limit: 7 });
    const data = outcome.data as { entries: Array<{ timestamp: string }> };
    expect(data.entries.length).toBeGreaterThan(4);
    // Oldest first, so a reader follows the story forwards.
    expect(data.entries[0]!.timestamp < data.entries[data.entries.length - 1]!.timestamp).toBe(
      true,
    );
  });

  it("fails with an explanation when there is no trail", async () => {
    const outcome = await call(toolNamed("logs", { ...context(), root: FIXTURE_DOCS }));
    expect(outcome.failed).toBe(true);
    expect(outcome.text).toContain("config/logging.ts");
  });
});

describe("last_error", () => {
  it("returns the newest error, not the newest entry", async () => {
    const outcome = await call(toolNamed("last_error", context()));
    expect(outcome.text).toContain("Unhandled rejection in queue worker");
    expect(outcome.data).toMatchObject({ found: true });
  });
});

// ── baselines ─────────────────────────────────────────────────────────────────

describe("readTotal", () => {
  it("prefers a recorded total", () => {
    expect(readTotal({ total: 106, files: { a: 1 } })).toBe(106);
  });

  it("sums the per-file map when there is no total", () => {
    expect(readTotal({ files: { a: 3, b: 4 } })).toBe(7);
  });

  it("returns undefined when there is neither", () => {
    expect(readTotal({ updatedAt: "now" })).toBeUndefined();
  });
});

describe("baselines", () => {
  it("reports each ratchet with the command that checks it", async () => {
    const outcome = await call(toolNamed("baselines", context()));
    const data = outcome.data as { baselines: Array<{ name: string; total: number }> };
    expect(data.baselines.map((b) => b.name)).toEqual(["lint", "casts"]);
    expect(data.baselines.find((b) => b.name === "casts")?.total).toBe(7);
    expect(outcome.text).toContain("bun run cast:check");
  });

  it("lists the project's own verification scripts", async () => {
    const outcome = await call(toolNamed("baselines", context()));
    const data = outcome.data as { scripts: Array<{ name: string }> };
    expect(data.scripts.map((s) => s.name).sort()).toEqual(["lint:ci", "test", "typecheck"]);
  });

  it("says so plainly in a project that keeps none", async () => {
    const outcome = await call(toolNamed("baselines", { ...context(), root: FIXTURE_DOCS }));
    expect(outcome.text).toContain("records no baselines");
  });
});

// ── The probe-backed tools ────────────────────────────────────────────────────

describe("probe-backed tools", () => {
  const doctorData = {
    findings: [
      { id: "app-key", label: "APP_KEY", status: "ok", message: "set and strong" },
      {
        id: "cors-wildcard",
        label: "CORS",
        status: "fail",
        message: 'origin is "*"',
        fix: "Set app.cors.origin in config/app.ts.",
      },
    ],
    counts: { ok: 1, warn: 0, fail: 1, total: 2 },
    healthy: false,
  };

  const routeData = {
    total: 2,
    routes: [
      { method: "GET", path: "/", controller: "HomeController", action: "index", middleware: [] },
      {
        method: "POST",
        path: "/posts",
        controller: "PostController",
        action: "store",
        name: "posts.store",
        middleware: ["AuthMiddleware"],
      },
    ],
  };

  const schemaData = {
    total: 1,
    models: [
      {
        table: "users",
        primaryKey: "id",
        timestamps: true,
        softDeletes: false,
        columns: [
          {
            name: "id",
            type: "number",
            nullable: false,
            primary: true,
            unique: false,
            indexed: false,
          },
          {
            name: "email",
            type: "string",
            nullable: false,
            primary: false,
            unique: true,
            indexed: false,
          },
        ],
      },
    ],
  };

  const appData = {
    bun: "1.3.14",
    environment: "console",
    appEnv: "local",
    url: "http://localhost:3000",
    providers: ["DatabaseProvider"],
    packages: [
      { name: "@zerotal/core", version: "1.7.0", maturity: "stable" },
      { name: "@zerotal/arch", version: "1.7.0", maturity: "beta" },
    ],
    webSocketPaths: ["/__flow/ws"],
  };

  const ctx = context(
    stubProbe({ doctor: doctorData, routes: routeData, schema: schemaData, "app-info": appData }),
  );

  it("doctor puts the fix beside the finding and does not call itself an error", async () => {
    const outcome = await call(toolNamed("doctor", ctx));
    // The doctor ran. Its findings are the answer, so `isError` stays clear —
    // that flag means "I could not look", not "your app has problems".
    expect(outcome.failed).toBeUndefined();
    expect(outcome.text).toContain("✗ CORS");
    expect(outcome.text).toContain("fix: Set app.cors.origin");
    expect(outcome.text).toContain("1 FAILING");
  });

  it("routes renders an aligned table and filters", async () => {
    const all = await call(toolNamed("routes", ctx));
    expect(all.text).toContain("posts.store");
    expect(all.data).toMatchObject({ total: 2, registered: 2 });

    const named = await call(toolNamed("routes", ctx), { named: true });
    expect(named.data).toMatchObject({ total: 1, registered: 2 });

    const posted = await call(toolNamed("routes", ctx), { method: "post" });
    expect(posted.data).toMatchObject({ total: 1 });
  });

  it("schema renders columns with their flags", async () => {
    const outcome = await call(toolNamed("schema", ctx));
    expect(outcome.text).toContain("users  [primary key: id, timestamps]");
    expect(outcome.text).toContain("email: string  (not null, unique)");
  });

  it("app_info flags a package that is not stable and stays quiet about ones that are", async () => {
    const outcome = await call(toolNamed("app_info", ctx));
    expect(outcome.text).toContain("@zerotal/arch@1.7.0  [beta]");
    expect(outcome.text).toContain("@zerotal/core@1.7.0\n");
  });

  it("every probe-backed tool reports a probe failure as a tool error", async () => {
    const broken = context(
      stubProbe({}, "the app did not boot: SyntaxError in app/models/User.ts"),
    );
    for (const name of ["doctor", "routes", "schema", "app_info"]) {
      const outcome = await call(toolNamed(name, broken));
      expect(outcome.failed).toBe(true);
      expect(outcome.text).toContain("SyntaxError");
    }
  });
});

// ── The subprocess boundary ───────────────────────────────────────────────────

describe("extractPayload", () => {
  it("ignores everything the app printed before the marker", () => {
    const stdout = `Zerotal dev server\n\x1b[32mBooted\x1b[0m\n${PROBE_SENTINEL}\n{"healthy":true}\n`;
    expect(extractPayload(stdout)).toEqual({ ok: true, data: { healthy: true } });
  });

  it("takes the last marker, so a log line quoting one cannot win", () => {
    const stdout = `${PROBE_SENTINEL}\n{"stale":true}\nsomething else\n${PROBE_SENTINEL}\n{"stale":false}\n`;
    expect(extractPayload(stdout)).toEqual({ ok: true, data: { stale: false } });
  });

  it("reports a missing marker", () => {
    const result = extractPayload("boot failed\n");
    expect(result.ok).toBe(false);
  });

  it("reports a marker with nothing after it", () => {
    expect(extractPayload(`${PROBE_SENTINEL}\n`).ok).toBe(false);
  });

  it("reports unparseable JSON rather than throwing", () => {
    const result = extractPayload(`${PROBE_SENTINEL}\n{oops\n`);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("not valid JSON");
  });
});

describe("findApp", () => {
  it("returns nothing for a directory with no zt entry point", async () => {
    expect(await findApp(FIXTURE_ROOT)).toBeUndefined();
  });
});

// ── Workspace layouts ─────────────────────────────────────────────────────────

/**
 * `node_modules/@zerotal/*` is a symlink in every workspace — this monorepo,
 * `bun link`, any app developed against a checkout — and `Bun.Glob` will not
 * descend into one, `followSymlinks` or not.
 *
 * That is not a corner case: it is how a framework contributor's own app is laid
 * out, and it made `installedPackages()` return nothing for `apps/docs`, which
 * has seventeen. `app_info` reported an empty package list and `arch:install`
 * wrote generic guidance with none of the per-package sections that are the
 * whole reason it is composed rather than canned.
 *
 * The fixture builds the symlink for real, because a fixture of ordinary
 * directories is precisely what failed to catch this.
 */
describe("a workspace's symlinked node_modules", () => {
  it("finds packages a glob would walk straight past", async () => {
    const { mkdtemp, mkdir, symlink, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = await mkdtemp(join(tmpdir(), "zerotal-workspace-"));
    try {
      // A real package directory, outside node_modules…
      const real = join(dir, "packages", "orm");
      await mkdir(real, { recursive: true });
      await writeFile(
        join(real, "package.json"),
        JSON.stringify({ name: "@zerotal/orm", version: "1.7.0", maturity: "stable" }),
      );

      // …reached through a symlink, exactly as `bun install` lays it out.
      await mkdir(join(dir, "node_modules", "@zerotal"), { recursive: true });
      try {
        await symlink(real, join(dir, "node_modules", "@zerotal", "orm"), "junction");
      } catch {
        return; // no permission to create links on this machine — nothing to assert
      }

      const { installedPackages } = await import("../probe/topics.ts");
      const found = await installedPackages(dir);
      expect(found.map((p) => p.name)).toEqual(["@zerotal/orm"]);
      expect(found[0]?.maturity).toBe("stable");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
