/**
 * The `make:notification` command and the notification source stub it writes.
 */
import { GeneratorCommand } from "../GeneratorCommand.ts";

/**
 * `bun zt make:notification <name>` — scaffolds a new notification class under
 * `app/notifications/`.
 *
 * @category Scaffolding (make:*)
 */
export class MakeNotificationCommand extends GeneratorCommand {
  static override commandName = "make:notification";
  static override description = "Create a new notification class";
  static override args = [
    { name: "name", required: true, description: "Notification name (e.g. OrderShipped)" },
  ];

  protected override async generate(): Promise<void> {
    const name = this.args["name"]!;
    const path = `app/notifications/${name}.ts`;
    if (!(await this.writeFile(path, notificationStub(name)))) return;
    this.next(
      `Send it: await Notify.send(user, new ${name}());  (Notify from "@zerotal/notifications")`,
      `It needs NotificationProvider in bootstrap/providers.ts, and @zerotal/notifications installed.`,
    );
  }
}

/** Source for a new notification class extending `Notification`. */
export function notificationStub(name: string): string {
  return `import { Notification } from "@zerotal/notifications";

export class ${name} extends Notification {
  channels(): string[] {
    return ["database"];
  }

  toDatabase(): Record<string, unknown> {
    return {};
  }
}
`;
}
