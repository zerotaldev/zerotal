/**
 * `doctor` — the tool an agent is meant to finish a task with.
 *
 * `zt doctor` runs every static check the framework and the app's providers
 * contribute, and each finding carries the edit or command that resolves it.
 * That is the whole reason it is worth exposing: "looks fine to me" is not a
 * result an agent can act on, and this is.
 *
 * A run that finds failures is still a *successful* tool call — the findings are
 * the answer. `isError` is reserved for the case where the doctor could not be
 * run at all, so an agent can tell "your app has three problems" apart from
 * "I could not look".
 */
import type { ArchTool, ToolOutcome } from "../mcp/types.ts";
import type { DoctorReport } from "../probe/topics.ts";
import type { ToolContext } from "./context.ts";

const MARK = { ok: "✓", warn: "!", fail: "✗" } as const;

export function doctorTool(ctx: ToolContext): ArchTool {
  return {
    name: "doctor",
    title: "Doctor",
    description:
      "Run every health check against this app and return the findings with the fix for each. " +
      "Covers the silent misconfigurations — an unregistered provider, a schema with two sources " +
      "of truth, allowed origins that no browser will match, a missing APP_KEY — plus whatever " +
      "the installed packages contribute. Run this as the last step of any task that changed " +
      "the app, and treat a `fail` as work that is not finished.",
    inputSchema: { type: "object", additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        healthy: {
          type: "boolean",
          description: "True when nothing failed. Warnings do not clear it.",
        },
        counts: {
          type: "object",
          properties: {
            ok: { type: "number" },
            warn: { type: "number" },
            fail: { type: "number" },
            total: { type: "number" },
          },
          required: ["ok", "warn", "fail", "total"],
        },
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              status: { type: "string", enum: ["ok", "warn", "fail"] },
              message: { type: "string" },
              fix: { type: "string" },
            },
            required: ["id", "label", "status", "message"],
          },
        },
      },
      required: ["healthy", "counts", "findings"],
    },

    async run(_args, signal): Promise<ToolOutcome> {
      const result = await ctx.probe.run("doctor", signal);
      if (!result.ok) return { text: result.message, failed: true };

      // The probe runs this package's own `topics.ts`, in the same install, so
      // the shape is ours by construction.
      const report = result.data as DoctorReport;
      return { text: render(report), data: report };
    },
  };
}

function render(report: DoctorReport): string {
  const lines = report.findings.map((finding) => {
    const head = `${MARK[finding.status]} ${finding.label} — ${finding.message}`;
    return finding.fix ? `${head}\n    fix: ${finding.fix}` : head;
  });

  const { ok, warn, fail, total } = report.counts;
  const summary = report.healthy
    ? warn === 0
      ? `All ${total} checks passed.`
      : `${warn} warning(s) across ${total} checks; nothing is broken.`
    : `${fail} FAILING, ${warn} warning(s), ${ok} ok — of ${total} checks. ` +
      `Address every failure before calling the task done.`;

  return `${lines.join("\n")}\n\n${summary}`;
}
