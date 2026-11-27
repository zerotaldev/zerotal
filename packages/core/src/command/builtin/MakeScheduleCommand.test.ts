import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MakeScheduleCommand, _scheduleStub } from "./MakeScheduleCommand.ts";

const ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");

/** Run the generator in `cwd`, returning what it printed. */
async function generate(name: string): Promise<{ out: string; errors: string }> {
  let out = "";
  let errors = "";
  const cmd = new MakeScheduleCommand();
  cmd.args = { name };
  cmd.flags = {};
  cmd._writer = {
    write: (m: string) => void (out += m),
    writeLine: (m: string) => void (out += m + "\n"),
    writeError: (m: string) => void (errors += m + "\n"),
  };
  await cmd.run();
  return { out, errors };
}

describe("MakeScheduleCommand", () => {
  let dir: string;
  let previous: string;

  beforeEach(() => {
    previous = process.cwd();
    dir = mkdtempSync(join(tmpdir(), "zt-make-schedule-"));
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(previous);
    rmSync(dir, { recursive: true, force: true });
    // A refusal fails the command through the exit code, which would fail this test run too.
    process.exitCode = 0;
  });

  it("declares static properties", () => {
    expect(MakeScheduleCommand.commandName).toBe("make:schedule");
    expect(MakeScheduleCommand.needsApp).toBe(false);
    expect(MakeScheduleCommand.args[0]!.name).toBe("name");
  });

  it("writes a Schedule subclass to app/schedules/", async () => {
    const { out } = await generate("SendReminders");
    const source = await Bun.file(join(dir, "app/schedules/SendReminders.ts")).text();

    expect(source).toBe(_scheduleStub("SendReminders"));
    expect(source).toContain('import { Schedule } from "zerotal/scheduler";');
    expect(source).toContain("export class SendReminders extends Schedule {");
    expect(source).toContain('override cron = "0 * * * *";');
    expect(source).toContain("async handle(): Promise<void> {");
    expect(out).toContain("bun zt schedule:run SendReminders");
  });

  it("imports only from zerotal/*, never a scoped package", () => {
    // The starters depend on `zerotal`, not on `@zerotal/scheduler` directly.
    const specs = [..._scheduleStub("X").matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specs).toEqual(["zerotal/scheduler"]);
  });

  it("refuses to overwrite an existing file", async () => {
    mkdirSync(join(dir, "app/schedules"), { recursive: true });
    writeFileSync(join(dir, "app/schedules/Existing.ts"), "// mine\n");

    const { errors } = await generate("Existing");

    expect(errors).toContain("File already exists");
    expect(process.exitCode).toBe(1);
    expect(await Bun.file(join(dir, "app/schedules/Existing.ts")).text()).toBe("// mine\n");
  });

  it("refuses a name that is not a class name", async () => {
    const { errors } = await generate("send-reminders");

    expect(errors).toContain("not a valid class name");
    expect(process.exitCode).toBe(1);
    expect(await Bun.file(join(dir, "app/schedules/send-reminders.ts")).exists()).toBe(false);
  });

  it("errors when the name is empty", async () => {
    const { errors } = await generate("");
    expect(errors).toContain("Name is required");
  });

  it("says to register SchedulerProvider when bootstrap/providers.ts lacks it", async () => {
    mkdirSync(join(dir, "bootstrap"));
    writeFileSync(join(dir, "bootstrap/providers.ts"), "export default [];\n");

    const { out } = await generate("Nightly");

    expect(out).toContain("Register SchedulerProvider");
  });

  it("says nothing more when SchedulerProvider is registered", async () => {
    mkdirSync(join(dir, "bootstrap"));
    writeFileSync(
      join(dir, "bootstrap/providers.ts"),
      'import { SchedulerProvider } from "zerotal/scheduler";\nexport default [SchedulerProvider];\n',
    );

    const { out } = await generate("Nightly");

    expect(out).not.toContain("Register SchedulerProvider");
  });

  it("passes the starters' format:check as generated", async () => {
    await generate("SendReminders");
    const prettier = join(ROOT, "node_modules", ".bin", "prettier");
    const config = join(ROOT, "packages/create-zerotal/templates/react/_prettierrc.json");

    const check = Bun.spawnSync(
      [prettier, "--check", "--config", config, "app/schedules/SendReminders.ts"],
      { cwd: dir },
    );

    expect(check.stderr.toString()).toBe("");
    expect(check.exitCode).toBe(0);
  }, 20_000);

  it("passes the starters' typecheck as generated", async () => {
    await generate("SendReminders");
    // The starter's own compiler options, with `zerotal/scheduler` pointed at this
    // checkout instead of an installed package.
    const starter = await Bun.file(
      join(ROOT, "packages/create-zerotal/templates/react/tsconfig.json"),
    ).json();
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          ...starter.compilerOptions,
          types: ["bun"],
          typeRoots: [join(ROOT, "node_modules", "@types")],
          paths: { "zerotal/scheduler": [join(ROOT, "packages/zerotal/src/scheduler.ts")] },
        },
        files: ["app/schedules/SendReminders.ts"],
      }),
    );

    const tsc = Bun.spawnSync([join(ROOT, "node_modules", ".bin", "tsc"), "-p", "."], {
      cwd: dir,
    });

    expect(tsc.stdout.toString()).toBe("");
    expect(tsc.exitCode).toBe(0);
  }, 60_000);
});
