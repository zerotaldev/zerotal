/**
 * `baselines` — the numbers a change is not allowed to make worse, and the
 * commands that check them.
 *
 * Zerotal's repo keeps four ratchets — lint, casts, test typecheck, docs
 * coverage — each a committed JSON file recording today's debt. The rule is that
 * they only go down. That is a rule an agent can follow only if it can see the
 * numbers, which is what this returns.
 *
 * It reads and does not run. Executing a project's own scripts would make the
 * one tool in this set that can cause an effect, for a result the caller can
 * already get by running the command itself — so the commands are reported and
 * running them is left to the caller.
 *
 * A project with no baselines is not an error: most apps keep none. In that case
 * this reports the verification commands the project *does* have, which is the
 * question behind the question.
 */
import { join } from "node:path";
import type { ArchTool, ToolOutcome } from "../mcp/types.ts";
import type { ToolContext } from "./context.ts";

/** The four ratchets, with the command that checks each. */
const RATCHETS = [
  { name: "lint", file: "lint-baseline.json", command: "bun run lint:ci" },
  { name: "casts", file: "cast-baseline.json", command: "bun run cast:check" },
  {
    name: "typecheck:tests",
    file: "typecheck-tests-baseline.json",
    command: "bun run typecheck:tests",
  },
  {
    name: "docs-coverage",
    file: "docs-coverage-baseline.json",
    command: "bun run docs:coverage",
  },
] as const;

/** package.json scripts worth reporting as verification commands. */
const GATE_SCRIPTS = [
  "test",
  "typecheck",
  "typecheck:tests",
  "lint",
  "lint:ci",
  "lint:packages:ci",
  "format:check",
  "cast:check",
  "api:surface:check",
  "docs:coverage",
];

export interface BaselineReading {
  name: string;
  file: string;
  command: string;
  /** The recorded ceiling. */
  total: number;
  /** Per-package or per-file detail, when the baseline records it. */
  breakdown?: Record<string, number>;
  updatedAt?: string;
}

/**
 * The recorded total.
 *
 * Three of the four write a `total`; the cast baseline records only its
 * per-file map, so its total is the sum. Deriving it rather than demanding the
 * field keeps this working if a fifth ratchet lands in either shape.
 */
export function readTotal(document: Record<string, unknown>): number | undefined {
  const total = document["total"];
  if (typeof total === "number") return total;

  for (const key of ["files", "packages"]) {
    const map = document[key];
    if (typeof map === "object" && map !== null && !Array.isArray(map)) {
      let sum = 0;
      for (const value of Object.values(map as Record<string, unknown>)) {
        if (typeof value === "number") sum += value;
      }
      return sum;
    }
  }
  return undefined;
}

function readBreakdown(document: Record<string, unknown>): Record<string, number> | undefined {
  const map = document["packages"];
  if (typeof map !== "object" || map === null || Array.isArray(map)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
    if (typeof value === "number") out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

async function readBaselines(root: string): Promise<BaselineReading[]> {
  const readings: BaselineReading[] = [];

  for (const ratchet of RATCHETS) {
    const path = join(root, ratchet.file);
    if (!(await Bun.file(path).exists())) continue;
    try {
      const document = (await Bun.file(path).json()) as Record<string, unknown>;
      const total = readTotal(document);
      if (total === undefined) continue;
      const breakdown = readBreakdown(document);
      const updatedAt = document["updatedAt"];
      readings.push({
        name: ratchet.name,
        file: ratchet.file,
        command: ratchet.command,
        total,
        ...(breakdown !== undefined ? { breakdown } : {}),
        ...(typeof updatedAt === "string" ? { updatedAt } : {}),
      });
    } catch {
      /* an unreadable baseline is one row missing, not a failed tool */
    }
  }

  return readings;
}

async function readGateScripts(root: string): Promise<Array<{ name: string; command: string }>> {
  try {
    const manifest = (await Bun.file(join(root, "package.json")).json()) as Record<string, unknown>;
    const scripts = manifest["scripts"];
    if (typeof scripts !== "object" || scripts === null) return [];
    const declared = scripts as Record<string, unknown>;
    return GATE_SCRIPTS.filter((name) => typeof declared[name] === "string").map((name) => ({
      name,
      command: `bun run ${name}`,
    }));
  } catch {
    return [];
  }
}

export function baselinesTool(ctx: ToolContext): ArchTool {
  return {
    name: "baselines",
    title: "Baselines",
    description:
      "The quality ratchets this project records — lint warnings, type casts, test-typecheck " +
      "errors, documentation gaps — and the command that verifies each. The rule is that these " +
      "numbers only go down: a change may remove debt freely but must not add to it. Also lists " +
      "the project's own verification scripts. Read it before a change, and run the commands it " +
      "names after one.",
    inputSchema: { type: "object", additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        baselines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              file: { type: "string" },
              command: { type: "string" },
              total: { type: "number" },
              breakdown: { type: "object", additionalProperties: { type: "number" } },
              updatedAt: { type: "string" },
            },
            required: ["name", "file", "command", "total"],
          },
        },
        scripts: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, command: { type: "string" } },
            required: ["name", "command"],
          },
        },
      },
      required: ["baselines", "scripts"],
    },

    async run(): Promise<ToolOutcome> {
      const [baselines, scripts] = await Promise.all([
        readBaselines(ctx.root),
        readGateScripts(ctx.root),
      ]);
      const data = { baselines, scripts };

      const sections: string[] = [];

      if (baselines.length > 0) {
        const rows = baselines.map(
          (reading) =>
            `  ${reading.name.padEnd(18)}${String(reading.total).padStart(6)}   ${reading.command}`,
        );
        sections.push(`Ratchets — these numbers may go down, never up:\n\n${rows.join("\n")}`);
      } else {
        sections.push("This project records no baselines.");
      }

      if (scripts.length > 0) {
        sections.push(
          `Verification commands available here:\n${scripts.map((s) => `  ${s.command}`).join("\n")}`,
        );
      }

      return { text: sections.join("\n\n"), data };
    },
  };
}
