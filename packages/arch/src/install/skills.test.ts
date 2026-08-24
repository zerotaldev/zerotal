/**
 * Skills: the depth the upfront block cannot afford.
 *
 * `guidelines.ts` is short because every prompt it lands in pays for its whole
 * length. That is a real constraint and it has a real cost — an agent gets a map
 * and no detail, and the detail is where the expensive mistakes live. A skill is
 * a file with a one-line description that costs nothing until an agent decides it
 * is relevant, so the procedure can be written out properly.
 *
 * What is tested here is the part that decides whether any of it works:
 *
 * 1. **The frontmatter parses.** A description carrying a colon or a comma is
 *    structure to unquoted YAML, and a skill whose frontmatter does not parse is
 *    not a degraded skill — it is an inert file that looks installed.
 * 2. **The paths are the ones agents read.** Same failure, quieter.
 * 3. **A file somebody edited is theirs.** Overriding what this ships has to be
 *    possible, and has to survive the next `arch:update`.
 * 4. **A skill reflects the project it was written for**, like the block does.
 */
import { describe, it, expect } from "bun:test";
import { SKILLS, SKILL_MARKER, selectSkills, renderSkill, skillPaths } from "./skills.ts";
import type { ProjectShape } from "./shape.ts";

const shape = (over: Partial<ProjectShape> = {}): ProjectShape => ({
  schemaSource: "migrations",
  routeTypes: true,
  hasTests: true,
  strict: { strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true },
  ...over,
});

/** The frontmatter block, parsed the way a harness would read it. */
function frontmatter(text: string): Record<string, string> {
  const end = text.indexOf("---", 3);
  const body = text.slice(3, end);
  const out: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    const key = line.slice(0, at).trim();
    const raw = line.slice(at + 1).trim();
    if (!key) continue;
    out[key] = raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
  }
  return out;
}

describe("every shipped skill", () => {
  for (const skill of SKILLS) {
    describe(skill.name, () => {
      const text = renderSkill(skill, shape());

      it("opens with frontmatter carrying a name and a description", () => {
        expect(text.startsWith("---\n")).toBe(true);

        const meta = frontmatter(text);
        expect(meta["name"]).toBe(skill.name);
        expect(meta["description"]).toBe(skill.description);
      });

      it("quotes the description, which contains YAML structure", () => {
        // Unquoted, everything after the first `: ` is a nested mapping and the
        // file stops parsing. Both descriptions here contain punctuation that
        // would do it.
        const line = text.split("\n").find((l) => l.startsWith("description:"))!;
        expect(line).toMatch(/^description: "/);
      });

      it("carries the marker that makes it this tool's to rewrite", () => {
        expect(text).toContain(SKILL_MARKER);
        // After the frontmatter — before it, the frontmatter no longer opens the
        // file and nothing parses.
        expect(text.indexOf(SKILL_MARKER)).toBeGreaterThan(text.indexOf("---", 3));
      });

      it("says something", () => {
        expect(skill.body(shape()).length).toBeGreaterThan(200);
      });
    });
  }
});

describe("selection", () => {
  it("keeps a skill out when its package is not installed", () => {
    const names = selectSkills([], shape()).map((s) => s.name);
    expect(names).not.toContain("zerotal-schema-changes");
  });

  it("includes it once the package is there", () => {
    const names = selectSkills(["@zerotal/orm"], shape()).map((s) => s.name);
    expect(names).toContain("zerotal-schema-changes");
  });

  it("drops a skill whose body comes out empty for this project", () => {
    // The escape hatch for guidance that does not apply everywhere: a body that
    // returns nothing is not installed at all, rather than installed blank.
    const empty = { name: "n", description: "d", body: () => "   " };
    expect(selectSkills([], shape(), [empty])).toEqual([]);
  });
});

describe("the schema skill reflects the project", () => {
  const render = (source: ProjectShape["schemaSource"]): string =>
    renderSkill(
      SKILLS.find((s) => s.name === "zerotal-schema-changes")!,
      shape({ schemaSource: source }),
    );

  it("states migrations own it when they do", () => {
    expect(render("migrations")).toContain("**Migrations own the schema in this app.**");
  });

  it("states the models own it when they do", () => {
    expect(render("models")).toContain("**The models own the schema in this app**");
  });

  it("refuses to pick a side when both are in play", () => {
    // Guessing here is how the guidance becomes confidently wrong — the failure
    // it exists to prevent.
    const text = render("both");
    expect(text).toContain("**Both are in play here**");
    expect(text).toContain("doctor");
  });

  it("still carries the trap that has nothing to do with configuration", () => {
    // A mixin's column needs a migration wherever migrations own the schema, and
    // that is the sentence the app that reported this needed.
    for (const source of ["migrations", "models", "both", "unknown"] as const) {
      expect(render(source), source).toContain("email_verified_at");
    }
  });
});

describe("where they are written", () => {
  it("always writes the cross-client path", () => {
    expect(skillPaths("x", [])).toEqual([".agents/skills/x/SKILL.md"]);
  });

  it("adds Claude Code's own path when that agent is present", () => {
    expect(skillPaths("x", ["Claude Code"])).toEqual([
      ".agents/skills/x/SKILL.md",
      ".claude/skills/x/SKILL.md",
    ]);
  });

  it("does not add it for an agent that reads the portable path", () => {
    expect(skillPaths("x", ["Cursor", "Codex"])).toEqual([".agents/skills/x/SKILL.md"]);
  });
});
