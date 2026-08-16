#!/usr/bin/env bun
/**
 * The MCP server, as a process.
 *
 * ## Why this is a bin and not a `zt` command
 *
 * The stdio binding says the server MUST NOT write anything to stdout that is
 * not an MCP message, and a stray line does not degrade the session — it
 * desynchronises the client's line parser and corrupts every frame after it.
 * Every `bun zt <cmd>` boots the application first, and a booted application
 * prints: dev banners, provider notices, warnings from packages that noticed
 * something. There is no way to hold that guarantee from inside a command whose
 * own boot has already happened.
 *
 * So this process never boots an app. It resolves nothing from the container,
 * registers no providers, and reads no config. The tools that need a booted app
 * spawn one — see `tools/_probe.ts` — which has the second, larger benefit: the
 * answer describes the code as it is now, not as it was when a long-lived server
 * started. The caller is an agent editing that code between calls.
 *
 * Run by `.mcp.json` as:
 *
 *   bun node_modules/@zerotal/arch/src/bin/mcp.ts
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "../mcp/server.ts";
import { serveStdio } from "../mcp/stdio.ts";
import { archTools } from "../tools/index.ts";
import { vendoredDocsDir } from "../tools/context.ts";
import { findApp, spawnProbe } from "../tools/_probe.ts";

/** This package's own version, for `serverInfo`. */
async function ownVersion(): Promise<string> {
  try {
    const manifest = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    const parsed = (await Bun.file(manifest).json()) as Record<string, unknown>;
    return typeof parsed["version"] === "string" ? parsed["version"] : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const cwd = process.cwd();
const app = await findApp(cwd);

// stderr, never stdout. The spec permits it and tells clients not to read it as
// failure, which makes it the only place a diagnostic can go.
if (app) {
  process.stderr.write(`[arch] serving ${app.root}\n`);
} else {
  process.stderr.write(
    `[arch] no Zerotal app found at or above ${cwd}. Tools that need a booted app will say so; ` +
      `docs search and API surface still work.\n`,
  );
}

const root = app?.root ?? cwd;

await serveStdio({
  server: new McpServer({
    identity: {
      name: "zerotal-arch",
      title: "Zerotal",
      version: await ownVersion(),
    },
    tools: archTools({
      root,
      docsDir: vendoredDocsDir(),
      probe: spawnProbe({ cwd: root }),
    }),
  }),
});
