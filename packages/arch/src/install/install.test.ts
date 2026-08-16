import { describe, it, expect } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BLOCK_END, BLOCK_START, applyBlock, fence } from "./markers.ts";
import { applyMcpConfig, serverEntry } from "./mcpConfig.ts";
import { agentsPreamble, buildGuidelines, claudeShim } from "./guidelines.ts";
import { detectAgents } from "./detect.ts";
import type { McpTarget } from "./detect.ts";

const CLAUDE_TARGET: McpTarget = { path: ".mcp.json", key: "mcpServers", client: "Claude Code" };
const VSCODE_TARGET: McpTarget = { path: ".vscode/mcp.json", key: "servers", client: "VS Code" };

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), "zerotal-arch-"));
}

// ── Managed blocks ────────────────────────────────────────────────────────────

describe("applyBlock", () => {
  it("creates a file with the preamble above the block", () => {
    const outcome = applyBlock(undefined, "generated", "# Title\n\nSome prose.");
    expect(outcome.status).toBe("created");
    expect(outcome.status !== "conflict" && outcome.text).toBe(
      `# Title\n\nSome prose.\n\n${BLOCK_START}\ngenerated\n${BLOCK_END}\n`,
    );
  });

  it("appends to an existing file rather than displacing what is already there", () => {
    const outcome = applyBlock("# Ours\n\nHand-written.\n", "generated", "ignored preamble");
    expect(outcome.status).toBe("created");
    expect(outcome.status !== "conflict" && outcome.text).toStartWith("# Ours\n\nHand-written.");
    expect(outcome.status !== "conflict" && outcome.text).toContain(BLOCK_START);
    // The preamble is for new files only — an existing one has its own opening.
    expect(outcome.status !== "conflict" && outcome.text).not.toContain("ignored preamble");
  });

  it("replaces only the block, keeping prose on both sides", () => {
    const existing = `Above.\n\n${fence("old")}\n\nBelow.\n`;
    const outcome = applyBlock(existing, "new");
    expect(outcome.status).toBe("updated");
    const text = outcome.status !== "conflict" ? outcome.text : "";
    expect(text).toContain("Above.");
    expect(text).toContain("Below.");
    expect(text).toContain("new");
    expect(text).not.toContain("old");
  });

  it("is idempotent — the second run reports unchanged and rewrites nothing", () => {
    const first = applyBlock(undefined, "generated", "# Title");
    const text = first.status !== "conflict" ? first.text : "";
    const second = applyBlock(text, "generated", "# Title");
    expect(second.status).toBe("unchanged");
    expect(second.status !== "conflict" && second.text).toBe(text);
  });

  it("leaves a file with damaged markers completely alone", () => {
    // Guessing where a half-marked block ends is how a tool eats a paragraph
    // nobody has a copy of.
    for (const damaged of [
      `Above.\n${BLOCK_START}\nbody\n`,
      `Above.\nbody\n${BLOCK_END}\n`,
      `${BLOCK_END}\nbody\n${BLOCK_START}\n`,
    ]) {
      const outcome = applyBlock(damaged, "new");
      expect(outcome.status).toBe("conflict");
    }
  });

  it("treats a whitespace-only file as empty", () => {
    expect(applyBlock("   \n\n", "generated").status).toBe("created");
  });
});

// ── MCP config ────────────────────────────────────────────────────────────────

describe("applyMcpConfig", () => {
  it("writes a config from nothing", () => {
    const outcome = applyMcpConfig(undefined, "zerotal", CLAUDE_TARGET);
    expect(outcome.status).toBe("created");
    const parsed = JSON.parse(outcome.status !== "conflict" ? outcome.text : "{}") as {
      mcpServers: Record<string, unknown>;
    };
    expect(parsed.mcpServers["zerotal"]).toEqual(serverEntry());
  });

  it("keeps every other server and every unrelated key", () => {
    const existing = JSON.stringify(
      {
        $schema: "https://example.com/schema.json",
        mcpServers: { other: { command: "node", args: ["other.js"] } },
        somethingElse: { we: "do not know about this" },
      },
      null,
      2,
    );

    const outcome = applyMcpConfig(existing, "zerotal", CLAUDE_TARGET);
    expect(outcome.status).toBe("updated");
    const parsed = JSON.parse(outcome.status !== "conflict" ? outcome.text : "{}") as {
      $schema: string;
      mcpServers: Record<string, unknown>;
      somethingElse: unknown;
    };
    expect(parsed.mcpServers["other"]).toEqual({ command: "node", args: ["other.js"] });
    expect(parsed.somethingElse).toEqual({ we: "do not know about this" });
    expect(parsed.$schema).toBe("https://example.com/schema.json");
  });

  it("uses the container key the client expects", () => {
    // VS Code reads `servers`; writing `mcpServers` there produces a file that
    // parses cleanly and does nothing.
    const outcome = applyMcpConfig(undefined, "zerotal", VSCODE_TARGET);
    const parsed = JSON.parse(outcome.status !== "conflict" ? outcome.text : "{}") as Record<
      string,
      unknown
    >;
    expect(parsed["servers"]).toBeDefined();
    expect(parsed["mcpServers"]).toBeUndefined();
  });

  it("is idempotent", () => {
    const first = applyMcpConfig(undefined, "zerotal", CLAUDE_TARGET);
    const text = first.status !== "conflict" ? first.text : "";
    expect(applyMcpConfig(text, "zerotal", CLAUDE_TARGET).status).toBe("unchanged");
  });

  it("refuses to overwrite a file it cannot parse", () => {
    const outcome = applyMcpConfig("{ not json", "zerotal", CLAUDE_TARGET);
    expect(outcome.status).toBe("conflict");
    expect(outcome.status === "conflict" && outcome.reason).toContain("left untouched");
  });

  it("refuses a JSON document that is not an object", () => {
    expect(applyMcpConfig("[1,2,3]", "zerotal", CLAUDE_TARGET).status).toBe("conflict");
  });

  it("runs the server on bun, from the installed package", () => {
    const entry = serverEntry() as { command: string; args: string[] };
    expect(entry.command).toBe("bun");
    expect(entry.args[0]).toBe("node_modules/@zerotal/arch/src/bin/mcp.ts");
  });
});

// ── Detection ─────────────────────────────────────────────────────────────────

describe("detectAgents", () => {
  it("always offers .mcp.json, even in a bare project", async () => {
    const dir = await scratch();
    try {
      const detected = await detectAgents(dir);
      expect(detected.agents).toEqual([]);
      expect(detected.targets.map((target) => target.path)).toEqual([".mcp.json"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("adds a target per agent it finds, with the right key", async () => {
    const dir = await scratch();
    try {
      await mkdir(join(dir, ".cursor"));
      await mkdir(join(dir, ".vscode"));
      const detected = await detectAgents(dir);

      expect(detected.agents).toContain("Cursor");
      expect(detected.agents).toContain("VS Code / Copilot");
      const byPath = new Map(detected.targets.map((target) => [target.path, target]));
      expect(byPath.get(".cursor/mcp.json")?.key).toBe("mcpServers");
      expect(byPath.get(".vscode/mcp.json")?.key).toBe("servers");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detects agents that have instructions but no MCP file of their own", async () => {
    const dir = await scratch();
    try {
      await mkdir(join(dir, ".github"), { recursive: true });
      await Bun.write(join(dir, ".github/copilot-instructions.md"), "# hi\n");
      const detected = await detectAgents(dir);
      expect(detected.agents).toContain("GitHub Copilot");
      expect(detected.targets).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── Guidelines ────────────────────────────────────────────────────────────────

describe("buildGuidelines", () => {
  const base = { packages: ["@zerotal/core"], serverName: "zerotal" };

  it("names every tool, so an agent knows what it may call", () => {
    const text = buildGuidelines(base);
    for (const tool of [
      "app_info",
      "api_surface",
      "search_docs",
      "routes",
      "schema",
      "logs",
      "last_error",
      "baselines",
      "doctor",
    ]) {
      expect(text).toContain(tool);
    }
  });

  it("uses the configured server name", () => {
    expect(buildGuidelines({ ...base, serverName: "zt-arch" })).toContain("`zt-arch` MCP tools");
  });

  it("only mentions packages the project actually installed", () => {
    const withoutAdmin = buildGuidelines(base);
    expect(withoutAdmin).not.toContain("app/admin/");

    const withAdmin = buildGuidelines({ ...base, packages: [...base.packages, "@zerotal/admin"] });
    expect(withAdmin).toContain("app/admin/");
  });

  it("teaches the import rule that actually applies", () => {
    const text = buildGuidelines(base);
    expect(text).toContain('import type { HttpContext } from "zerotal";');
    expect(text).toContain('import { DB } from "@zerotal/orm";');
  });

  it("collapses to no blank-line runs, so it costs what it looks like it costs", () => {
    expect(buildGuidelines({ ...base, packages: ["@zerotal/core", "@zerotal/orm"] })).not.toContain(
      "\n\n\n",
    );
  });

  it("ends with the rule the whole package exists for", () => {
    expect(buildGuidelines(base)).toContain("Finish with `doctor`");
  });
});

describe("claudeShim", () => {
  it("imports AGENTS.md on its first line rather than copying it", () => {
    // Claude Code does not read AGENTS.md natively; two files of guidance that
    // start identical do not stay that way.
    expect(claudeShim().split("\n")[0]).toBe("@AGENTS.md");
  });
});

describe("agentsPreamble", () => {
  it("tells the reader which part is theirs", () => {
    expect(agentsPreamble()).toContain("preserved");
    expect(agentsPreamble()).toContain("arch:update");
  });
});

// ── The two of them together ──────────────────────────────────────────────────

describe("a second install", () => {
  it("preserves prose a developer added outside the block", async () => {
    const dir = await scratch();
    try {
      const path = join(dir, "AGENTS.md");
      const first = applyBlock(
        undefined,
        buildGuidelines({ packages: [], serverName: "zerotal" }),
        agentsPreamble(),
      );
      await Bun.write(path, first.status !== "conflict" ? first.text : "");

      const edited =
        (await Bun.file(path).text()) +
        "\n## House rules\n\nAlways run the integration suite before merging.\n";
      await Bun.write(path, edited);

      // The upgrade: same file, different generated content.
      const second = applyBlock(
        await Bun.file(path).text(),
        buildGuidelines({ packages: ["@zerotal/orm"], serverName: "zerotal" }),
      );
      expect(second.status).toBe("updated");
      const text = second.status !== "conflict" ? second.text : "";

      expect(text).toContain("Always run the integration suite before merging.");
      expect(text).toContain("app/models/");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
