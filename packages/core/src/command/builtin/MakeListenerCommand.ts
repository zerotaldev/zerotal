/**
 * The `make:listener` command, which scaffolds an event listener class.
 */
import { Command } from "../Command.ts";

/**
 * `bun zt make:listener <name>` — scaffolds a new event listener class under
 * `app/listeners/`.
 *
 * @category Scaffolding (make:*)
 */
export class MakeListenerCommand extends Command {
  static commandName = "make:listener";
  static description = "Create a new event listener class";
  static needsApp = false;
  static override args = [{ name: "name", required: true, default: "" }];

  async run(): Promise<void> {
    const name = this.args["name"];
    if (!name) {
      this.error("Name is required.");
      return;
    }
    const path = `app/listeners/${name}.ts`;
    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }
    await Bun.write(
      path,
      `export class ${name} {\n  async handle(event: unknown): Promise<void> {\n    // Handle the event here\n    void event;\n  }\n}\n`,
    );
    this.info(`Created: ${path}`);
  }
}
