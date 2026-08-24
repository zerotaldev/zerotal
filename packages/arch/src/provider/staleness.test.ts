/**
 * Generated guidance goes stale silently, and stale guidance is worse than none.
 *
 * `AGENTS.md` used to describe the framework, which changed about as often as the
 * framework did. It now also describes *this project* — which packages are here,
 * who owns the schema, which strictness flags are on — and every one of those
 * moves without anyone thinking about the file. Add a migrations directory, turn
 * `synchronize` off, install a package: the file still reads as current and is
 * quietly describing the app you used to have.
 *
 * Nobody writes guidance and then remembers to regenerate it. Something has to
 * notice, and `doctor` is where the project already goes to be told what is
 * wrong with it.
 *
 * A warning, never a failure — a misleading instruction file does not stop the
 * application working, and `doctor` earns the right to gate a deploy by failing
 * only for things that would break one.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentsFileCheck } from "./ArchProvider.ts";
import { buildGuidelines } from "../install/guidelines.ts";
import { detectShape } from "../install/shape.ts";
import { fence } from "../install/markers.ts";
import { selectSkills, renderSkill, skillPaths } from "../install/skills.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zt-stale-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, contents, "utf8");
}

/** Write everything `arch:install` would write for this project, right now. */
async function writeCurrentFiles(serverName = "zerotal"): Promise<void> {
  await write(".mcp.json", JSON.stringify({ mcpServers: { [serverName]: {} } }));
  const shape = await detectShape(root);
  await write(
    "AGENTS.md",
    `# Agent instructions\n\n${fence(buildGuidelines({ packages: [], serverName, shape }))}\n`,
  );

  for (const skill of selectSkills([], shape)) {
    for (const path of skillPaths(skill.name, [])) {
      await write(path, renderSkill(skill, shape));
    }
  }
}

describe("the agent instructions check", () => {
  it("passes when the file matches the project", async () => {
    await writeCurrentFiles();

    const result = await agentsFileCheck(root);

    expect(result.status).toBe("ok");
  });

  it("notices a project whose setup has moved since the file was written", async () => {
    await writeCurrentFiles();

    // Exactly the drift that costs the most: the schema's owner changes, and the
    // file goes on saying what it said. Nothing about the app looks different.
    await write("config/database.ts", "export default { synchronize: false };");
    await write("database/migrations/0001_create_users.ts", "export {};");

    const result = await agentsFileCheck(root);

    expect(result.status).toBe("warn");
    expect(result.message).toContain("different project");
    expect(result.fix).toBe("bun zt arch:update");
  });

  it("says so when there is no file at all", async () => {
    const result = await agentsFileCheck(root);

    expect(result.status).toBe("warn");
    expect(result.fix).toBe("bun zt arch:install");
  });

  it("says so when the file exists but has no generated block", async () => {
    // Someone's own AGENTS.md, or a block deleted by a bad merge. Either way
    // nothing here describes the framework.
    await write("AGENTS.md", "# Agent instructions\n\nBe nice.\n");

    const result = await agentsFileCheck(root);

    expect(result.status).toBe("warn");
    expect(result.message).toContain("no generated block");
  });

  it("compares against the server name the project actually uses", async () => {
    // The block names the MCP server. Comparing against a guessed name would
    // report every project that renamed its server as permanently stale — a
    // check that cries wolf is a check that gets ignored.
    await writeCurrentFiles("my-app");

    expect((await agentsFileCheck(root)).status).toBe("ok");
  });

  it("reports a skill file that is missing", async () => {
    await writeCurrentFiles();
    // Deleted the way a bad merge or a stray clean deletes one: the file is gone
    // and nothing else about the project looks any different.
    await rm(join(root, ".agents", "skills", "zerotal-releases"), {
      recursive: true,
      force: true,
    });

    const result = await agentsFileCheck(root);

    expect(result.status).toBe("warn");
    expect(result.message).toContain("skill file");
    expect(result.message).toContain("zerotal-releases");
  });

  it("leaves a skill file somebody has taken over alone", async () => {
    await writeCurrentFiles();
    // No marker: this one is theirs now, and being out of date is their business.
    await write(
      ".agents/skills/zerotal-releases/SKILL.md",
      '---\nname: zerotal-releases\ndescription: "mine"\n---\n\nMy own instructions.\n',
    );

    const result = await agentsFileCheck(root);

    expect(result.message).not.toContain("zerotal-releases");
  });
});
