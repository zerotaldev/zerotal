/**
 * The `make:event` command and the event source stubs it writes (plain and
 * broadcastable).
 */
import { GeneratorCommand } from "../GeneratorCommand.ts";
import { _frameworkImport } from "../appSource.ts";

/**
 * `bun zt make:event <name>` — scaffolds a new event class under `app/events/`
 * (pass `--broadcast`/`-b` for a broadcastable event extending `BroadcastingEvent`).
 *
 * @category Scaffolding (make:*)
 */
export class MakeEventCommand extends GeneratorCommand {
  static override commandName = "make:event";
  static override description = "Create a new event class";
  static override args = [
    { name: "name", required: true, description: "Event class name (e.g. UserRegistered)" },
  ];
  static override flags = [
    {
      name: "broadcast",
      short: "b",
      type: "boolean" as const,
      description: "Generate a broadcastable event (extends BroadcastingEvent)",
      default: false,
    },
  ];

  protected override async generate(): Promise<void> {
    const name = this.args["name"]!;
    const path = `app/events/${name}.ts`;
    const broadcast = this.flags["broadcast"] === true;
    if (!(await this.writeFile(path, broadcast ? broadcastEventStub(name) : _eventStub(name))))
      return;
    this.next(
      broadcast
        ? `Dispatch it: ${name}.dispatch();  (broadcasts it, and runs its listeners)`
        : `Emit it: await Events.emit(new ${name}());  (Events from "${_frameworkImport("@zerotal/core")}")`,
      `Handle it: bun zt make:listener <Name>, with \`static listens = ${name}\` in it.`,
    );
  }
}

/**
 * The generated file for a plain event.
 *
 * @internal
 */
export function _eventStub(name: string): string {
  return `/**
 * ${name} event.
 */
export class ${name} {
  constructor() {
    // Whatever a listener needs to know, as constructor parameters, e.g.
    //   constructor(public readonly userId: number) {}
  }
}
`;
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
