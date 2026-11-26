import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { workflowFiles, workflowProblems } from "./workflows-check.ts";

const SHA = "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09";

function workflow(body: string): string {
  return `name: X\non:\n  pull_request:\npermissions:\n  contents: read\n${body}`;
}

describe("workflowProblems", () => {
  it("accepts an action pinned to a commit with its version in a comment", () => {
    const text = workflow(
      `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@${SHA} # v5.1.0\n`,
    );
    expect(workflowProblems("ci.yml", text)).toEqual([]);
  });

  it("refuses a tag, a branch, or a SHA without its version", () => {
    const text = workflow(
      `jobs:\n  a:\n    steps:\n` +
        `      - uses: actions/checkout@v5\n` +
        `      - uses: oven-sh/setup-bun@main\n` +
        `      - uses: actions/setup-node@${SHA}\n`,
    );
    expect(workflowProblems("ci.yml", text).map((p) => p.line)).toEqual([9, 10, 11]);
  });

  it("leaves a local action alone", () => {
    const text = workflow(`jobs:\n  a:\n    steps:\n      - uses: ./.github/actions/setup\n`);
    expect(workflowProblems("ci.yml", text)).toEqual([]);
  });

  it("refuses pull_request_target, but not a comment that names it", () => {
    const text = `name: X\non:\n  pull_request_target:\n# never pull_request_target\npermissions:\n  contents: read\njobs: {}\n`;
    const problems = workflowProblems("ci.yml", text);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.line).toBe(3);
  });

  it("allows id-token: write in the publish job of release.yml and nowhere else", () => {
    const job = (name: string) =>
      `  ${name}:\n    permissions:\n      id-token: write\n    steps: []\n`;
    expect(workflowProblems("release.yml", workflow(`jobs:\n${job("publish")}`))).toEqual([]);
    expect(workflowProblems("release.yml", workflow(`jobs:\n${job("verify")}`))).toHaveLength(1);
    expect(workflowProblems("ci.yml", workflow(`jobs:\n${job("publish")}`))).toHaveLength(1);
  });

  it("refuses id-token: write granted to the whole workflow", () => {
    const text = `name: X\non: push\npermissions:\n  id-token: write\njobs:\n  publish:\n    steps: []\n`;
    expect(workflowProblems("release.yml", text)[0]!.message).toContain("workflow level");
  });

  it("asks for top-level permissions", () => {
    const text = `name: X\non: push\njobs:\n  a:\n    steps: []\n`;
    expect(workflowProblems("ci.yml", text)[0]!.message).toContain("permissions");
  });
});

describe("this repository", () => {
  it("covers its own workflows and the starters', and they pass", () => {
    const root = join(import.meta.dir, "..");
    const files = workflowFiles(root);
    expect(files).toContain(".github/workflows/release.yml");
    expect(files.some((f) => f.startsWith("packages/create-zerotal/templates/"))).toBe(true);
    const problems = files.flatMap((f) => workflowProblems(f, readFileSync(join(root, f), "utf8")));
    expect(problems).toEqual([]);
  });
});
