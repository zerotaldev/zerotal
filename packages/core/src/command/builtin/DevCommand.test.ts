/**
 * `dev` is `serve --dev` with a richer flag set, and these pin the parts of that
 * claim a refactor could quietly break: the subclass relationship, the filters,
 * and `--list` naming the provider behind every entry — which is the question a
 * developer actually has when an unfamiliar tab appears.
 */
import { describe, it, expect } from "bun:test";
import { DevCommand } from "./DevCommand.ts";
import { ServeCommand, _networkUrl } from "./ServeCommand.ts";
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

  // `--list --json` used to print the table: `--json` was not declared, so the parser dropped it.
  it("--json prints one JSON document and nothing else", async () => {
    const { instance, writer } = command({ list: true, json: true });
    withApp(instance);

    const processes = await collect(instance);
    (instance as unknown as { _listDevProcesses(p: ResolvedDevProcess[]): void })._listDevProcesses(
      processes,
    );
    const output = writer.flush();

    expect(output).not.toContain("\x1b[");
    const document = JSON.parse(output) as {
      processes: { name: string; argv: string[] | null; registeredBy: string }[];
    };
    expect(document.processes.map((entry) => entry.name)).toEqual(["server", "queue", "types"]);
    expect(document.processes[0]).toMatchObject({
      argv: null,
      inProcess: false,
      registeredBy: "@zerotal/core",
      restart: "on-failure",
      after: "none",
      restartsWithServer: false,
    });
    expect(document.processes[2]).toMatchObject({
      argv: ["tsc", "--watch"],
      registeredBy: "TypesProvider",
    });
  });

  it("refuses --json without --list, rather than starting the deck", async () => {
    const { instance, writer } = command({ json: true });
    withApp(instance);
    const before = process.exitCode;
    try {
      await instance.run();
      expect(writer.flush()).toContain("--json goes with --list");
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = before ?? 0;
    }
  });
});

describe("zt dev and the port", () => {
  it("declares no default for --port, so app.port (PORT, from the shell or .env) is read", () => {
    // A default is indistinguishable from a typed flag, so it always won: `PORT=3113 bun zt dev`
    // tried 3000 while `bun zt serve` took 3113.
    const port = DevCommand.flags.find((f) => f.name === "port");
    expect(port).toBeDefined();
    expect(port?.default).toBeUndefined();
    expect(ServeCommand.flags.find((f) => f.name === "port")?.default).toBeUndefined();
  });
});

describe("zt dev and the interface it binds", () => {
  it("takes --host, with no default, so loopback is decided in one place", () => {
    const host = DevCommand.flags.find((f) => f.name === "host");
    expect(host?.type).toBe("string");
    expect(host?.default).toBeUndefined();
    expect(ServeCommand.flags.find((f) => f.name === "host")?.default).toBeUndefined();
  });

  it("shows a Network line only for a server the network can reach", () => {
    const address = (): string => "192.168.1.20";
    // `zt dev` without --host binds loopback: nothing on the network can open it.
    expect(_networkUrl("127.0.0.1", 3000, address)).toBeNull();
    expect(_networkUrl("localhost", 3000, address)).toBeNull();
    expect(_networkUrl("::1", 3000, address)).toBeNull();
    // Every interface: `zt dev --host 0.0.0.0`, and `serve` with no --host.
    expect(_networkUrl("0.0.0.0", 3000, address)).toBe("http://192.168.1.20:3000");
    expect(_networkUrl(undefined, 3000, address)).toBe("http://192.168.1.20:3000");
    // One address: that address.
    expect(_networkUrl("10.0.0.5", 4000, address)).toBe("http://10.0.0.5:4000");
    expect(_networkUrl("0.0.0.0", 3000, () => undefined)).toContain("unavailable");
  });

  it("prints no Network line in the banner of a loopback server", () => {
    // The banner a loopback run prints, read back without starting anything.
    const { instance, writer } = command({ port: 3000 });
    (instance as unknown as { _announce(m: string, p: number, h?: string): void })._announce(
      "dev",
      3000,
      "127.0.0.1",
    );
    const out = writer.flush();
    expect(out).toContain("http://localhost:3000");
    expect(out).not.toContain("Network");
  });
});
