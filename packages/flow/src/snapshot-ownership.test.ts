import { describe, it, expect, beforeAll } from "bun:test";
import { RequestContext } from "@zerotal/core";
import { dehydrate, assertSnapshotSubject, FlowSnapshotOwnershipError } from "./dehydrate.ts";
import { Component } from "./Component.ts";
import { expose } from "./decorators.ts";

// A snapshot is stamped with the id of whoever it was rendered for, and rejected
// if somebody else presents it. The subject is read off the request context, so
// *when* the check runs matters as much as what it compares: run it before the
// auth middleware and there is no user on the context yet, so a snapshot minted
// for a signed-in person is compared against nobody and rejected as a stranger's.
//
// That was a real bug in the WebSocket dispatcher — hydration happened before the
// pipeline, so every action on an authenticated page failed with
// E_PULSE_SNAPSHOT_OWNER while guest pages (login) worked, because there the
// subject is `undefined` at both ends and matches by accident.

beforeAll(() => {
  // Snapshots are signed, so signing needs a key even though these tests are
  // about ownership rather than integrity.
  Bun.env.APP_KEY ??= "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

class Page extends Component {
  @expose count = 0;
  override render() {
    return { html: "<div></div>" };
  }
}

/** Render a snapshot inside a request context carrying `user`. */
async function snapshotFor(user: { id: unknown } | null) {
  const ctx = { user } as unknown as Parameters<typeof RequestContext.run>[0];
  return RequestContext.run(ctx, async () =>
    dehydrate(new Page(), { id: "page-1", name: "Page", path: "/admin" }),
  );
}

describe("snapshot ownership", () => {
  it("stamps the snapshot with the user it was rendered for", async () => {
    const snapshot = await snapshotFor({ id: 7 });
    expect(snapshot.memo.sub).toBe("7");
  });

  it("leaves the subject unset for a guest", async () => {
    const snapshot = await snapshotFor(null);
    expect(snapshot.memo.sub).toBeUndefined();
  });

  it("accepts the snapshot back inside a context for the same user", async () => {
    const snapshot = await snapshotFor({ id: 7 });
    const ctx = { user: { id: 7 } } as unknown as Parameters<typeof RequestContext.run>[0];
    await RequestContext.run(ctx, async () => {
      expect(() => assertSnapshotSubject(snapshot)).not.toThrow();
    });
  });

  it("rejects it inside a context for a different user", async () => {
    const snapshot = await snapshotFor({ id: 7 });
    const ctx = { user: { id: 8 } } as unknown as Parameters<typeof RequestContext.run>[0];
    await RequestContext.run(ctx, async () => {
      expect(() => assertSnapshotSubject(snapshot)).toThrow(FlowSnapshotOwnershipError);
    });
  });

  it("rejects an authenticated snapshot when no user has been resolved yet", async () => {
    // This is precisely the state the WebSocket dispatcher used to check in:
    // a context with no user, because auth had not run. The assertion is right;
    // running it that early was the bug, so this stays as documentation of why
    // hydration now happens inside the pipeline.
    const snapshot = await snapshotFor({ id: 7 });
    const ctx = { user: null } as unknown as Parameters<typeof RequestContext.run>[0];
    await RequestContext.run(ctx, async () => {
      expect(() => assertSnapshotSubject(snapshot)).toThrow(FlowSnapshotOwnershipError);
    });
  });

  it("lets a guest snapshot through for a guest, which is why login kept working", async () => {
    const snapshot = await snapshotFor(null);
    const ctx = { user: null } as unknown as Parameters<typeof RequestContext.run>[0];
    await RequestContext.run(ctx, async () => {
      expect(() => assertSnapshotSubject(snapshot)).not.toThrow();
    });
  });
});
