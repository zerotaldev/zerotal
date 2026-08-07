/**
 * The `make:event` command and the event source stubs it writes (plain and
 * broadcastable).
 */
import { Command } from "../Command.ts";

/**
 * `bun zt make:event <name>` — scaffolds a new event class under `app/events/`
 * (pass `--broadcast`/`-b` for a broadcastable event extending `BroadcastingEvent`).
 *
 * @category Scaffolding (make:*)
 */
export class MakeEventCommand extends Command {
  static commandName = "make:event";
  static description = "Create a new event class";
  static needsApp = false;
  static override args = [{ name: "name", required: true, default: "" }];
  static override flags = [
    {
      name: "broadcast",
      short: "b",
      type: "boolean" as const,
      description: "Generate a broadcastable event (extends BroadcastingEvent)",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const name = this.args["name"];
    if (!name) {
      this.error("Name is required.");
      return;
    }
    const path = `app/events/${name}.ts`;
    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }
    const broadcast = this.flags["broadcast"] as boolean;
    await Bun.write(path, broadcast ? broadcastEventStub(name) : plainEventStub(name));
    this.info(`Created: ${path}`);
  }
}

function plainEventStub(name: string): string {
  return `/**\n * ${name} event.\n */\nexport class ${name} {\n  constructor(\n    // public readonly userId: number,\n  ) {}\n}\n`;
}

/** Source for a broadcastable event that extends `BroadcastingEvent`. */
export function broadcastEventStub(name: string): string {
  return `import { BroadcastingEvent, privateChannel } from "@zerotal/broadcasting";

/**
 * ${name} - a broadcastable event.
 *
 * Dispatch it (broadcasts + runs any listeners):
 *   ${name}.dispatch(order);
 *
 * Or broadcast to everyone but the current user:
 *   broadcast(new ${name}(order)).toOthers();
 */
export class ${name} extends BroadcastingEvent {
  constructor(
    // public readonly order: Order,
  ) {
    super();
  }

  /** The channel(s) this event broadcasts on. Use [param] placeholders in channel auth rules. */
  broadcastOn() {
    return privateChannel("channel-name");
  }

  /** Optional: the wire payload (defaults to this event's own public properties). */
  broadcastWith() {
    return {};
  }

  /** Optional: only broadcast when this returns true. */
  // broadcastWhen() {
  //   return true;
  // }
}
`;
}
