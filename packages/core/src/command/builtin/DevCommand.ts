/**
 * `bun zt dev` — the server plus every process a provider or the app registered,
 * in one terminal, each in its own tab.
 */
import { ServeCommand } from "./ServeCommand.ts";
import type { FlagDef } from "../Command.ts";

/**
 * `bun zt dev` — start dev mode: the server, the file watcher, and every
 * registered dev process, drawn as a deck of tabs. Aliased as `d`.
 *
 * @remarks
 * This *is* `serve --dev`, with the flags that only make sense when a deck is on
 * screen. It subclasses rather than reimplements so the two cannot drift: an app
 * that runs `serve --dev` in a script gets the same supervisor, the same
 * processes and the same restart behaviour as one that runs `dev`.
 *
 * The flag names deliberately match the conventional ones, so a developer
 * arriving from another framework needs no translation.
 *
 * @example
 * ```bash
 * bun zt dev                     # server + everything registered
 * bun zt dev --only=server,queue # just these two
 * bun zt dev --without=queue     # everything but the worker
 * bun zt dev --list              # what would run, and who registered it
 * bun zt dev --list --json       # the same, as one JSON document
 * bun zt dev --stream            # no TUI — prefixed lines, pipe-friendly
 * bun zt dev --host 0.0.0.0      # reachable from the network (a phone, a container)
 * ```
 *
 * @category Serving
 */
export class DevCommand extends ServeCommand {
  static override commandName = "dev";
  static override aliases = ["d"];
  static override description = "Start dev mode: the server plus every registered dev process";
  static override needsApp = true;

  static override flags: FlagDef[] = [
    {
      name: "port",
      short: "p",
      type: "number",
      // No default, as on `serve`: one would always win, and `app.port` (from `PORT`, in the
      // shell or `.env`) would never be read.
      description: "Port to listen on (default: app.port, which is PORT or 3000)",
    },
    {
      // Loopback by default: a dev server shows stack traces, source and the inspector.
      name: "host",
      type: "string",
      description: "Interface to bind (default: 127.0.0.1; 0.0.0.0 for a phone or a container)",
    },
    {
      name: "force",
      type: "boolean",
      description: "If the port is busy, stop the process holding it",
      default: false,
    },
    {
      name: "auto-port",
      type: "boolean",
      description: "If the port is busy, start on the next free port",
      default: false,
    },
    {
      name: "only",
      type: "string",
      description: "Run only these processes, comma-separated (e.g. server,queue)",
    },
    {
      name: "without",
      type: "string",
      description: "Run everything except these processes, comma-separated",
    },
    {
      name: "list",
      type: "boolean",
      description: "Print what would run, with the provider that registered each",
      default: false,
    },
    {
      name: "json",
      type: "boolean",
      description: "With --list, print it as one JSON document, for a script",
      default: false,
    },
    {
      name: "force-build",
      type: "boolean",
      description: "Rebuild assets even when the build cache says they are current",
      default: false,
    },
    {
      name: "stream",
      type: "boolean",
      description: "Interleave prefixed output instead of drawing tabs",
      default: false,
    },
  ];

  override async run(): Promise<void> {
    // `--json` describes the listing; on its own it would start the deck and print no JSON.
    if (this.flags["json"] === true && this.flags["list"] !== true) {
      this.error("--json goes with --list: bun zt dev --list --json");
      process.exitCode = 1;
      return;
    }
    // Set the parent's own switch rather than the `dev` flag, which is now
    // reserved for refusing `serve --dev` by name. Same supervisor, same port
    // resolution, same banner — this subclasses so the two cannot drift.
    this._dev = true;
    await super.run();
  }
}
