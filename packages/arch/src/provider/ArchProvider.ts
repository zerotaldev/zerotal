import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment, DoctorCheck } from "@zerotal/core";
import { SERVER_ENTRY_PATH } from "../install/mcpConfig.ts";

/**
 * Registers the agent-surface commands.
 *
 * Binds nothing. The MCP server is a separate process that never boots an
 * application — see `src/bin/mcp.ts` for why — so there is no manager to put in
 * the container and no request-time behaviour to add. What this provider is for
 * is the three commands, and the check that says whether the server has actually
 * been wired up.
 *
 * `console` only. Every command here is a developer tool, and a web process has
 * no reason to carry them.
 *
 * Register in `bootstrap/providers.ts`:
 *
 * ```typescript
 * import { ArchProvider } from "@zerotal/arch";
 *
 * Application.create()
 *   .register([DatabaseProvider, ArchProvider])
 * ```
 */
export class ArchProvider extends ServiceProvider {
  static override provides = [] as const;
  static override environments: AppEnvironment[] = ["console"];

  override async onBooted(): Promise<void> {
    const runner = this.app.container.tryMake("commands");
    if (!runner) return;

    runner.registerLazy(
      "arch:install",
      () => import("../install/ArchInstallCommand.ts").then((m) => m.ArchInstallCommand),
      ["arch:update"],
    );
    runner.registerLazy("arch:probe", () =>
      import("../probe/ArchProbeCommand.ts").then((m) => m.ArchProbeCommand),
    );
  }

  /**
   * One check: is the MCP server registered where an agent will find it?
   *
   * A project that installed this package and never ran `arch:install` has an
   * agent surface that exists and is not connected to anything — which looks
   * exactly like it working until someone notices no tool was ever called.
   */
  override doctorChecks(): DoctorCheck[] {
    return [
      {
        id: "arch-mcp-config",
        label: "Agent surface",
        run: async () => {
          const entry = Bun.file(`${process.cwd()}/${SERVER_ENTRY_PATH}`);
          if (!(await entry.exists())) {
            return {
              status: "warn" as const,
              message:
                "@zerotal/arch is registered but its server entry is missing from node_modules.",
              fix: "bun install",
            };
          }

          const config = Bun.file(`${process.cwd()}/.mcp.json`);
          if (!(await config.exists())) {
            return {
              status: "warn" as const,
              message:
                "No .mcp.json, so no agent is connected to this app's MCP server — the tools " +
                "exist but nothing can call them.",
              fix: "bun zt arch:install",
            };
          }

          try {
            const document = (await config.json()) as Record<string, unknown>;
            const servers = document["mcpServers"];
            const names =
              typeof servers === "object" && servers !== null ? Object.keys(servers) : [];
            return names.length > 0
              ? { status: "ok" as const, message: `.mcp.json registers ${names.join(", ")}` }
              : {
                  status: "warn" as const,
                  message: ".mcp.json declares no MCP servers.",
                  fix: "bun zt arch:install",
                };
          } catch {
            return {
              status: "warn" as const,
              message: ".mcp.json is not valid JSON, so no agent can read it.",
              fix: "Fix the JSON, then run bun zt arch:install.",
            };
          }
        },
      },
    ];
  }
}
