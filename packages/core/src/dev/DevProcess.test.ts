/**
 * The registry decides what dev mode runs, and almost every interesting rule in
 * it is about *precedence*: an app must be able to override a provider it does
 * not own, and a provider that contributed a broken definition must name itself
 * rather than fail anonymously.
 */
import { describe, it, expect } from "bun:test";
import { collectDevProcesses } from "./DevProcess.ts";
import type { DevProcessDefinition, DevConfigShape } from "./DevProcess.ts";
import type { ServiceProvider } from "../provider/ServiceProvider.ts";

/** A provider that contributes `definitions` and is named `name` in reports. */
function provider(name: string, definitions: DevProcessDefinition[]): ServiceProvider {
  // The registry reads two things off a provider: `constructor.name` and
  // `devProcesses()`. A named class gives it both without booting an app.
  const Klass = { [name]: class {} }[name] as new () => object;
  const instance = new Klass() as ServiceProvider;
  (instance as { devProcesses: () => DevProcessDefinition[] }).devProcesses = () => definitions;
  return instance;
}

function app(...providers: ServiceProvider[]): { _activeProviders: ServiceProvider[] } {
  return { _activeProviders: providers };
}

function config(dev: DevConfigShape): { get<T>(key: string): T | undefined } {
  return { get: <T>(key: string): T | undefined => (key === "app.dev" ? (dev as T) : undefined) };
}

describe("collectDevProcesses()", () => {
  it("collects provider contributions in boot order", async () => {
    const collected = await collectDevProcesses(
      app(
        provider("QueueProvider", [{ name: "queue", command: "queue:work" }]),
        provider("TypesProvider", [{ name: "types", command: ["tsc", "--watch"] }]),
      ),
    );

    expect(collected.map((entry) => entry.name)).toEqual(["queue", "types"]);
  });

  it("names the provider that registered each process", async () => {
    const collected = await collectDevProcesses(
      app(provider("QueueProvider", [{ name: "queue", command: "queue:work" }])),
    );

    expect(collected[0]!.registrant).toBe("QueueProvider");
  });

  it("lets a later registration replace an earlier one by name", async () => {
    const collected = await collectDevProcesses(
      app(
        provider("QueueProvider", [{ name: "queue", command: "queue:work" }]),
        provider("AppProvider", [{ name: "queue", command: ["my-worker"] }]),
      ),
    );

    expect(collected).toHaveLength(1);
    expect(collected[0]!.argv).toEqual(["my-worker"]);
    expect(collected[0]!.registrant).toBe("AppProvider");
  });

  it("lets app config replace a provider's process", async () => {
    const collected = await collectDevProcesses(
      app(provider("QueueProvider", [{ name: "queue", command: "queue:work" }])),
      config({ processes: [{ name: "queue", command: ["custom"] }] }),
    );

    expect(collected).toHaveLength(1);
    expect(collected[0]!.registrant).toBe("app.dev.processes");
  });

  it("keeps a replaced process in its original position", async () => {
    // Otherwise overriding the first tab silently moves it to the end, and the
    // number key a developer has in muscle memory selects something else.
    const collected = await collectDevProcesses(
      app(
        provider("QueueProvider", [{ name: "queue", command: "queue:work" }]),
        provider("TypesProvider", [{ name: "types", command: ["tsc"] }]),
      ),
      config({ processes: [{ name: "queue", command: ["custom"] }] }),
    );

    expect(collected.map((entry) => entry.name)).toEqual(["queue", "types"]);
  });

  it("drops a process named in app.dev.disable", async () => {
    const collected = await collectDevProcesses(
      app(provider("QueueProvider", [{ name: "queue", command: "queue:work" }])),
      config({ disable: ["queue"] }),
    );

    expect(collected).toEqual([]);
  });

  it("resolves a boolean `enabled`", async () => {
    const collected = await collectDevProcesses(
      app(
        provider("A", [{ name: "on", command: ["x"], enabled: true }]),
        provider("B", [{ name: "off", command: ["y"], enabled: false }]),
      ),
    );

    expect(collected.map((entry) => entry.name)).toEqual(["on"]);
  });

  it("resolves an async `enabled` exactly once", async () => {
    let calls = 0;
    const collected = await collectDevProcesses(
      app(
        provider("A", [
          {
            name: "maybe",
            command: ["x"],
            enabled: async () => {
              calls++;
              return true;
            },
          },
        ]),
      ),
    );

    expect(collected).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it("treats an `enabled` that throws as not enabled", async () => {
    const collected = await collectDevProcesses(
      app(
        provider("A", [
          {
            name: "probe",
            command: ["x"],
            enabled: () => {
              throw new Error("config missing");
            },
          },
        ]),
      ),
    );

    expect(collected).toEqual([]);
  });

  it("resolves a bare string command against the app entrypoint", async () => {
    const collected = await collectDevProcesses(
      app(provider("QueueProvider", [{ name: "queue", command: "queue:work --queue=high" }])),
    );

    expect(collected[0]!.argv).toEqual(["bun", Bun.main, "queue:work", "--queue=high"]);
  });

  it("passes an array command through as raw argv", async () => {
    const collected = await collectDevProcesses(
      app(provider("P", [{ name: "stripe", command: ["stripe", "listen"] }])),
    );

    expect(collected[0]!.argv).toEqual(["stripe", "listen"]);
  });

  it("calls a thunk command at collection time", async () => {
    const collected = await collectDevProcesses(
      app(provider("P", [{ name: "x", command: () => ["computed", "argv"] }])),
    );

    expect(collected[0]!.argv).toEqual(["computed", "argv"]);
  });

  it("keeps an in-process `run` instead of argv", async () => {
    const run = async (): Promise<void> => {};
    const collected = await collectDevProcesses(app(provider("P", [{ name: "x", run }])));

    expect(collected[0]!.run).toBe(run);
    expect(collected[0]!.argv).toBeUndefined();
  });

  it("defaults restart to on-failure and after to none", async () => {
    const collected = await collectDevProcesses(
      app(provider("P", [{ name: "x", command: ["y"] }])),
    );

    expect(collected[0]!.restart).toBe("on-failure");
    expect(collected[0]!.after).toBe("none");
  });

  it("assigns distinct colours to processes that did not pick one", async () => {
    const collected = await collectDevProcesses(
      app(
        provider("P", [
          { name: "a", command: ["x"] },
          { name: "b", command: ["x"] },
          { name: "c", command: ["x"], color: "red" },
        ]),
      ),
    );

    expect(new Set(collected.map((entry) => entry.color)).size).toBe(3);
    expect(collected[2]!.color).toBe("red");
  });

  it("names the registrant when a definition sets neither command nor run", async () => {
    const promise = collectDevProcesses(app(provider("BrokenProvider", [{ name: "x" }])));

    await expect(promise).rejects.toThrow(/BrokenProvider/);
  });

  it("names the registrant when a definition sets both", async () => {
    const promise = collectDevProcesses(
      app(provider("BrokenProvider", [{ name: "x", command: ["y"], run: async () => {} }])),
    );

    await expect(promise).rejects.toThrow(/must set exactly one/);
  });

  it("survives a provider that does not implement the hook at all", async () => {
    // Providers written before `devProcesses()` existed must keep booting — an
    // optional-call on the base class is what makes the hook additive.
    const legacy = { constructor: { name: "OldProvider" } } as unknown as ServiceProvider;
    expect(await collectDevProcesses(app(legacy))).toEqual([]);
  });
});
