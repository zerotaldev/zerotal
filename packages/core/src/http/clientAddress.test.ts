import { describe, it, expect, afterEach } from "bun:test";
import { _clientAddress, _trustedProxyCount } from "./clientAddress.ts";
import { setDefaultApp } from "../application/currentApp.ts";

/**
 * `X-Forwarded-For` is written by the client, and by every proxy the request passes through.
 * Which entry is the client is a question about the chain, so these tests spell the chain out.
 *
 * Each proxy appends the address it received the request from. With a header the client sent
 * itself in front, one proxy (the app's peer) produces `<client-written>, <the real client>`.
 */
const SOCKET = "10.0.0.1"; // the proxy, from the app's side

describe("_clientAddress without trusted proxies", () => {
  it("is the socket address, whatever the header says", () => {
    expect(_clientAddress({ socket: SOCKET, forwardedFor: "6.6.6.6" })).toBe(SOCKET);
    expect(_clientAddress({ socket: SOCKET, forwardedFor: "6.6.6.6" }, 0)).toBe(SOCKET);
    expect(_clientAddress({ socket: SOCKET, forwardedFor: "6.6.6.6" }, undefined)).toBe(SOCKET);
  });

  it("does not take a negative or non-numeric count as a reason to read the header", () => {
    expect(_clientAddress({ socket: SOCKET, forwardedFor: "6.6.6.6" }, -1)).toBe(SOCKET);
    expect(_clientAddress({ socket: SOCKET, forwardedFor: "6.6.6.6" }, Number.NaN)).toBe(SOCKET);
  });

  it("uses X-Real-IP only when there is no socket to read", () => {
    expect(_clientAddress({ socket: SOCKET, realIp: "7.7.7.7" })).toBe(SOCKET);
    expect(_clientAddress({ socket: null, realIp: "7.7.7.7" })).toBe("7.7.7.7");
    expect(_clientAddress({ socket: null, forwardedFor: "6.6.6.6" })).toBe("unknown");
    expect(_clientAddress({})).toBe("unknown");
  });
});

describe("_clientAddress behind one proxy", () => {
  it("is the last entry: the address the proxy received the request from", () => {
    expect(_clientAddress({ socket: SOCKET, forwardedFor: "203.0.113.9" }, 1)).toBe("203.0.113.9");
  });

  it("ignores everything the client wrote in front of it", () => {
    // The client sent `X-Forwarded-For: 6.6.6.6`; the proxy appended 203.0.113.9.
    expect(_clientAddress({ socket: SOCKET, forwardedFor: "6.6.6.6, 203.0.113.9" }, 1)).toBe(
      "203.0.113.9",
    );
    expect(
      _clientAddress({ socket: SOCKET, forwardedFor: "6.6.6.6, 7.7.7.7, 203.0.113.9" }, 1),
    ).toBe("203.0.113.9");
  });

  it("gives one client one answer however it varies what it sends", () => {
    const answers = new Set(
      ["a", "b, c", "1.1.1.1", "x, y, z", ""].map((written) =>
        _clientAddress(
          { socket: SOCKET, forwardedFor: written ? `${written}, 203.0.113.9` : "203.0.113.9" },
          1,
        ),
      ),
    );
    expect([...answers]).toEqual(["203.0.113.9"]);
  });

  it("trims the spaces proxies put after the commas", () => {
    expect(_clientAddress({ socket: SOCKET, forwardedFor: "6.6.6.6 ,   203.0.113.9  " }, 1)).toBe(
      "203.0.113.9",
    );
  });

  it("falls back to the socket when there is no header", () => {
    expect(_clientAddress({ socket: SOCKET }, 1)).toBe(SOCKET);
    expect(_clientAddress({ socket: SOCKET, forwardedFor: "" }, 1)).toBe(SOCKET);
  });
});

describe("_clientAddress behind more than one proxy", () => {
  it("is the n-th entry from the right", () => {
    // client -> edge -> balancer -> app. The balancer appended the edge's address, the edge
    // appended the client's.
    const header = "6.6.6.6, 203.0.113.9, 198.51.100.4";
    expect(_clientAddress({ socket: SOCKET, forwardedFor: header }, 2)).toBe("203.0.113.9");
    expect(_clientAddress({ socket: SOCKET, forwardedFor: header }, 3)).toBe("6.6.6.6");
  });

  it("counts a proxy that records its own address as well as its peer's twice", () => {
    // Some balancers append `<peer>, <own address>`.
    expect(
      _clientAddress({ socket: SOCKET, forwardedFor: "6.6.6.6, 203.0.113.9, 35.1.1.1" }, 2),
    ).toBe("203.0.113.9");
  });

  it("reads the leftmost entry when the header is shorter than the count", () => {
    // A hop that does not append, or a count that is too high: the earliest address anyone
    // recorded is the best there is.
    expect(_clientAddress({ socket: SOCKET, forwardedFor: "203.0.113.9" }, 3)).toBe("203.0.113.9");
    expect(_clientAddress({ socket: SOCKET, forwardedFor: "203.0.113.9, 198.51.100.4" }, 5)).toBe(
      "203.0.113.9",
    );
  });
});

/** An app whose `app.throttle` config is `throttle`, just enough for `config.safe()` to read. */
function appWithThrottle(throttle: unknown): void {
  const manager = {
    get: (path: string, fallback?: unknown) => (path === "app.throttle" ? throttle : fallback),
  };
  setDefaultApp({ container: { makeSync: () => manager } } as never);
}

describe("_trustedProxyCount", () => {
  afterEach(() => {
    setDefaultApp(undefined);
  });

  it("is undefined when there is no app, or the app declares no proxies", () => {
    expect(_trustedProxyCount()).toBeUndefined();

    appWithThrottle({ maxAttempts: 60, windowSeconds: 60 });
    expect(_trustedProxyCount()).toBeUndefined();
  });

  it("reads app.throttle.trustedProxies, the setting the throttles read", () => {
    appWithThrottle({ maxAttempts: 60, windowSeconds: 60, trustedProxies: 2 });

    expect(_trustedProxyCount()).toBe(2);
  });

  it("ignores a value that is not a positive number", () => {
    for (const bad of [0, -1, Number.NaN, "1", null]) {
      appWithThrottle({ trustedProxies: bad });
      expect(_trustedProxyCount()).toBeUndefined();
    }
  });
});
