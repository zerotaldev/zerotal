/**
 * The `make:schedule` command, which scaffolds a scheduled task class.
 */
import { GeneratorCommand } from "../GeneratorCommand.ts";
import { _frameworkImport } from "../appSource.ts";

/**
 * `bun zt make:schedule <Name>` — scaffolds a `Schedule` subclass under
 * `app/schedules/`, where the scheduler's convention registers it at boot.
 *
 * The file is written the way the starters write code (`zerotal/*` imports,
 * double quotes, Prettier's layout), so it passes an app's `format:check` and
 * `typecheck` as generated.
 *
 * @category Scaffolding (make:*)
 */
export class MakeScheduleCommand extends GeneratorCommand {
  static override commandName = "make:schedule";
  static override description = "Create a new scheduled task class";
  // The name becomes a class name, and the class name the task's name.
  static override args = [
    { name: "name", required: true, description: "Task class name (e.g. SendReminders)" },
  ];

  protected override async generate(): Promise<void> {
    const name = this.args["name"]!;
    const path = `app/schedules/${name}.ts`;
    const scheduler = _frameworkImport("@zerotal/scheduler");
    if (!(await this.writeFile(path, _scheduleStub(name, scheduler)))) return;
    this.next(`Run it now with: bun zt schedule:run ${name}`);

    // The convention only runs with the provider registered, and a schedule that
    // silently never fires is the failure this generator exists to prevent.
    const providers = Bun.file("bootstrap/providers.ts");
    if ((await providers.exists()) && !(await providers.text()).includes("SchedulerProvider")) {
      this.warn(
        '  Register SchedulerProvider (from "zerotal/scheduler") in bootstrap/providers.ts ' +
          "so app/schedules/ is loaded.",
      );
    }
  }
}

/**
 * The generated file.
 *
 * @internal
 */
export function _scheduleStub(name: string, scheduler = "zerotal/scheduler"): string {
  return `import { Schedule } from "${scheduler}";

export class ${name} extends Schedule {
  // Every hour, on the hour. Override frequency(every) instead for helpers
  // such as every.dailyAt("02:30").
  override cron = "0 * * * *";

  async handle(): Promise<void> {
    // The work to do on each run.
  }
}
`;
}
