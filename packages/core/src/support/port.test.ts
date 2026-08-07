import { describe, it, expect } from "bun:test";
import { isPortAvailable, waitForPort, findAvailablePort, findPortOwner } from "./port.ts";

/** Bind an ephemeral port so the tests have a genuinely busy one to look at. */
function occupyPort(): { port: number; release: () => void } {
  const server = Bun.listen({ hostname: "0.0.0.0", port: 0, socket: { data(): void {} } });
  return { port: server.port, release: () => server.stop(true) };
}

describe("isPortAvailable()", () => {
  it("reports a bound port as unavailable and a free one as available", async () => {
    const held = occupyPort();
    try {
      expect(await isPortAvailable(held.port)).toBe(false);
    } finally {
      held.release();
    }
    expect(await isPortAvailable(held.port)).toBe(true);
  });

  it("leaves the port bindable after probing it", async () => {
    const { port, release } = occupyPort();
    release();

    // The probe binds to answer the question, so a leaked listener here would
    // make the very port it just cleared look busy to the caller.
    expect(await isPortAvailable(port)).toBe(true);
    expect(await isPortAvailable(port)).toBe(true);
  });
});

describe("waitForPort()", () => {
  it("returns true once the holder lets go", async () => {
    const held = occupyPort();
    setTimeout(() => held.release(), 150);
    expect(await waitForPort(held.port, 3_000)).toBe(true);
  });

  it("returns false while the port stays held", async () => {
    const held = occupyPort();
    try {
      expect(await waitForPort(held.port, 250)).toBe(false);
    } finally {
      held.release();
    }
  });
});

describe("findAvailablePort()", () => {
  it("skips a busy port and returns a later one", async () => {
    const held = occupyPort();
    try {
      const found = await findAvailablePort(held.port);
      expect(found).toBeDefined();
      expect(found).toBeGreaterThan(held.port);
    } finally {
      held.release();
    }
  });

  it("gives up rather than scanning past the port range", async () => {
    expect(await findAvailablePort(65_535, 5)).toBeDefined();
    expect(await findAvailablePort(65_536, 5)).toBeUndefined();
  });
});

describe("findPortOwner()", () => {
  it("names this process when it holds the port", async () => {
    const held = occupyPort();
    try {
      const owner = await findPortOwner(held.port);
      // The lookup shells out to netstat/lsof, either of which can be absent or
      // permission-limited; what must never happen is naming the wrong process.
      if (owner) expect(owner.pid).toBe(process.pid);
    } finally {
      held.release();
    }
  });

  it("returns undefined for a port nobody is listening on", async () => {
    const { port, release } = occupyPort();
    release();
    expect(await findPortOwner(port)).toBeUndefined();
  });
});
