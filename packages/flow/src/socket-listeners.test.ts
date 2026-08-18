import { describe, it, expect } from "bun:test";
import { _parseSocketListener } from "./client/bridge.ts";

describe('socket listener parsing (@on("socket:…"))', () => {
  it("parses a public channel listener", () => {
    expect(_parseSocketListener("socket:orders,OrderShipped")).toEqual({
      kind: "",
      channel: "orders",
      event: "OrderShipped",
    });
  });

  it("parses private and presence channels", () => {
    expect(_parseSocketListener("socket-private:orders.5,OrderShipped")).toEqual({
      kind: "-private",
      channel: "orders.5",
      event: "OrderShipped",
    });
    expect(_parseSocketListener("socket-presence:room,here")).toEqual({
      kind: "-presence",
      channel: "room",
      event: "here",
    });
  });

  it("splits on the LAST comma so dotted channels survive", () => {
    expect(_parseSocketListener("socket:teams.1.threads,MessageSent")).toEqual({
      kind: "",
      channel: "teams.1.threads",
      event: "MessageSent",
    });
  });

  it("supports a leading-dot custom broadcast name (broadcastAs)", () => {
    expect(_parseSocketListener("socket:scores,.score.submitted")).toEqual({
      kind: "",
      channel: "scores",
      event: ".score.submitted",
    });
  });

  it("returns null for non-socket listeners", () => {
    expect(_parseSocketListener("post-created")).toBeNull();
    expect(_parseSocketListener("socket:missing-event")).toBeNull(); // no comma
  });
});
