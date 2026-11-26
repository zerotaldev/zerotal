/**
 * The `make:schedule` command, which scaffolds a scheduled task class.
 */
import { Command } from "../Command.ts";

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
export class MakeScheduleCommand extends Command {
  static commandName = "make:schedule";
  static description = "Create a new scheduled task class";
  static needsApp = false;
  static override args = [{ name: "name", required: true, default: "" }];

  async run(): Promise<void> {
    const name = this.args["name"];
    if (!name) {
      this.error("Name is required.");
      return;
    }
    // The name becomes a class name, and the class name the task's name.
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
      this.error(`"${name}" is not a valid class name. Use PascalCase, e.g. SendDailyReports.`);
      return;
    }
    const path = `app/schedules/${name}.ts`;
    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }
    await Bun.write(path, _scheduleStub(name));
    this.info(`Created: ${path}`);
    this.dim(`  Run it now with: bun zt schedule:run ${name}`);

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
export function _scheduleStub(name: string): string {
  return `import { Schedule } from "zerotal/scheduler";

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
