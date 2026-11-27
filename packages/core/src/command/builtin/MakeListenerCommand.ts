/**
 * The `make:listener` command, which scaffolds an event listener class.
 */
import { GeneratorCommand } from "../GeneratorCommand.ts";

/**
 * `bun zt make:listener <name>` — scaffolds a new event listener class under
 * `app/listeners/`.
 *
 * @category Scaffolding (make:*)
 */
export class MakeListenerCommand extends GeneratorCommand {
  static override commandName = "make:listener";
  static override description = "Create a new event listener class";
  static override args = [
    { name: "name", required: true, description: "Listener class name (e.g. SendWelcomeEmail)" },
  ];

  protected override async generate(): Promise<void> {
    const name = this.args["name"]!;
    const path = `app/listeners/${name}.ts`;
    if (!(await this.writeFile(path, _listenerStub(name)))) return;
    // app/listeners/ is discovered at boot; a listener binds to whatever `static listens` names.
    this.next(
      `Name the event it handles: static listens = UserRegistered; and type handle()'s parameter.`,
      `It is bound at boot from app/listeners/, with no registration code.`,
    );
  }
}

/**
 * The generated file.
 *
 * @internal
 */
export function _listenerStub(name: string): string {
  return `export class ${name} {
  // The event (or events) this listener handles, e.g. \`static listens = UserRegistered;\`
  // with \`import { UserRegistered } from "../events/UserRegistered.ts";\`.
  static listens: unknown[] = [];

  async handle(event: unknown): Promise<void> {
    // Handle the event here
    void event;
  }
}
`;
}
