import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { Component } from "./Component.ts";
import { shared, locked, expose, getSharedProps, getLockedProps } from "./decorators.ts";
import { dehydrate, hydrate } from "./dehydrate.ts";
import {
  populateShared,
  snapshotSharedValues,
  commitShared,
  getSharedStore,
  _resetSharedStore,
  SHARED_EVENT,
} from "./shared.ts";
import { Broadcast } from "@zerotal/broadcasting";
import type { HtmlNode } from "./jsx-runtime.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

interface Card {
  id: number;
  text: string;
}

class BoardPage extends Component {
  @locked roomId = "1";
  @shared((self) => `board.${self.roomId}`) cards: Card[] = []; // dynamic channel
  @shared("global") notes: string[] = []; // static channel

  @expose
  addCard(card: Card): void {
    this.cards.push(card);
  }

  override async render(): Promise<HtmlNode> {
    return { html: "<div></div>" };
  }
}

const memo = { id: "b1", name: "BoardPage", path: "/t" } as const;

describe("@shared", () => {
  beforeEach(() => _resetSharedStore());
  afterEach(() => Broadcast.resetFake());

  it("registers shared props with their channel, marked locked (in-snapshot, read-only)", () => {
    const p = new BoardPage();
    const props = getSharedProps(p);
    expect([...props.keys()].sort()).toEqual(["cards", "notes"]);
    const lockedProps = getLockedProps(p);
    expect(lockedProps.has("cards")).toBe(true);
    expect(lockedProps.has("notes")).toBe(true);
  });

  it("dehydrate resolves channels into memo.shared (dynamic + static)", () => {
    const p = new BoardPage();
    p.roomId = "7";
    const snap = dehydrate(p, memo);
    expect(snap.memo.shared).toEqual([
      { prop: "cards", channel: "board.7" },
      { prop: "notes", channel: "global" },
    ]);
  });

  it("memo.shared is signed — a tampered channel fails verification", async () => {
    const p = new BoardPage();
    const snap = dehydrate(p, memo);
    snap.memo.shared = [{ prop: "cards", channel: "board.HACKED" }];
    await expect(hydrate(snap, BoardPage)).rejects.toThrow();
  });

  it("omits memo.shared entirely for a component with no @shared props", () => {
    class Plain extends Component {
      override async render(): Promise<HtmlNode> {
        return { html: "<i/>" };
      }
    }
    const snap = dehydrate(new Plain(), { id: "p1", name: "Plain", path: "/t" });
    expect(snap.memo.shared).toBeUndefined();
  });

  it("populateShared seeds the store with the default when the room is new", () => {
    const p = new BoardPage();
    populateShared(p);
    expect(getSharedStore().get("board.1::cards")).toEqual([]);
    expect(getSharedStore().get("global::notes")).toEqual([]);
  });

  it("commitShared writes the changed prop to the store and broadcasts to its channel", async () => {
    const fake = Broadcast.fake();
    const p = new BoardPage();
    populateShared(p);
    const before = snapshotSharedValues(p);

    p.addCard({ id: 1, text: "hello" });
    const changed = await commitShared(p, before);

    expect(changed).toEqual(["cards"]);
    expect(getSharedStore().get("board.1::cards")).toEqual([{ id: 1, text: "hello" }]);
    // Presence channels are prefixed `presence-` on the wire.
    fake.assertBroadcast(SHARED_EVENT, "presence-board.1");
    // The untouched `notes` prop must not broadcast.
    fake.assertNotBroadcast(SHARED_EVENT, "presence-global");
  });

  it("commitShared is a no-op (no broadcast) when nothing changed", async () => {
    const fake = Broadcast.fake();
    const p = new BoardPage();
    populateShared(p);
    const before = snapshotSharedValues(p);

    const changed = await commitShared(p, before); // no mutation
    expect(changed).toEqual([]);
    fake.assertNothingBroadcast();
  });

  it("a second component in the same room converges to committed state", async () => {
    Broadcast.fake();
    const a = new BoardPage();
    populateShared(a);
    const before = snapshotSharedValues(a);
    a.addCard({ id: 1, text: "from A" });
    await commitShared(a, before);

    // B joins the same room after A's write — read-latest fills B from the store.
    const b = new BoardPage();
    populateShared(b);
    expect(b.cards).toEqual([{ id: 1, text: "from A" }]);
  });

  it("different rooms are isolated (channel-scoped store keys)", async () => {
    Broadcast.fake();
    const a = new BoardPage();
    a.roomId = "1";
    populateShared(a);
    const before = snapshotSharedValues(a);
    a.addCard({ id: 1, text: "room 1" });
    await commitShared(a, before);

    const b = new BoardPage();
    b.roomId = "2";
    populateShared(b);
    expect(b.cards).toEqual([]); // room 2 never saw room 1's card
  });

  it("the store deep-clones — mutating the component does not retro-edit the store", async () => {
    Broadcast.fake();
    const p = new BoardPage();
    populateShared(p);
    const before = snapshotSharedValues(p);
    p.addCard({ id: 1, text: "one" });
    await commitShared(p, before);

    // Mutate the component's array AFTER commit; the store copy must be untouched.
    p.cards.push({ id: 2, text: "two" });
    expect(getSharedStore().get("board.1::cards")).toEqual([{ id: 1, text: "one" }]);
  });
});
