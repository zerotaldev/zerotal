/**
 * The `make:job` command, which scaffolds a queue job class.
 */
import { Command } from "../Command.ts";
import { _frameworkImport, _writeAppSource } from "../appSource.ts";

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
    await _writeAppSource(path, jobStub(name, _frameworkImport("@zerotal/queue")));
    this.info(`Created: ${path}`);
  }
}

/** Source for a new queue job class extending `Job`, importing the queue by `queue`. */
export function jobStub(name: string, queue = "zerotal/queue"): string {
  return `import { Job, JobRegistry } from "${queue}";

export class ${name} extends Job {
  readonly queue = "default";

  // Whatever the job needs, as constructor parameters, e.g.
  //   constructor(public readonly id: number) { super(); }

  payload(): Record<string, unknown> {
    return {};
  }

  async handle(): Promise<void> {
    // Implement the job logic here
  }
}

JobRegistry.register(${name} as never);
`;
}
