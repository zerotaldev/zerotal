/**
 * The `make:job` command, which scaffolds a queue job class.
 */
import { GeneratorCommand } from "../GeneratorCommand.ts";
import { _frameworkImport } from "../appSource.ts";

/**
 * `bun zt make:job <name>` — scaffolds a new queue job class under `app/jobs/`.
 *
 * @category Scaffolding (make:*)
 */
export class MakeJobCommand extends GeneratorCommand {
  static override commandName = "make:job";
  static override description = "Create a new queue job class";
  static override args = [
    { name: "name", required: true, description: "Job class name (e.g. ProcessPayment)" },
  ];

  protected override async generate(): Promise<void> {
    const name = this.args["name"]!;
    const path = `app/jobs/${name}.ts`;
    const queue = _frameworkImport("@zerotal/queue");
    if (!(await this.writeFile(path, jobStub(name, queue)))) return;
    // app/jobs/ is imported at boot, which runs the file's JobRegistry.register().
    this.next(
      `Dispatch it: await Queue.dispatch(new ${name}());  (Queue from "${queue}")`,
      `Process it: bun zt queue:work --once`,
    );
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
