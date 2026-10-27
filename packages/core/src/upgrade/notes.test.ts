import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installedChangelogs, newestVersion, notesBetween, parseChangelog } from "./notes.ts";
import { UpgradeCommand } from "../command/builtin/UpgradeCommand.ts";

/**
 * An app on an old version could not ask "what did you fix for me since I last looked?" short of
 * reading every changelog in between. One review found three workarounds in one app that releases
 * had made unnecessary, among them an SMTP STARTTLS limitation fixed in 1.11.0 that the app's own
 * preflight still refused.
 */
const SAMPLE = `# Changelog

## [Unreleased]

### Fixed

- **Not released yet.** Must not appear.

## [1.12.0] — 2026-09-01

### Changed — **BREAKING**

- **\`old()\` is removed.** Use \`new()\`.

### Fixed

- **SMTP completes STARTTLS on port 587.** It timed out before.

  A second paragraph, still part of the entry.

## [1.11.0] — 2026-08-31

### Added

- **\`header()\` on a mail message.** Set any header.
- Plain entry with no bold lead.
`;

describe("parseChangelog", () => {
  const notes = parseChangelog(SAMPLE, "@zerotal/notifications");

  it("reads each released entry with its version, section and bold lead", () => {
    expect(notes.map((n) => [n.version, n.category, n.title])).toEqual([
      ["1.12.0", "BREAKING", "`old()` is removed."],
      ["1.12.0", "Fixed", "SMTP completes STARTTLS on port 587."],
      ["1.11.0", "Added", "`header()` on a mail message."],
      ["1.11.0", "Added", "Plain entry with no bold lead."],
    ]);
  });

  it("skips [Unreleased], which describes no version anybody can be on", () => {
    expect(notes.some((n) => n.text.includes("Not released yet"))).toBe(false);
  });

  it("keeps a multi-paragraph entry whole", () => {
    expect(notes[1]!.text).toContain("A second paragraph, still part of the entry.");
  });
});

describe("notesBetween", () => {
  const notes = parseChangelog(SAMPLE, "@zerotal/notifications");

  it("takes what shipped after from and up to to, breaking changes first", () => {
    expect(notesBetween(notes, "1.10.0", "1.12.0").map((n) => n.category)).toEqual([
      "BREAKING",
      "Fixed",
      "Added",
      "Added",
    ]);
    expect(notesBetween(notes, "1.11.0", "1.12.0").every((n) => n.version === "1.12.0")).toBe(true);
  });

  it("finds a workaround's subject anywhere in the entry, ignoring case", () => {
    expect(notesBetween(notes, "1.0.0", "1.12.0", "starttls").map((n) => n.title)).toEqual([
      "SMTP completes STARTTLS on port 587.",
    ]);
  });

  it("knows the newest version installed", () => {
    expect(newestVersion(notes)).toBe("1.12.0");
  });
});

describe("zt upgrade --notes in an app", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "zt-notes-"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { zerotal: "^1.9.0" } }),
    );
    // The real notifications changelog, as the installed package ships it.
    const pkg = join(root, "node_modules", "@zerotal", "notifications");
    await mkdir(pkg, { recursive: true });
    await copyFile(
      join(import.meta.dir, "..", "..", "..", "notifications", "CHANGELOG.md"),
      join(pkg, "CHANGELOG.md"),
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function upgrade(flags: Record<string, string | boolean>) {
    const lines: string[] = [];
    let raw = "";
    const errors: string[] = [];
    const command = new UpgradeCommand();
    command.args = {};
    command.flags = { path: root, from: "", to: "", grep: "", ...flags };
    command._writer = {
      write: (text: string) => {
        raw += text;
      },
      writeLine: (line: string) => lines.push(line),
      writeError: (line: string) => errors.push(line),
    };
    await command.run();
    return { out: lines.join("\n"), raw, errors: errors.join("\n") };
  }

  it("answers whether the STARTTLS workaround is still needed, from the declared version", async () => {
    const { out } = await upgrade({ notes: true, grep: "starttls" });

    expect(out).toContain("after 1.9.0");
    expect(out).toContain("@zerotal/notifications");
    expect(out.toLowerCase()).toContain("starttls");
  });

  it("prints JSON for tooling", async () => {
    const { raw } = await upgrade({ notes: true, json: true, grep: "starttls" });
    // Parsed as it is printed: no colour codes, nothing around it.
    const parsed = JSON.parse(raw) as Array<{ version: string; package: string }>;

    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]!.package).toBe("@zerotal/notifications");
  });

  it("says so when nothing matches", async () => {
    const { out } = await upgrade({ notes: true, grep: "no-such-thing-anywhere" });

    expect(out).toContain('No release notes mentioning "no-such-thing-anywhere"');
  });

  it("finds the changelogs only where they are installed", async () => {
    expect((await installedChangelogs(root)).map((c) => c.package)).toEqual([
      "@zerotal/notifications",
    ]);
  });

  it("finds a package hoisted to a workspace above the app, as module resolution would", async () => {
    const app = join(root, "apps", "web");
    await mkdir(join(app, "node_modules", "@zerotal", "core"), { recursive: true });
    await writeFile(join(app, "node_modules", "@zerotal", "core", "CHANGELOG.md"), SAMPLE);

    expect((await installedChangelogs(app)).map((c) => c.package)).toEqual([
      "@zerotal/core",
      "@zerotal/notifications",
    ]);
  });
});
