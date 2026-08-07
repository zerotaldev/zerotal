/**
 * The `make:job` command, which scaffolds a queue job class.
 */
import { Command } from "../Command.ts";

/**
 * `bun zt make:job <name>` — scaffolds a new queue job class under `app/jobs/`.
 *
 * @category Scaffolding (make:*)
 */
export class MakeJobCommand extends Command {
  static commandName = "make:job";
  static description = "Create a new queue job class";
  static needsApp = false;
  static override args = [{ name: "name", required: true, default: "" }];

  async run(): Promise<void> {
    const name = this.args["name"];
    if (!name) {
      this.error("Name is required.");
      return;
    }
    const path = `app/jobs/${name}.ts`;
    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }
    await Bun.write(
      path,
      `import { Job, JobRegistry } from '@zerotal/queue';

export class ${name} extends Job {
  readonly queue = 'default';

  constructor(
    // public readonly id: number,
  ) { super(); }

  payload(): Record<string, unknown> {
    return {};
  }

  async handle(): Promise<void> {
    // Implement the job logic here
  }
}

JobRegistry.register(${name} as never);
`,
    );
    this.info(`Created: ${path}`);
  }
}
