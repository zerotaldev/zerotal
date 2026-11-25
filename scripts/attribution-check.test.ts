import { describe, expect, it } from "bun:test";
import { attributionLines, findAttribution } from "./attribution-check.ts";

describe("attributionLines", () => {
  it("finds a co-author trailer naming Claude, in any case", () => {
    expect(
      attributionLines("fix: a thing\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"),
    ).toEqual(["Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"]);
    expect(attributionLines("co-authored-by: claude <x@y.z>")).toHaveLength(1);
  });

  it("finds the anthropic noreply address under any name", () => {
    expect(attributionLines("Co-authored-by: Someone <noreply@anthropic.com>")).toHaveLength(1);
  });

  it("finds the generated-with footer and a session trailer", () => {
    expect(
      attributionLines("🤖 Generated with [Claude Code](https://claude.com/claude-code)"),
    ).toHaveLength(1);
    expect(attributionLines("Claude-Session: https://claude.ai/code/session_x")).toHaveLength(1);
  });

  it("leaves a human co-author and ordinary prose alone", () => {
    expect(attributionLines("Co-authored-by: Jane Doe <jane@example.com>")).toEqual([]);
    expect(attributionLines("Regenerated with `bun run arch:docs`.")).toEqual([]);
    expect(attributionLines("The docs mention Claude-style prompts.")).toEqual([]);
    expect(attributionLines('Fails on the "Generated with Claude Code" footer.')).toEqual([]);
  });
});

describe("findAttribution", () => {
  it("names the commit and the pull request field each marker is in", () => {
    const hits = findAttribution(
      [
        ["0123456789abcdef", "clean message"],
        ["fedcba9876543210", "fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>"],
      ],
      { title: "a title", body: "Summary\n\n🤖 Generated with [Claude Code](https://claude.com)" },
    );
    expect(hits.map((hit) => hit.where)).toEqual(["commit fedcba987", "pull request body"]);
  });
});
