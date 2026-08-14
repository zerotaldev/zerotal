/**
 * `dev` is `serve --dev` with a richer flag set, and these pin the parts of that
 * claim a refactor could quietly break: the subclass relationship, the filters,
 * and `--list` naming the provider behind every entry — which is the question a
 * developer actually has when an unfamiliar tab appears.
 */
import { describe, it, expect } from "bun:test";
import { DevCommand } from "./DevCommand.ts";
import { ServeCommand } from "./ServeCommand.ts";
import { BufferWriter } from "../OutputWriter.ts";
import type { ResolvedDevProcess } from "../../dev/DevProcess.ts";
import type { ServiceProvider } from "../../provider/ServiceProvider.ts";

/** A command wired to a fake app, with `flags` set as the runner would. */
function command(flags: Record<string, string | boolean | number> = {}): {
  instance: DevCommand;
  writer: BufferWriter;
} {
  const instance = new DevCommand();
  const writer = new BufferWriter();
  instance._writer = writer;
  instance.flags = flags;
  return { instance, writer };
}

/** A provider contributing `queue` and `types`, named for the registrant column. */
function providers(): ServiceProvider[] {
  const make = (name: string, definitions: unknown[]): ServiceProvider => {
    const Klass = { [name]: class {} }[name] as new () => object;
    const instance = new Klass() as ServiceProvider;
    (instance as { devProcesses: () => unknown[] }).devProcesses = () => definitions;
    return instance;
  };
  return [
    make("QueueProvider", [{ name: "queue", command: "queue:work" }]),
    make("TypesProvider", [{ name: "types", command: ["tsc", "--watch"] }]),
  ];
}

/** Attach a booted-looking app so `_devProcesses()` can collect from it. */
function withApp(instance: DevCommand): DevCommand {
  instance.app = {
    _activeProviders: providers(),
    container: {
      makeSync: () => {
        throw new Error("no config bound");
      },
    },
  };
  return instance;
}

/** Reach the protected collector the way `_runDevMode` does. */
function collect(instance: DevCommand): Promise<ResolvedDevProcess[]> {
  return (
    instance as unknown as { _devProcesses(): Promise<ResolvedDevProcess[]> }
  )._devProcesses();
}

describe("DevCommand — identity", () => {
  it("is serve --dev, not a second implementation of it", () => {
    expect(new DevCommand()).toBeInstanceOf(ServeCommand);
  });

  it("is registered as dev, aliased d", () => {
    expect(DevCommand.commandName).toBe("dev");
    expect(DevCommand.aliases).toContain("d");
  });

  it("declares every flag the deck needs", () => {
    const names = DevCommand.flags.map((flag) => flag.name);
    expect(names).toEqual(
      expect.arrayContaining(["only", "without", "list", "force-build", "stream"]),
    );
  });
});

describe("DevCommand — process selection", () => {
  it("runs the server plus everything registered by default", async () => {
    const { instance } = command();
    const processes = await collect(withApp(instance));

    expect(processes.map((entry) => entry.name)).toEqual(["server", "queue", "types"]);
  });

  it("--only keeps exactly what was named", async () => {
    const { instance } = command({ only: "server,queue" });
    const processes = await collect(withApp(instance));

    expect(processes.map((entry) => entry.name)).toEqual(["server", "queue"]);
  });

  it("--only can leave the server out entirely", async () => {
    // The server is an ordinary entry, so "just the queue" really means that
    // rather than being quietly ignored.
    const { instance } = command({ only: "queue" });
    const processes = await collect(withApp(instance));

    expect(processes.map((entry) => entry.name)).toEqual(["queue"]);
  });

  it("--without drops what was named and keeps the rest", async () => {
    const { instance } = command({ without: "queue" });
    const processes = await collect(withApp(instance));

    expect(processes.map((entry) => entry.name)).toEqual(["server", "types"]);
  });

  it("tolerates spaces around the commas", async () => {
    const { instance } = command({ only: "server, queue" });
    const processes = await collect(withApp(instance));

    expect(processes.map((entry) => entry.name)).toEqual(["server", "queue"]);
  });

  it("--without wins over --only when both name the same process", async () => {
    const { instance } = command({ only: "server,queue", without: "queue" });
    const processes = await collect(withApp(instance));

    expect(processes.map((entry) => entry.name)).toEqual(["server"]);
  });

  it("reports a broken definition instead of refusing to start the server", async () => {
    const { instance, writer } = command();
    // A real class declaration: the registry reports `constructor.name`, and it
    // has to be the name a developer would go looking for in their node_modules.
    class BrokenProvider {}
    const broken = new BrokenProvider() as unknown as ServiceProvider;
    (broken as { devProcesses: () => unknown[] }).devProcesses = () => [{ name: "x" }];
    instance.app = {
      _activeProviders: [broken],
      container: { makeSync: () => ({ get: () => undefined }) },
    };

    const processes = await collect(instance);

    expect(processes.map((entry) => entry.name)).toEqual(["server"]);
    expect(writer.flush()).toContain("BrokenProvider");
  });
});

describe("DevCommand — --list", () => {
  it("names the resolved command and the provider behind every entry", async () => {
    const { instance, writer } = command({ list: true });
    withApp(instance);

    const processes = await collect(instance);
    (instance as unknown as { _listDevProcesses(p: ResolvedDevProcess[]): void })._listDevProcesses(
      processes,
    );
    const output = writer.flush();

    expect(output).toContain("queue");
    expect(output).toContain("QueueProvider");
    expect(output).toContain("tsc --watch");
    expect(output).toContain("TypesProvider");
    // The server has no argv of its own — it is the orchestrator's.
    expect(output).toContain("managed by the orchestrator");
  });

  it("says so when every process was filtered out", async () => {
    const { instance, writer } = command({ list: true, only: "nothing-matches" });
    withApp(instance);

    const processes = await collect(instance);
    (instance as unknown as { _listDevProcesses(p: ResolvedDevProcess[]): void })._listDevProcesses(
      processes,
    );

    expect(writer.flush()).toContain("Nothing to run");
  });
});
