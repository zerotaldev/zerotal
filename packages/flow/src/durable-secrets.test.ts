// A hidden field the user is part-way through typing — a new password — rides in the snapshot
// so it survives until they save. That is fine on the wire, where it goes back to the browser
// that produced it, and wrong in the durable store: `persistDurable` writes the whole snapshot
// server-side after every request, and the store may be Redis.
//
// A half-typed password should not be sitting there, and resuming into one is not what durable
// is for.
import { describe, it, expect } from "bun:test";
import { stripPendingSecrets } from "./dehydrate.ts";
import type { Snapshot } from "./types.ts";

function snapshotWith(data: Snapshot["data"]): Snapshot {
  return {
    data,
    memo: { id: "c1", name: "Demo", path: "/demo" },
    checksum: "not-checked-here",
  } as Snapshot;
}

describe("stripPendingSecrets", () => {
  it("removes a client-supplied hidden value and its marker", () => {
    const snap = snapshotWith({
      user: [
        { id: 1, name: "Ada", password: "hunter2" },
        { s: "mdl", class: "users", id: 1, p: ["password"] },
      ],
    });

    const clean = stripPendingSecrets(snap);
    const [value, meta] = clean.data["user"]!;

    expect(value).toEqual({ id: 1, name: "Ada" });
    expect(meta).not.toHaveProperty("p");
  });

  it("re-signs, because the checksum covers data", () => {
    // Stripping without a fresh signature would produce a snapshot that fails its own
    // verification on restore — a durable component that never comes back.
    const snap = snapshotWith({
      user: [
        { id: 1, password: "hunter2" },
        { s: "mdl", class: "users", id: 1, p: ["password"] },
      ],
    });

    expect(stripPendingSecrets(snap).checksum).not.toBe(snap.checksum);
  });

  it("leaves a snapshot with nothing pending exactly as it was", () => {
    // Identity, so the common case pays nothing — no copy, no re-sign.
    const snap = snapshotWith({
      user: [
        { id: 1, name: "Ada" },
        { s: "mdl", class: "users", id: 1 },
      ],
    });

    expect(stripPendingSecrets(snap)).toBe(snap);
  });

  it("only touches the props that carry a marker", () => {
    const snap = snapshotWith({
      user: [
        { id: 1, password: "hunter2" },
        { s: "mdl", class: "users", id: 1, p: ["password"] },
      ],
      count: [3, {}],
    });

    const clean = stripPendingSecrets(snap);
    expect(clean.data["count"]).toEqual([3, {}]);
  });
});
