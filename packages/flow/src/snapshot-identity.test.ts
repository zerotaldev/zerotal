/**
 * A snapshot's signature proves integrity. It does not prove ownership.
 *
 * `@locked` is documented as tamper-proof server-authoritative state, and it is — against
 * modification. What the HMAC could not say was *whose* state it covered, so a snapshot
 * signed for one authenticated user could be replayed verbatim by another. Middleware
 * re-runs on every frame, so authentication really is re-checked; the data was still
 * someone else's. These cases failed before the subject binding.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { RequestContext } from "@zerotal/core";
import { Component } from "./Component.ts";
import { expose, locked } from "./decorators.ts";
import {
  dehydrate,
  hydrate,
  FlowSnapshotOwnershipError,
  SNAPSHOT_MAX_AGE_SECONDS,
} from "./dehydrate.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

class AccountPage extends Component {
  @locked accountId = 42;
  @expose note = "";
  async render(): Promise<HtmlNode> {
    return null as unknown as HtmlNode;
  }
}

const memo = { id: "c1", name: "AccountPage", path: "/account" };

/** Run `fn` as the given user (or as a guest when `id` is undefined). */
function as<T>(id: number | undefined, fn: () => T): T {
  const ctx = { user: id === undefined ? undefined : { id } };
  return RequestContext.run(ctx as never, fn);
}

function pageFor(accountId: number): AccountPage {
  const p = new AccountPage();
  p._flowId = "c1";
  p._flowPath = "/account";
  p.accountId = accountId;
  return p;
}

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

describe("snapshot subject binding", () => {
  it("records the user a snapshot was issued to", () => {
    const snap = as(7, () => dehydrate(pageFor(42), memo));
    expect(snap.memo.sub).toBe("7");
    expect(typeof snap.memo.iat).toBe("number");
  });

  it("round-trips for the user it was issued to", async () => {
    const snap = as(7, () => dehydrate(pageFor(42), memo));
    const restored = await as(7, () => hydrate(snap, AccountPage));
    expect(restored.accountId).toBe(42);
  });

  it("refuses a genuinely-signed snapshot belonging to someone else", async () => {
    // Victim's page, signed by the server, carrying their @locked account id.
    const victims = as(7, () => dehydrate(pageFor(42), memo));

    // Attacker is authenticated as themselves and replays it. The signature verifies.
    await expect(as(99, () => hydrate(victims, AccountPage))).rejects.toBeInstanceOf(
      FlowSnapshotOwnershipError,
    );
  });

  it("refuses an authenticated snapshot replayed anonymously, and the reverse", async () => {
    const authed = as(7, () => dehydrate(pageFor(42), memo));
    await expect(as(undefined, () => hydrate(authed, AccountPage))).rejects.toBeInstanceOf(
      FlowSnapshotOwnershipError,
    );

    const anon = as(undefined, () => dehydrate(pageFor(42), memo));
    await expect(as(7, () => hydrate(anon, AccountPage))).rejects.toBeInstanceOf(
      FlowSnapshotOwnershipError,
    );
  });

  it("lets an anonymous snapshot round-trip anonymously", async () => {
    const snap = as(undefined, () => dehydrate(pageFor(42), memo));
    expect(snap.memo.sub).toBeUndefined();
    const restored = await as(undefined, () => hydrate(snap, AccountPage));
    expect(restored.accountId).toBe(42);
  });

  it("expires a snapshot rather than honouring it forever", async () => {
    // Sign it in the past so this exercises the expiry check, not the integrity check —
    // editing `iat` on a finished snapshot would just break the HMAC.
    const realNow = Date.now;
    const aged = (() => {
      Date.now = () => realNow() - (SNAPSHOT_MAX_AGE_SECONDS + 60) * 1000;
      try {
        return as(7, () => dehydrate(pageFor(42), memo));
      } finally {
        Date.now = realNow;
      }
    })();

    await expect(as(7, () => hydrate(aged, AccountPage))).rejects.toBeInstanceOf(
      FlowSnapshotOwnershipError,
    );
  });
});
