import { describe, it, expect } from "bun:test";
import { _isLocalDevRequest } from "./localRequest.ts";

const req = (url: string, host?: string): Request =>
  new Request(url, host ? { headers: { host } } : {});

describe("_isLocalDevRequest", () => {
  it("accepts this machine by every loopback name", () => {
    for (const url of [
      "http://localhost:3000/x",
      "http://127.0.0.1:3000/x",
      "http://[::1]:3000/x",
      "http://app.localhost:3000/x",
    ]) {
      expect(_isLocalDevRequest(req(url), "127.0.0.1")).toBe(true);
    }
  });

  it("accepts the loopback socket addresses a dual-stack server reports", () => {
    const local = req("http://localhost:3000/x");
    expect(_isLocalDevRequest(local, "::1")).toBe(true);
    expect(_isLocalDevRequest(local, "::ffff:127.0.0.1")).toBe(true);
  });

  it("refuses another device on the network, whatever Host it sends", () => {
    // The Host header is the client's to write; the socket address is not.
    expect(_isLocalDevRequest(req("http://localhost:3000/x"), "192.168.0.20")).toBe(false);
    expect(_isLocalDevRequest(req("http://192.168.0.131:3000/x"), "192.168.0.20")).toBe(false);
  });

  it("refuses a local connection that names another host", () => {
    // A page on another site that points its own domain at 127.0.0.1: the connection is
    // local, the Host header is the attacker's domain.
    expect(
      _isLocalDevRequest(req("http://localhost:3000/x", "evil.example:3000"), "127.0.0.1"),
    ).toBe(false);
    expect(_isLocalDevRequest(req("http://192.168.0.131:3000/x"), "127.0.0.1")).toBe(false);
    expect(_isLocalDevRequest(req("http://localhost.evil.example/x"), "127.0.0.1")).toBe(false);
  });

  it("decides on the host alone when no socket address can be read", () => {
    expect(_isLocalDevRequest(req("http://localhost/x"))).toBe(true);
    expect(_isLocalDevRequest(req("http://localhost/x"), null)).toBe(true);
    expect(_isLocalDevRequest(req("http://example.com/x"))).toBe(false);
  });
});
