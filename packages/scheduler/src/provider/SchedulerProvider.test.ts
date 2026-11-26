import { describe, it, expect, afterEach } from "bun:test";
import { Container } from "@zerotal/core";
import type { Application } from "@zerotal/core";
import { SchedulerProvider } from "./SchedulerProvider.ts";
import { ScheduledTask } from "../ScheduledTask.ts";

/** A real container behind the few application members the provider touches. */
function makeApp(extra: Record<string, unknown> = {}): { app: Application; container: Container } {
  const container = Container.createEmpty();
  container.value("config", {
    get: (key: string) => (key === "scheduler.runLog" ? { enabled: false } : undefined),
  });
  for (const [key, value] of Object.entries(extra)) container.value(key as never, value as never);
  const app = { container } as unknown as Application;
  return { app, container };
}

afterEach(() => {
  ScheduledTask.lockManager = null;
});

describe("SchedulerProvider.devProcesses()", () => {
  it("registers one scheduler tab that runs schedule:work", () => {
    const definitions = new SchedulerProvider(makeApp().app).devProcesses();

    expect(definitions).toHaveLength(1);
    expect(definitions[0]!.name).toBe("scheduler");
    expect(definitions[0]!.command).toBe("schedule:work");
  });

  it("restarts with the server, so a schedule saved under app/ runs as saved", () => {
    expect(new SchedulerProvider(makeApp().app).devProcesses()[0]!.restartOnChange).toBe(true);
  });

  it("is not the worker, which would also consume the queue", () => {
    const [definition] = new SchedulerProvider(makeApp().app).devProcesses();
    expect(definition!.command).not.toBe("worker");
    expect(definition!.command).not.toBe("queue:work");
  });
});

describe("SchedulerProvider — boot", () => {
  it("resolves the run store during booting, so synchronous lookups find it", async () => {
    // Left lazy, `tryMake("scheduler.runs")` returned undefined: no run was
    // recorded and `schedule:runs` said the store was not registered.
    const { app, container } = makeApp();
    const provider = new SchedulerProvider(app);
    provider.onRegister();
    await provider.onBooting();

    expect(container.tryMake("scheduler.runs")).toBeDefined();
  });

  it("registers schedule:run and schedule:work beside the other commands", async () => {
    const factories = new Map<string, () => Promise<unknown>>();
    const runner = {
      registerLazy: (name: string, factory: () => Promise<unknown>) => factories.set(name, factory),
    };
    const { app } = makeApp({ commands: runner });
    const provider = new SchedulerProvider(app);
    provider.onRegister();
    await provider.onBooting();
    await provider.onBooted();

    for (const name of ["schedule:list", "schedule:runs", "schedule:run", "schedule:work"]) {
      const Cmd = (await factories.get(name)!()) as { commandName: string };
      expect(Cmd.commandName).toBe(name);
    }
    await provider.onStopped();
  });
});
