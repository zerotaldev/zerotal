import { describe, it, expect } from "bun:test";
import { _parseEchoListener } from "./client/bridge.ts";

describe('echo listener parsing (@on("echo:…"))', () => {
  it("parses a public channel listener", () => {
    expect(_parseEchoListener("echo:orders,OrderShipped")).toEqual({
      kind: "",
      channel: "orders",
      event: "OrderShipped",
    });
  });

  it("parses private and presence channels", () => {
    expect(_parseEchoListener("echo-private:orders.5,OrderShipped")).toEqual({
      kind: "-private",
      channel: "orders.5",
      event: "OrderShipped",
    });
    expect(_parseEchoListener("echo-presence:room,here")).toEqual({
      kind: "-presence",
      channel: "room",
      event: "here",
    });
  });

  it("splits on the LAST comma so dotted channels survive", () => {
    expect(_parseEchoListener("echo:teams.1.threads,MessageSent")).toEqual({
      kind: "",
      channel: "teams.1.threads",
      event: "MessageSent",
    });
  });

  it("supports a leading-dot custom broadcast name (broadcastAs)", () => {
    expect(_parseEchoListener("echo:scores,.score.submitted")).toEqual({
      kind: "",
      channel: "scores",
      event: ".score.submitted",
    });
  });

  it("returns null for non-echo listeners", () => {
    expect(_parseEchoListener("post-created")).toBeNull();
    expect(_parseEchoListener("echo:missing-event")).toBeNull(); // no comma
  });
});
