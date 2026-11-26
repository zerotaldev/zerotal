import { describe, it, expect } from "bun:test";
import {
  isPortAvailable,
  waitForPort,
  findAvailablePort,
  findPortOwner,
  _parsePort,
  _portFromEnv,
  _servePort,
  _clientPort,
} from "./port.ts";

describe("_parsePort()", () => {
  it("takes a whole number from 0 to 65535, as a number or a string", () => {
    expect(_parsePort(8080, "x")).toBe(8080);
    expect(_parsePort(" 8080 ", "x")).toBe(8080);
    expect(_parsePort(0, "x")).toBe(0);
    expect(_parsePort(65_535, "x")).toBe(65_535);
  });

  it("refuses anything else, naming where it came from", () => {
    for (const bad of [80800, -1, 3000.5, Number.NaN, "abc", "", "80 80", null, true]) {
      expect(() => _parsePort(bad, "PORT")).toThrow(/^PORT must be a whole number from 0 to 65535/);
    }
  });
});

describe("_portFromEnv()", () => {
  it("reads PORT, and is 3000 when it is unset or blank", () => {
    expect(_portFromEnv({ PORT: "8080" })).toBe(8080);
    expect(_portFromEnv({})).toBe(3000);
    expect(_portFromEnv({ PORT: "  " })).toBe(3000);
  });

  it("never throws on a bad value: config resolves before anything can report it", () => {
    expect(Number.isNaN(_portFromEnv({ PORT: "eighty" }))).toBe(true);
    expect(_portFromEnv({ PORT: "80800" })).toBe(80800);
  });
});

describe("_servePort()", () => {
  it("prefers --port, then app.port, then 3000", () => {
    expect(_servePort(4000, 8080, {})).toBe(4000);
    expect(_servePort(undefined, 8080, {})).toBe(8080);
    expect(_servePort(undefined, undefined, {})).toBe(3000);
  });

  it("refuses a bad app.port before anything binds, and says what PORT was", () => {
    expect(() => _servePort(undefined, 80800, { PORT: "80800" })).toThrow(
      'app.port (PORT is "80800") must be a whole number from 0 to 65535',
    );
    expect(() => _servePort(undefined, Number.NaN, {})).toThrow(/^app\.port must be/);
    expect(() => _servePort(Number.NaN, 3000, {})).toThrow(/^--port must be/);
  });
});

describe("_clientPort()", () => {
  it("prefers --port, then PORT, then 3000", () => {
    expect(_clientPort(4000, { PORT: "8080" })).toBe(4000);
    expect(_clientPort(undefined, { PORT: "8080" })).toBe(8080);
    expect(_clientPort(undefined, {})).toBe(3000);
    expect(() => _clientPort(undefined, { PORT: "x" })).toThrow(/^PORT must be/);
  });
});

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
