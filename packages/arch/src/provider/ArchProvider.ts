import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment, DoctorCheck } from "@zerotal/core";
import type { ProjectShape } from "../install/shape.ts";
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
      {
        id: "arch-agents-current",
        label: "Agent instructions",
        run: async () => agentsFileCheck(process.cwd()),
      },
    ];
  }
}

/**
 * Is the generated block still true?
 *
 * It was a description of the framework, which changed about as often as the
 * framework did. It is now also a description of *this project* — which packages
 * are installed, who owns the schema, which strictness flags are on — and every
 * one of those moves without anyone thinking about `AGENTS.md`. Add a migration
 * directory, turn `synchronize` off, install a package, upgrade the framework:
 * the file still reads as current and is quietly describing the app you had.
 *
 * That is worse than having no file. Guidance nobody wrote is obviously absent;
 * guidance that is confidently out of date gets followed.
 *
 * A warning rather than a failure: a stale instruction file misleads a person or
 * an agent, and does not stop the application working. `doctor` earns the right
 * to gate a deploy by failing only for things that would break one.
 *
 * Takes its root rather than reading `process.cwd()`, so it is testable without
 * moving the process into a fixture.
 *
 * @internal
 */
export async function agentsFileCheck(
  root: string,
): Promise<{ status: "ok" | "warn"; message: string; fix?: string }> {
  const file = Bun.file(`${root}/AGENTS.md`);
  if (!(await file.exists())) {
    return {
      status: "warn",
      message:
        "No AGENTS.md, so an agent working here has no instructions and none of the " +
        "project-specific facts the MCP tools cannot infer.",
      fix: "bun zt arch:install",
    };
  }

  const [{ buildGuidelines }, { detectShape }, { installedPackages }, markers] = await Promise.all([
    import("../install/guidelines.ts"),
    import("../install/shape.ts"),
    import("../probe/topics.ts"),
    import("../install/markers.ts"),
  ]);

  const current = _blockOf(await file.text(), markers.BLOCK_START, markers.BLOCK_END);
  if (current === undefined) {
    return {
      status: "warn",
      message:
        "AGENTS.md has no generated block, so nothing here describes the framework or how " +
        "this app is set up.",
      fix: "bun zt arch:install",
    };
  }

  const packages = (await installedPackages(root)).map((pkg) => pkg.name);
  const shape = await detectShape(root);
  const expected = buildGuidelines({
    packages,
    serverName: await _serverName(root),
    shape,
  });

  if (current.trim() !== expected.trim()) {
    return {
      status: "warn",
      message:
        "AGENTS.md describes a different project than this one — its packages, its setup or " +
        "its framework version have moved since it was written.",
      fix: "bun zt arch:update",
    };
  }

  // Skills rot the same way and are easier to miss: nothing reads them until an
  // agent decides one is relevant, and by then it is being followed.
  const stale = await _staleSkills(root, packages, shape);
  if (stale.length > 0) {
    return {
      status: "warn",
      message: `AGENTS.md is current, but ${stale.length} skill file(s) are not: ${stale.join(", ")}.`,
      fix: "bun zt arch:update",
    };
  }

  return { status: "ok", message: "AGENTS.md and skills match this project" };
}

/** Skill files that are missing, or generated and no longer what they would be. */
async function _staleSkills(
  root: string,
  packages: string[],
  shape: ProjectShape,
): Promise<string[]> {
  const { selectSkills, renderSkill, skillPaths, SKILL_MARKER } =
    await import("../install/skills.ts");
  const { detectAgents } = await import("../install/detect.ts");
  const { agents } = await detectAgents(root);

  const stale: string[] = [];
  for (const skill of selectSkills(packages, shape)) {
    for (const path of skillPaths(skill.name, agents)) {
      const file = Bun.file(`${root}/${path}`);
      if (!(await file.exists())) {
        stale.push(path);
        continue;
      }
      const text = await file.text();
      // A file somebody took ownership of is theirs, current or not.
      if (!text.includes(SKILL_MARKER)) continue;
      if (text !== renderSkill(skill, shape)) stale.push(path);
    }
  }
  return stale;
}

/** The generated body, unfenced, or `undefined` when there is no block. */
function _blockOf(text: string, start: string, end: string): string | undefined {
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from === -1 || to === -1 || to < from) return undefined;
  return text.slice(from + start.length, to);
}

/**
 * The key the server is registered under, read back from `.mcp.json`.
 *
 * The block names it, so comparing against a guessed name would report every
 * project that renamed its server as permanently stale. Read rather than
 * `require`d, which would cache the first answer and miss a rename.
 */
async function _serverName(root: string): Promise<string> {
  try {
    const document = (await Bun.file(`${root}/.mcp.json`).json()) as {
      mcpServers?: Record<string, unknown>;
      servers?: Record<string, unknown>;
    };
    const names = Object.keys(document.mcpServers ?? document.servers ?? {});
    return names[0] ?? "zerotal";
  } catch {
    return "zerotal";
  }
}
