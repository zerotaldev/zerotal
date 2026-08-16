/**
 * `app_info` — what this app is, before an agent assumes.
 *
 * The version and maturity of every installed `@zerotal/*` package matter more
 * than they look. Zerotal ships source, so the installed version *is* the API,
 * and `maturity` is the package's own statement about how much of it is
 * promised. An agent that knows a package is `beta` writes different code from
 * one that assumes everything is settled.
 *
 * The provider list is the other half: half the silent failures in a Zerotal app
 * are a feature whose provider was never registered, and that is visible here
 * before it is visible anywhere else.
 */
import type { ArchTool, ToolOutcome } from "../mcp/types.ts";
import type { AppInfo } from "../probe/topics.ts";
import type { ToolContext } from "./context.ts";

export function appInfoTool(ctx: ToolContext): ArchTool {
  return {
    name: "app_info",
    title: "App info",
    description:
      "What this Zerotal app is: the Bun version, the environment it boots as, its configured " +
      "URL, every registered service provider, the WebSocket paths it serves, and the version " +
      "and maturity of every installed @zerotal package. Call it once at the start of a task — " +
      "the installed versions decide which APIs exist, and the provider list decides which " +
      "features are actually wired up.",
    inputSchema: { type: "object", additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        bun: { type: "string" },
        environment: {
          type: "string",
          description: "The boot mode: web, console, worker, test or repl.",
        },
        appEnv: { type: "string", description: "The deployment environment from config." },
        url: { type: "string" },
        providers: { type: "array", items: { type: "string" } },
        webSocketPaths: { type: "array", items: { type: "string" } },
        packages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              version: { type: "string" },
              maturity: { type: "string", enum: ["stable", "beta", "experimental"] },
            },
            required: ["name", "version"],
          },
        },
      },
      required: ["bun", "environment", "appEnv", "providers", "packages", "webSocketPaths"],
    },

    async run(_args, signal): Promise<ToolOutcome> {
      const result = await ctx.probe.run("app-info", signal);
      if (!result.ok) return { text: result.message, failed: true };

      const info = result.data as AppInfo;
      return { text: render(info), data: info };
    },
  };
}

function render(info: AppInfo): string {
  const lines: string[] = [
    `Bun ${info.bun} · boots as ${info.environment} · APP_ENV ${info.appEnv}`,
  ];
  if (info.url) lines.push(`URL: ${info.url}`);

  lines.push("", `Providers (${info.providers.length}):`, `  ${info.providers.join(", ")}`);

  if (info.webSocketPaths.length > 0) {
    lines.push("", `WebSocket paths: ${info.webSocketPaths.join(", ")}`);
  }

  lines.push("", `Installed packages (${info.packages.length}):`);
  for (const pkg of info.packages) {
    // Maturity is only worth the reader's attention when it is not `stable` —
    // everything else is the promise they already assume.
    const caveat = pkg.maturity && pkg.maturity !== "stable" ? `  [${pkg.maturity}]` : "";
    lines.push(`  ${pkg.name}@${pkg.version}${caveat}`);
  }

  return lines.join("\n");
}
