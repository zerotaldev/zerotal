/**
 * The `make:notification` command and the notification source stub it writes.
 */
import { Command } from "../Command.ts";

/**
 * `bun zt make:notification <name>` — scaffolds a new notification class under
 * `app/notifications/`.
 *
 * @category Scaffolding (make:*)
 */
export class MakeNotificationCommand extends Command {
  static commandName = "make:notification";
  static description = "Create a new notification class";
  static needsApp = false;
  static args = [
    { name: "name", required: true, description: "Notification name (e.g. OrderShipped)" },
  ];

  async run(): Promise<void> {
    const name = this.args["name"]!;
    const path = `app/notifications/${name}.ts`;

    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }

    await Bun.write(path, notificationStub(name));
    this.info(`Created: ${path}`);
  }
}

/** Source for a new notification class extending `Notification`. */
export function notificationStub(name: string): string {
  return `import { Notification } from '@zerotal/notifications';

export class ${name} extends Notification {
  channels(): string[] {
    return ['database'];
  }

  toDatabase(): Record<string, unknown> {
    return {};
  }
}
`;
}
