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
 * bun zt dev --stream            # no TUI — prefixed lines, pipe-friendly
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
    { name: "port", short: "p", type: "number", description: "Port to listen on", default: 3000 },
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
    // `dev` is `serve --dev` — set the flag the parent branches on rather than
    // duplicating its port resolution, asset config and banner.
    this.flags["dev"] = true;
    await super.run();
  }
}
