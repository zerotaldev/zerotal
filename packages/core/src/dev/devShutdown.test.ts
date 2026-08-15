import { describe, it, expect } from "bun:test";
import { DEV_SHUTDOWN_MESSAGE, requestGracefulStop, type StoppableChild } from "./devShutdown.ts";

/** A child that exits `afterMs` after it is asked, or never if `afterMs` is null. */
function fakeChild(afterMs: number | null): StoppableChild & { sent: unknown[] } {
  const sent: unknown[] = [];
  let resolveExit!: (code: number) => void;
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  return {
    sent,
    exited,
    send(message: unknown) {
      sent.push(message);
      if (afterMs !== null) setTimeout(() => resolveExit(0), afterMs);
    },
  };
}

describe("requestGracefulStop", () => {
  it("asks over IPC and reports the child went on its own", async () => {
    const child = fakeChild(5);
    expect(await requestGracefulStop(child, 500)).toBe(true);
    expect(child.sent).toEqual([DEV_SHUTDOWN_MESSAGE]);
  });

  it("gives up after the grace period, so a wedged worker cannot hold a restart open", async () => {
    const child = fakeChild(null);
    const started = performance.now();
    expect(await requestGracefulStop(child, 60)).toBe(false);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("reports false when there is no channel, rather than waiting for one", async () => {
    // A child spawned without an `ipc` handler has no `send`. The caller's move
    // is to kill it, and making that wait out the grace period first would add
    // the delay to every restart for no chance of a better outcome.
    const child: StoppableChild = { exited: new Promise(() => {}) };
    const started = performance.now();
    expect(await requestGracefulStop(child, 5_000)).toBe(false);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("reports false when the channel is already dead", async () => {
    const child: StoppableChild = {
      exited: new Promise(() => {}),
      send() {
        throw new Error("channel closed");
      },
    };
    expect(await requestGracefulStop(child, 5_000)).toBe(false);
  });
});

describe("the dev worker, end to end", () => {
  it("drains on request where a signal would kill it outright", async () => {
    // The whole point on Windows: `child.kill("SIGTERM")` is TerminateProcess
    // there, so the handler never runs. This asserts the IPC path does what the
    // signal cannot — on every platform, since the mechanism is the same one.
    const script = `
      process.on("message", (m) => {
        if (m !== ${JSON.stringify(DEV_SHUTDOWN_MESSAGE)}) return;
        console.log("DRAINED");
        process.exit(0);
      });
      setInterval(() => {}, 1000);
      console.log("ready");
    `;
    const file = `${import.meta.dir}/.devShutdown.fixture.ts`;
    await Bun.write(file, script);

    try {
      const child = Bun.spawn(["bun", file], { stdout: "pipe", stderr: "ignore", ipc: () => {} });
      // Wait for the listener to be installed; a message sent before that is lost.
      await Bun.sleep(300);

      const stopped = await requestGracefulStop(child, 5_000);
      const output = await new Response(child.stdout).text();

      expect(stopped).toBe(true);
      expect(output).toContain("DRAINED");
    } finally {
      await Bun.file(file).unlink();
    }
  }, 20_000);
});
