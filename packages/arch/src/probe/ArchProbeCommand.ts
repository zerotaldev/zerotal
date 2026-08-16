/**
 * `bun zt arch:probe <topic>` — the one place the agent surface crosses into a
 * booted application.
 *
 * The MCP server never boots an app itself: it must keep stdout clean for the
 * protocol, and more importantly its answers have to reflect the code as it is
 * *now*, because the caller is an agent that edits that code between calls. A
 * long-lived booted app would answer `routes` from the state it booted with,
 * which is the same class of mistake as running code that is not the code on
 * disk.
 *
 * So each tool spawns this command, it boots like any other `zt` command, prints
 * one JSON document, and exits. One command rather than a `--json` flag on
 * `doctor`, `route:list` and the rest: it leaves those untouched, keeps every
 * app-shaped read in {@link probe}, and gives the subprocess boundary exactly
 * one shape to test.
 */
import { Command } from "@zerotal/core";
import type { Application } from "@zerotal/core";
import { PROBE_SENTINEL } from "./sentinel.ts";
import { PROBE_TOPICS, isProbeTopic, probe } from "./topics.ts";

export class ArchProbeCommand extends Command {
  static override commandName = "arch:probe";
  static override description = "Print a JSON report about this app for the agent surface";
  static override needsApp = true;
  static override args = [{ name: "topic", required: true }];
  static override flags = [];

  async run(): Promise<void> {
    const topic = this.args["topic"] ?? "";
    if (!isProbeTopic(topic)) {
      throw new Error(
        `Unknown probe topic "${topic}". Expected one of: ${PROBE_TOPICS.join(", ")}`,
      );
    }

    const app = this.app as Application | undefined;
    if (!app) throw new Error("arch:probe needs a booted application.");

    const payload = await probe(topic, app);

    // Written raw, through `write` rather than the colouring helpers: the reader
    // parses this and an escape sequence in the middle of it is not JSON.
    this.write(`\n${PROBE_SENTINEL}\n`);
    this.write(JSON.stringify(payload) + "\n");
  }
}
