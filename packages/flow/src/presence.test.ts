import { describe, it, expect, beforeAll } from "bun:test";
import { Component } from "./Component.ts";
import { presence, locked, getPresenceProps, getLockedProps } from "./decorators.ts";
import { dehydrate, hydrate } from "./dehydrate.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

class RoomPage extends Component {
  @locked roomId = "42";
  @presence((self) => `board.${self.roomId}`) who: unknown[] = []; // dynamic channel
  @presence("lobby") lobby: unknown[] = []; // static channel
  override async render(): Promise<HtmlNode> {
    return { html: "<div></div>" };
  }
}

const memo = { id: "r1", name: "RoomPage", path: "/t" } as const;

describe("@presence", () => {
  it("registers presence props with their channel, and marks them locked (in-snapshot, read-only)", () => {
    const p = new RoomPage();
    const props = getPresenceProps(p);
    expect([...props.keys()].sort()).toEqual(["lobby", "who"]);
    const lockedProps = getLockedProps(p);
    expect(lockedProps.has("who")).toBe(true);
    expect(lockedProps.has("lobby")).toBe(true);
  });

  it("dehydrate resolves channels into memo.presence (dynamic + static)", () => {
    const p = new RoomPage();
    p.roomId = "99";
    const snap = dehydrate(p, memo);
    expect(snap.memo.presence).toEqual([
      { prop: "who", channel: "board.99" },
      { prop: "lobby", channel: "lobby" },
    ]);
  });

  it("memo.presence is signed — a tampered channel fails verification", async () => {
    const p = new RoomPage();
    const snap = dehydrate(p, memo);
    snap.memo.presence = [{ prop: "who", channel: "board.HACKED" }];
    await expect(hydrate(snap, RoomPage)).rejects.toThrow();
  });

  it("omits memo.presence entirely for a component with no @presence props", () => {
    class Plain extends Component {
      override async render(): Promise<HtmlNode> {
        return { html: "<i/>" };
      }
    }
    const snap = dehydrate(new Plain(), { id: "p1", name: "Plain", path: "/t" });
    expect(snap.memo.presence).toBeUndefined();
  });
});
